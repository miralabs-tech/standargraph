import ELK, {
  type ElkExtendedEdge,
  type ElkNode,
} from "elkjs/lib/elk.bundled.js";
import type { GraphDocument } from "../format";
import { MARGIN } from "./shared";
import type { Box, Point } from "./types";

export type Direction = NonNullable<GraphDocument["direction"]>;

export type ElkBoxInput = {
  id: string;
  width: number;
  height: number;
  padding?: { top: number; left: number; bottom: number; right: number };
  minWidth?: number;
  children?: ElkBoxInput[];
};

export type ElkEdgeInput = {
  id: string;
  from: string;
  to: string;
  label?: { width: number; height: number };
};

export type ElkResult = {
  width: number;
  height: number;
  boxes: Map<string, Box>;
  routes: Map<string, { points: Point[]; labelBox?: Box }>;
};

const DIRECTIONS = {
  down: "DOWN",
  right: "RIGHT",
  up: "UP",
  left: "LEFT",
} as const;

function toElkNode(box: ElkBoxInput): ElkNode {
  if (box.children === undefined) {
    return { id: box.id, width: box.width, height: box.height };
  }
  const options: Record<string, string> = {};
  if (box.padding !== undefined) {
    const { top, left, bottom, right } = box.padding;
    options["elk.padding"] = `[top=${top},left=${left},bottom=${bottom},right=${right}]`;
  }
  if (box.minWidth !== undefined) {
    options["elk.nodeSize.constraints"] = "MINIMUM_SIZE";
    options["elk.nodeSize.minimum"] = `(${box.minWidth}, 0)`;
  }
  return {
    id: box.id,
    layoutOptions: options,
    children: box.children.map(toElkNode),
  };
}

export async function runElk(
  direction: Direction,
  children: ElkBoxInput[],
  edges: ElkEdgeInput[],
): Promise<ElkResult> {
  const elkEdges: ElkExtendedEdge[] = edges.map((edge) => {
    const elkEdge: ElkExtendedEdge = {
      id: edge.id,
      sources: [edge.from],
      targets: [edge.to],
    };
    if (edge.label !== undefined) {
      elkEdge.labels = [
        {
          id: `l:${edge.id}`,
          // elk drops a label without text, so the size alone is not enough
          text: edge.id,
          width: edge.label.width,
          height: edge.label.height,
        },
      ];
    }
    return elkEdge;
  });

  const root: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": DIRECTIONS[direction],
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.spacing.nodeNode": "40",
      "elk.layered.spacing.nodeNodeBetweenLayers": "60",
      "elk.padding": `[top=${MARGIN},left=${MARGIN},bottom=${MARGIN},right=${MARGIN}]`,
    },
    children: children.map(toElkNode),
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
  const boxes = new Map<string, Box>();
  const walk = (node: ElkNode, ox: number, oy: number): void => {
    const x = ox + (node.x ?? 0);
    const y = oy + (node.y ?? 0);
    absolute.set(node.id, { x, y });
    boxes.set(node.id, { x, y, width: node.width ?? 0, height: node.height ?? 0 });
    for (const child of node.children ?? []) walk(child, x, y);
  };
  for (const child of result.children ?? []) walk(child, 0, 0);

  const routedById = new Map<string, ElkExtendedEdge>();
  for (const routed of result.edges ?? []) routedById.set(routed.id, routed);

  const routes = new Map<string, { points: Point[]; labelBox?: Box }>();
  for (const edge of edges) {
    const routed = routedById.get(edge.id);
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
    const route: { points: Point[]; labelBox?: Box } = { points };
    if (label !== undefined) {
      route.labelBox = {
        x: (label.x ?? 0) + offset.x,
        y: (label.y ?? 0) + offset.y,
        width: label.width ?? 0,
        height: label.height ?? 0,
      };
    }
    routes.set(edge.id, route);
  }

  return {
    width: result.width ?? 0,
    height: result.height ?? 0,
    boxes,
    routes,
  };
}
