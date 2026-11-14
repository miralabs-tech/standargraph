import type { TreeDocument } from "../format";
import { compact, MARGIN, round } from "./shared";
import { shapeSize } from "./shapes";
import type { Box, LaidOutTree, LaidOutTreeEdge, LaidOutTreeNode, Point } from "./types";

type Direction = NonNullable<TreeDocument["direction"]>;
type Size = { width: number; height: number };
type Interval = [number, number];
type Axes = {
  breadth(size: Size): number;
  depth(size: Size): number;
  at(breadth: number, depth: number): Point;
};
type Gaps = { level: number; sibling: number };
type Placement = {
  breadth: Map<string, number>;
  depth: Map<string, number>;
  level: Map<string, number>;
  levelEnd: number[];
};

const TREE_GAPS: Gaps = { level: 48, sibling: 20 };
const MINDMAP_GAPS: Gaps = { level: 40, sibling: 12 };

const AXES: Record<Direction, Axes> = {
  down: {
    breadth: (size) => size.width,
    depth: (size) => size.height,
    at: (breadth, depth) => ({ x: breadth, y: depth }),
  },
  up: {
    breadth: (size) => size.width,
    depth: (size) => size.height,
    at: (breadth, depth) => ({ x: breadth, y: -depth }),
  },
  right: {
    breadth: (size) => size.height,
    depth: (size) => size.width,
    at: (breadth, depth) => ({ x: depth, y: breadth }),
  },
  left: {
    breadth: (size) => size.height,
    depth: (size) => size.width,
    at: (breadth, depth) => ({ x: -depth, y: breadth }),
  },
};

function place(
  root: string,
  first: readonly string[],
  kids: ReadonlyMap<string, string[]>,
  sizes: ReadonlyMap<string, Size>,
  axes: Axes,
  gaps: Gaps,
): Placement {
  const childrenOf = (id: string): readonly string[] =>
    id === root ? first : (kids.get(id) ?? []);
  const level = new Map<string, number>([[root, 0]]);
  const order: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const id = stack.pop()!;
    order.push(id);
    const list = childrenOf(id);
    for (let index = list.length - 1; index >= 0; index--) {
      const child = list[index]!;
      level.set(child, level.get(id)! + 1);
      stack.push(child);
    }
  }

  const contours = new Map<string, Interval[]>();
  const relative = new Map<string, number>();
  for (let position = order.length - 1; position >= 0; position--) {
    const id = order[position]!;
    const extent = axes.breadth(sizes.get(id)!);
    const list = childrenOf(id);
    if (list.length === 0) {
      contours.set(id, [[-extent / 2, extent / 2]]);
      continue;
    }
    const merged: Interval[] = [];
    const offsets: number[] = [];
    for (const child of list) {
      const contour = contours.get(child)!;
      let offset = 0;
      if (offsets.length > 0) {
        offset = -Infinity;
        const common = Math.min(merged.length, contour.length);
        for (let depth = 0; depth < common; depth++) {
          offset = Math.max(offset, merged[depth]![1] - contour[depth]![0] + gaps.sibling);
        }
      }
      offsets.push(offset);
      contour.forEach(([min, max], depth) => {
        const shifted: Interval = [min + offset, max + offset];
        const current = merged[depth];
        if (current === undefined) merged.push(shifted);
        else merged[depth] = [Math.min(current[0], shifted[0]), Math.max(current[1], shifted[1])];
      });
      contours.delete(child);
    }
    const center = (offsets[0]! + offsets[offsets.length - 1]!) / 2;
    list.forEach((child, index) => relative.set(child, offsets[index]! - center));
    contours.set(id, [
      [-extent / 2, extent / 2],
      ...merged.map(([min, max]): Interval => [min - center, max - center]),
    ]);
  }

  const breadth = new Map<string, number>([[root, 0]]);
  for (const id of order) {
    for (const child of childrenOf(id)) {
      breadth.set(child, breadth.get(id)! + relative.get(child)!);
    }
  }

  const extents: number[] = [];
  for (const id of order) {
    const at = level.get(id)!;
    extents[at] = Math.max(extents[at] ?? 0, axes.depth(sizes.get(id)!));
  }
  const origin = (extents[0] ?? 0) / 2;
  const centers: number[] = [];
  const levelEnd: number[] = [];
  let cursor = 0;
  extents.forEach((extent, at) => {
    centers[at] = cursor + extent / 2 - origin;
    levelEnd[at] = cursor + extent - origin;
    cursor += extent + gaps.level;
  });
  const depth = new Map<string, number>();
  for (const id of order) depth.set(id, centers[level.get(id)!]!);

  return { breadth, depth, level, levelEnd };
}

function boxAround(center: Point, size: Size): Box {
  return {
    x: center.x - size.width / 2,
    y: center.y - size.height / 2,
    width: size.width,
    height: size.height,
  };
}

function leafCounts(
  order: readonly string[],
  kids: ReadonlyMap<string, string[]>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (let index = order.length - 1; index >= 0; index--) {
    const id = order[index]!;
    const list = kids.get(id);
    counts.set(
      id,
      list === undefined || list.length === 0
        ? 1
        : list.reduce((sum, child) => sum + counts.get(child)!, 0),
    );
  }
  return counts;
}

