import type { ElkNode } from "elkjs/lib/elk.bundled.js";
import type { GraphDocument } from "../format";
import { elkLayout } from "./elk";
import { groupLabelWidth, orderGroups } from "./graph";
import { groupTopPadding, MARGIN, PAD_X } from "./shared";
import { shapeSize } from "./shapes";
import type { Box, Point } from "./types";

const DESIRED_EDGE_LENGTH = 200;
const SIBLING_GAP = 20;
const SEPARATION_PASSES = 200;

type Item = { key: string; width: number; height: number };
type Placed = Map<string, Point>;

function hasOverlap(boxes: readonly Box[]): boolean {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (
        a.x < b.x + b.width + SIBLING_GAP &&
        b.x < a.x + a.width + SIBLING_GAP &&
        a.y < b.y + b.height + SIBLING_GAP &&
        b.y < a.y + a.height + SIBLING_GAP
      ) {
        return true;
      }
    }
  }
  return false;
}

function separate(boxes: Box[]): void {
  for (let pass = 0; pass < SEPARATION_PASSES; pass++) {
    if (!hasOverlap(boxes)) return;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const dx = Math.min(
          a.x + a.width + SIBLING_GAP - b.x,
          b.x + b.width + SIBLING_GAP - a.x,
        );
        const dy = Math.min(
          a.y + a.height + SIBLING_GAP - b.y,
          b.y + b.height + SIBLING_GAP - a.y,
        );
        if (dx <= 0 || dy <= 0) continue;
        if (dx <= dy) {
          const sign = a.x + a.width / 2 <= b.x + b.width / 2 ? 1 : -1;
          a.x -= (sign * dx) / 2;
          b.x += (sign * dx) / 2;
        } else {
          const sign = a.y + a.height / 2 <= b.y + b.height / 2 ? 1 : -1;
          a.y -= (sign * dy) / 2;
          b.y += (sign * dy) / 2;
        }
      }
    }
  }
}

async function placeLevel(
  items: readonly Item[],
  pairs: readonly [string, string][],
): Promise<{ placed: Placed; width: number; height: number }> {
  const root: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "stress",
      "elk.stress.desiredEdgeLength": String(DESIRED_EDGE_LENGTH),
      "elk.randomSeed": "1",
    },
    children: items.map((item) => ({
      id: item.key,
      width: item.width,
      height: item.height,
    })),
    edges: pairs.map(([from, to], index) => ({
      id: `e${index}`,
      sources: [from],
      targets: [to],
    })),
  };
  const result = await elkLayout(root);
  const byKey = new Map((result.children ?? []).map((child) => [child.id, child]));
  const boxes: Box[] = items.map((item) => {
    const child = byKey.get(item.key);
    return {
      x: child?.x ?? 0,
      y: child?.y ?? 0,
      width: item.width,
      height: item.height,
    };
  });
  separate(boxes);
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  const placed: Placed = new Map();
  items.forEach((item, index) => {
    const box = boxes[index]!;
    placed.set(item.key, { x: box.x - minX, y: box.y - minY });
  });
  return { placed, width: maxX - minX, height: maxY - minY };
}

export async function stressPositions(
  doc: GraphDocument,
): Promise<Map<string, Point>> {
  const ordered = orderGroups(doc.groups ?? []);
  const groupById = new Map(ordered.map(({ group }) => [group.id, group]));

  const pathOf = new Map<string, string[]>();
  for (const node of doc.nodes) {
    const path: string[] = [];
    const seen = new Set<string>();
    let current = node.group;
    while (current !== undefined && !seen.has(current)) {
      const group = groupById.get(current);
      if (group === undefined) break;
      seen.add(current);
      path.unshift(current);
      current = group.parent;
    }
    pathOf.set(node.id, path);
  }

  const populated = new Set<string>();
  for (const path of pathOf.values()) for (const id of path) populated.add(id);

  const nodeKey = (id: string): string => `n:${id}`;
  const itemOf = (nodeId: string, level: string | undefined): string | undefined => {
    const path = pathOf.get(nodeId)!;
    if (level === undefined) {
      return path.length > 0 ? `g:${path[0]}` : nodeKey(nodeId);
    }
    const index = path.indexOf(level);
    if (index === -1) return undefined;
    return index + 1 < path.length ? `g:${path[index + 1]}` : nodeKey(nodeId);
  };

  const sizeOf = new Map<string, { width: number; height: number }>();
  for (const node of doc.nodes) {
    sizeOf.set(
      nodeKey(node.id),
      shapeSize(node.shape, node.label ?? node.id, node.type, 80),
    );
  }

  const levelItems = (level: string | undefined): Item[] => {
    const items: Item[] = [];
    for (const node of doc.nodes) {
      if (pathOf.get(node.id)!.at(-1) !== level) continue;
      const size = sizeOf.get(nodeKey(node.id))!;
      items.push({ key: nodeKey(node.id), ...size });
    }
    for (const { group } of ordered) {
      if (group.parent === level && populated.has(group.id)) {
        const size = sizeOf.get(`g:${group.id}`)!;
        items.push({ key: `g:${group.id}`, ...size });
      }
    }
    return items;
  };

  const levelPairs = (level: string | undefined): [string, string][] => {
    const pairs: [string, string][] = [];
    const seen = new Set<string>();
    for (const edge of doc.edges ?? []) {
      if (edge.from === edge.to) continue;
      const a = itemOf(edge.from, level);
      const b = itemOf(edge.to, level);
      if (a === undefined || b === undefined || a === b) continue;
      const id = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (seen.has(id)) continue;
      seen.add(id);
      pairs.push([a, b]);
    }
    return pairs;
  };

  const inner = new Map<string, Placed>();
  const byDepthDesc = ordered
    .filter(({ group }) => populated.has(group.id))
    .sort((a, b) => b.depth - a.depth);

  for (const { group } of byDepthDesc) {
    const result = await placeLevel(levelItems(group.id), levelPairs(group.id));
    inner.set(group.id, result.placed);
    const top = groupTopPadding(group.label);
    sizeOf.set(`g:${group.id}`, {
      width: Math.max(
        result.width + 2 * PAD_X,
        Math.ceil(groupLabelWidth(group) + 2 * PAD_X),
      ),
      height: result.height + top + PAD_X,
    });
  }

  const rootResult = await placeLevel(levelItems(undefined), levelPairs(undefined));
  inner.set("", rootResult.placed);

  const positions = new Map<string, Point>();
  const place = (level: string | undefined, origin: Point): void => {
    const placed = inner.get(level ?? "")!;
    for (const [key, offset] of placed) {
      const absolute = { x: origin.x + offset.x, y: origin.y + offset.y };
      if (key.startsWith("n:")) {
        positions.set(key.slice(2), absolute);
      } else {
        const id = key.slice(2);
        const group = groupById.get(id)!;
        place(id, {
          x: absolute.x + PAD_X,
          y: absolute.y + groupTopPadding(group.label),
        });
      }
    }
  };
  place(undefined, { x: MARGIN, y: MARGIN });
  return positions;
}
