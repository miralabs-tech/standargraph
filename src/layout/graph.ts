import ELK, {
  type ElkExtendedEdge,
  type ElkNode,
} from "elkjs/lib/elk.bundled.js";
import type { Edge, GraphDocument, Group, Node } from "../format";
import { measureText } from "./measure";
import {
  compact,
  GROUP_FONT,
  groupTopPadding,
  labelBoxSize,
  MARGIN,
  PAD_X,
  round,
} from "./shared";
import { clipEnds, clipToShape, shapeSize } from "./shapes";
import type {
  Box,
  LaidOutEdge,
  LaidOutGraph,
  LaidOutGroup,
  LaidOutNode,
  Point,
} from "./types";

const DIRECTIONS = {
  down: "DOWN",
  right: "RIGHT",
  up: "UP",
  left: "LEFT",
} as const;

type OrderedGroup = { group: Group; depth: number };

function orderGroups(groups: readonly Group[]): OrderedGroup[] {
  const children = new Map<string | undefined, Group[]>();
  for (const group of groups) {
    const list = children.get(group.parent) ?? [];
    list.push(group);
    children.set(group.parent, list);
  }
  const ordered: OrderedGroup[] = [];
  const visit = (parent: string | undefined, depth: number): void => {
    for (const group of children.get(parent) ?? []) {
      ordered.push({ group, depth });
      visit(group.id, depth + 1);
    }
  };
  visit(undefined, 0);
  return ordered;
}

function nodeLabel(node: Node): string {
  return node.label ?? node.id;
}

function groupLabelWidth(group: Group): number {
  if (group.label === undefined || group.label === "") return 0;
  return measureText(group.label, GROUP_FONT).width;
}

function emptyGroupSize(group: Group): { width: number; height: number } {
  return {
    width: Math.ceil(Math.max(80, groupLabelWidth(group) + 2 * PAD_X)),
    height: groupTopPadding(group.label) + 24,
  };
}

function laidOutNode(node: Node, box: Box): LaidOutNode {
  return compact({
    id: node.id,
    label: nodeLabel(node),
    type: node.type,
    shape: node.shape,
    x: round(box.x),
    y: round(box.y),
    width: round(box.width),
    height: round(box.height),
    group: node.group,
    link: node.link,
    description: node.description,
    meta: node.meta,
  });
}

function laidOutGroup(group: Group, depth: number, box: Box): LaidOutGroup {
  return compact({
    id: group.id,
    label: group.label,
    x: round(box.x),
    y: round(box.y),
    width: round(box.width),
    height: round(box.height),
    depth,
    meta: group.meta,
  });
}

function laidOutEdge(
  edge: Edge,
  index: number,
  points: Point[],
  labelBox: Box | undefined,
): LaidOutEdge {
  return compact({
    id: edge.id ?? `e${index}`,
    from: edge.from,
    to: edge.to,
    label: edge.label,
    type: edge.type,
    directed: edge.directed ?? true,
    points: points.map((point) => ({ x: round(point.x), y: round(point.y) })),
    labelBox:
      labelBox === undefined
        ? undefined
        : {
            x: round(labelBox.x),
            y: round(labelBox.y),
            width: round(labelBox.width),
            height: round(labelBox.height),
          },
    meta: edge.meta,
  });
}

function finish(
  doc: GraphDocument,
  width: number,
  height: number,
  groups: LaidOutGroup[],
  nodes: LaidOutNode[],
  edges: LaidOutEdge[],
): LaidOutGraph {
  return compact({
    kind: "graph" as const,
    width: round(width),
    height: round(height),
    title: doc.title,
    groups,
    nodes,
    edges,
  });
}