export function layoutTree(doc: TreeDocument): LaidOutTree {
  const mindmap = doc.layout === "mindmap";
  const kids = new Map<string, string[]>();
  const parentOf = new Map<string, string>();
  let root = "";
  for (const node of doc.nodes) {
    if (node.parent === undefined) {
      root = node.id;
      continue;
    }
    parentOf.set(node.id, node.parent);
    const list = kids.get(node.parent) ?? [];
    list.push(node.id);
    kids.set(node.parent, list);
  }
  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  const sizes = new Map<string, Size>(
    doc.nodes.map((node) => [node.id, shapeSize(node.shape, node.label, node.type, 80)]),
  );

  const order: string[] = [];
  const depthOf = new Map<string, number>([[root, 0]]);
  const stack = [root];
  while (stack.length > 0) {
    const id = stack.pop()!;
    order.push(id);
    const list = kids.get(id) ?? [];
    for (let index = list.length - 1; index >= 0; index--) {
      depthOf.set(list[index]!, depthOf.get(id)! + 1);
      stack.push(list[index]!);
    }
  }

  const boxes = new Map<string, Box>();
  const sides = new Map<string, "left" | "right">();
  const routes = new Map<string, { points: Point[]; curve: "elbow" | "bezier" }>();

  if (!mindmap) {
    const axes = AXES[doc.direction ?? "down"];
    const placement = place(root, kids.get(root) ?? [], kids, sizes, axes, TREE_GAPS);
    for (const id of order) {
      const center = axes.at(placement.breadth.get(id)!, placement.depth.get(id)!);
      boxes.set(id, boxAround(center, sizes.get(id)!));
    }
    for (const id of order) {
      const parent = parentOf.get(id);
      if (parent === undefined) continue;
      const parentBreadth = placement.breadth.get(parent)!;
      const childBreadth = placement.breadth.get(id)!;
      const start = axes.at(
        parentBreadth,
        placement.depth.get(parent)! + axes.depth(sizes.get(parent)!) / 2,
      );
      const end = axes.at(
        childBreadth,
        placement.depth.get(id)! - axes.depth(sizes.get(id)!) / 2,
      );
      const middle = placement.levelEnd[placement.level.get(parent)!]! + TREE_GAPS.level / 2;
      routes.set(id, {
        curve: "elbow",
        points:
          round(parentBreadth) === round(childBreadth)
            ? [start, end]
            : [start, axes.at(parentBreadth, middle), axes.at(childBreadth, middle), end],
      });
    }
  } else {
    boxes.set(root, boxAround({ x: 0, y: 0 }, sizes.get(root)!));
    const rootKids = kids.get(root) ?? [];
    const leaves = leafCounts(order, kids);
    const total = rootKids.reduce((sum, child) => sum + leaves.get(child)!, 0);
    let count = 0;
    for (let cumulative = 0; count < rootKids.length && cumulative * 2 < total; count++) {
      cumulative += leaves.get(rootKids[count]!)!;
    }
    for (const [side, first] of [
      ["right", rootKids.slice(0, count)],
      ["left", rootKids.slice(count)],
    ] as const) {
      if (first.length === 0) continue;
      const axes = AXES[side];
      const placement = place(root, first, kids, sizes, axes, MINDMAP_GAPS);
      for (const id of order) {
        if (id === root || !placement.level.has(id)) continue;
        sides.set(id, side);
        const center = axes.at(placement.breadth.get(id)!, placement.depth.get(id)!);
        boxes.set(id, boxAround(center, sizes.get(id)!));
      }
    }
    for (const id of order) {
      const parent = parentOf.get(id);
      if (parent === undefined) continue;
      const from = boxes.get(parent)!;
      const to = boxes.get(id)!;
      const right = sides.get(id) === "right";
      const start = {
        x: right ? from.x + from.width : from.x,
        y: from.y + from.height / 2,
      };
      const end = {
        x: right ? to.x : to.x + to.width,
        y: to.y + to.height / 2,
      };
      const dx = end.x - start.x;
      routes.set(id, {
        curve: "bezier",
        points: [
          start,
          { x: start.x + dx / 2, y: start.y },
          { x: end.x - dx / 2, y: end.y },
          end,
        ],
      });
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes.values()) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  const shiftX = MARGIN - minX;
  const shiftY = MARGIN - minY;
  const moved = (point: Point): Point => ({
    x: round(point.x + shiftX),
    y: round(point.y + shiftY),
  });

  const nodes: LaidOutTreeNode[] = order.map((id) => {
    const node = byId.get(id)!;
    const box = boxes.get(id)!;
    return compact({
      id,
      label: node.label,
      type: node.type,
      shape: node.shape,
      x: round(box.x + shiftX),
      y: round(box.y + shiftY),
      width: round(box.width),
      height: round(box.height),
      link: node.link,
      description: node.description,
      meta: node.meta,
      depth: depthOf.get(id)!,
      parent: node.parent,
      side: sides.get(id),
    });
  });

  const edges: LaidOutTreeEdge[] = [];
  for (const id of order) {
    const parent = parentOf.get(id);
    const route = routes.get(id);
    if (parent === undefined || route === undefined) continue;
    edges.push({ id, from: parent, to: id, points: route.points.map(moved), curve: route.curve });
  }

  return compact({
    kind: "tree" as const,
    layout: mindmap ? ("mindmap" as const) : ("tree" as const),
    width: round(maxX - minX + 2 * MARGIN),
    height: round(maxY - minY + 2 * MARGIN),
    title: doc.title,
    nodes,
    edges,
  });
}