async function layoutWithElk(doc: GraphDocument): Promise<LaidOutGraph> {
  const groups = orderGroups(doc.groups ?? []);
  const nodesByGroup = new Map<string | undefined, Node[]>();
  for (const node of doc.nodes) {
    const list = nodesByGroup.get(node.group) ?? [];
    list.push(node);
    nodesByGroup.set(node.group, list);
  }
  const subgroups = new Map<string, Group[]>();
  for (const { group } of groups) {
    if (group.parent === undefined) continue;
    const list = subgroups.get(group.parent) ?? [];
    list.push(group);
    subgroups.set(group.parent, list);
  }

  const nodeElk = (node: Node): ElkNode => {
    const size = shapeSize(node.shape, nodeLabel(node), node.type, 80);
    return { id: `n:${node.id}`, width: size.width, height: size.height };
  };

  const groupElk = (group: Group): ElkNode => {
    const members = nodesByGroup.get(group.id) ?? [];
    const nested = subgroups.get(group.id) ?? [];
    if (members.length === 0 && nested.length === 0) {
      const size = emptyGroupSize(group);
      return { id: `g:${group.id}`, width: size.width, height: size.height };
    }
    const top = groupTopPadding(group.label);
    return {
      id: `g:${group.id}`,
      layoutOptions: {
        "elk.padding": `[top=${top},left=${PAD_X},bottom=${PAD_X},right=${PAD_X}]`,
        "elk.nodeSize.constraints": "MINIMUM_SIZE",
        "elk.nodeSize.minimum": `(${Math.ceil(groupLabelWidth(group) + 2 * PAD_X)}, 0)`,
      },
      children: [...members.map(nodeElk), ...nested.map(groupElk)],
    };
  };

  const edges = doc.edges ?? [];
  const elkEdges: ElkExtendedEdge[] = edges.map((edge, index) => {
    const elkEdge: ElkExtendedEdge = {
      id: `e:${index}`,
      sources: [`n:${edge.from}`],
      targets: [`n:${edge.to}`],
    };
    if (edge.label !== undefined && edge.label !== "") {
      const size = labelBoxSize(edge.label);
      elkEdge.labels = [
        {
          id: `l:${index}`,
          text: edge.label,
          width: size.width,
          height: size.height,
        },
      ];
    }
    return elkEdge;
  });

  const root: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": DIRECTIONS[doc.direction ?? "down"],
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.spacing.nodeNode": "40",
      "elk.layered.spacing.nodeNodeBetweenLayers": "60",
      "elk.padding": `[top=${MARGIN},left=${MARGIN},bottom=${MARGIN},right=${MARGIN}]`,
    },
    children: [
      ...(nodesByGroup.get(undefined) ?? []).map(nodeElk),
      ...groups
        .filter(({ group }) => group.parent === undefined)
        .map(({ group }) => groupElk(group)),
    ],
    edges: elkEdges,
  };

  const scope = globalThis as unknown as { onmessage?: unknown };
  const previousHandler = scope.onmessage;
  let result: ElkNode;
  try {
    result = await new ELK().layout(root);
  } finally {
    // elkjs registers a global onmessage handler that keeps Bun's event loop alive
    scope.onmessage = previousHandler;
  }

  const absolute = new Map<string, Point>();
  const sizes = new Map<string, { width: number; height: number }>();
  const walk = (node: ElkNode, ox: number, oy: number): void => {
    const x = ox + (node.x ?? 0);
    const y = oy + (node.y ?? 0);
    absolute.set(node.id, { x, y });
    sizes.set(node.id, { width: node.width ?? 0, height: node.height ?? 0 });
    for (const child of node.children ?? []) walk(child, x, y);
  };
  walk(result, 0, 0);
  absolute.set("root", { x: 0, y: 0 });

  const boxOf = (id: string): Box => ({
    ...(absolute.get(id) ?? { x: 0, y: 0 }),
    ...(sizes.get(id) ?? { width: 0, height: 0 }),
  });

  const routedById = new Map<string, ElkExtendedEdge>();
  for (const routed of result.edges ?? []) routedById.set(routed.id, routed);

  const shapeById = new Map(doc.nodes.map((node) => [node.id, node.shape]));
  const laidOutEdges = edges.map((edge, index) => {
    const routed = routedById.get(`e:${index}`);
    const offset = absolute.get(routed?.container ?? "root") ?? { x: 0, y: 0 };
    const points: Point[] = [];
    for (const section of routed?.sections ?? []) {
      const chain = [
        section.startPoint,
        ...(section.bendPoints ?? []),
        section.endPoint,
      ];
      for (const point of chain) {
        const shifted = { x: point.x + offset.x, y: point.y + offset.y };
        const last = points[points.length - 1];
        if (last === undefined || last.x !== shifted.x || last.y !== shifted.y) {
          points.push(shifted);
        }
      }
    }
    const label = routed?.labels?.[0];
    const labelBox: Box | undefined =
      label === undefined
        ? undefined
        : {
            x: (label.x ?? 0) + offset.x,
            y: (label.y ?? 0) + offset.y,
            width: label.width ?? 0,
            height: label.height ?? 0,
          };
    const clipped = clipEnds(
      points,
      shapeById.get(edge.from),
      boxOf(`n:${edge.from}`),
      shapeById.get(edge.to),
      boxOf(`n:${edge.to}`),
    );
    return laidOutEdge(edge, index, clipped, labelBox);
  });

  return finish(
    doc,
    result.width ?? 0,
    result.height ?? 0,
    groups.map(({ group, depth }) =>
      laidOutGroup(group, depth, boxOf(`g:${group.id}`)),
    ),
    doc.nodes.map((node) => laidOutNode(node, boxOf(`n:${node.id}`))),
    laidOutEdges,
  );
}

function boundsOf(boxes: readonly Box[]): Box {
  if (boxes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function layoutPrecomputed(doc: GraphDocument): LaidOutGraph {
  const nodeBoxes = new Map<string, Box>();
  for (const node of doc.nodes) {
    nodeBoxes.set(node.id, {
      x: node.position?.x ?? 0,
      y: node.position?.y ?? 0,
      ...shapeSize(node.shape, nodeLabel(node), node.type, 80),
    });
  }

  const groups = orderGroups(doc.groups ?? []);
  const groupBoxes = new Map<string, Box>();

  const compute = (group: Group): Box | undefined => {
    const cached = groupBoxes.get(group.id);
    if (cached !== undefined) return cached;
    const parts: Box[] = [];
    for (const node of doc.nodes) {
      if (node.group === group.id) parts.push(nodeBoxes.get(node.id)!);
    }
    for (const { group: child } of groups) {
      if (child.parent !== group.id) continue;
      const box = compute(child);
      if (box !== undefined) parts.push(box);
    }
    if (parts.length === 0) return undefined;
    const bounds = boundsOf(parts);
    const top = groupTopPadding(group.label);
    const box: Box = {
      x: bounds.x - PAD_X,
      y: bounds.y - top,
      width: Math.max(
        bounds.width + 2 * PAD_X,
        Math.ceil(groupLabelWidth(group) + 2 * PAD_X),
      ),
      height: bounds.height + top + PAD_X,
    };
    groupBoxes.set(group.id, box);
    return box;
  };

  const emptyGroups: Group[] = [];
  for (const { group } of groups) {
    if (compute(group) === undefined) emptyGroups.push(group);
  }

  if (emptyGroups.length > 0) {
    const bounds = boundsOf([...nodeBoxes.values(), ...groupBoxes.values()]);
    let cursor = bounds.y + bounds.height + 20;
    for (const group of emptyGroups) {
      const size = emptyGroupSize(group);
      groupBoxes.set(group.id, { x: bounds.x, y: cursor, ...size });
      cursor += size.height + 20;
    }
  }

  const shapeById = new Map(doc.nodes.map((node) => [node.id, node.shape]));
  const labelBoxes: Box[] = [];
  const laidOutEdges = (doc.edges ?? []).map((edge, index) => {
    const from = nodeBoxes.get(edge.from)!;
    const to = nodeBoxes.get(edge.to)!;
    const fromShape = shapeById.get(edge.from);
    const toShape = shapeById.get(edge.to);
    let points: Point[];
    let anchor: Point;
    if (edge.from === edge.to) {
      const right = from.x + from.width;
      const mid = from.y + from.height / 2;
      points = [
        { x: right, y: mid - 8 },
        { x: right + 20, y: mid - 8 },
        { x: right + 20, y: mid + 8 },
        { x: right, y: mid + 8 },
      ];
      anchor = { x: right + 20, y: mid };
    } else {
      const fromCenter = {
        x: from.x + from.width / 2,
        y: from.y + from.height / 2,
      };
      const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
      const start = clipToShape(fromShape, from, toCenter);
      const end = clipToShape(toShape, to, fromCenter);
      points = [start, end];
      anchor = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    }
    let labelBox: Box | undefined;
    if (edge.label !== undefined && edge.label !== "") {
      const size = labelBoxSize(edge.label);
      labelBox = {
        x: anchor.x - size.width / 2,
        y: anchor.y - size.height / 2,
        ...size,
      };
      labelBoxes.push(labelBox);
    }
    return laidOutEdge(edge, index, points, labelBox);
  });

  const bounds = boundsOf([
    ...nodeBoxes.values(),
    ...groupBoxes.values(),
    ...labelBoxes,
    ...laidOutEdges.flatMap((edge) =>
      edge.points.map((point) => ({ ...point, width: 0, height: 0 })),
    ),
  ]);

  return finish(
    doc,
    bounds.x + bounds.width + MARGIN,
    bounds.y + bounds.height + MARGIN,
    groups.map(({ group, depth }) =>
      laidOutGroup(group, depth, groupBoxes.get(group.id)!),
    ),
    doc.nodes.map((node) => laidOutNode(node, nodeBoxes.get(node.id)!)),
    laidOutEdges,
  );
}

export function layoutGraph(doc: GraphDocument): Promise<LaidOutGraph> {
  if (
    doc.nodes.length > 0 &&
    doc.nodes.every((node) => node.position !== undefined)
  ) {
    return Promise.resolve(layoutPrecomputed(doc));
  }
  return layoutWithElk(doc);
}
