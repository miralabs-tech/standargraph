import { describe, expect, test } from "bun:test";
import { layout } from "../src/layout";
import type { Box, LaidOutGraph } from "../src/layout/types";

async function graphOf(doc: unknown): Promise<LaidOutGraph> {
  const result = await layout(doc);
  if (result.kind !== "graph") throw new Error("expected a graph");
  return result;
}

function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width - 0.01 &&
    b.x < a.x + a.width - 0.01 &&
    a.y < b.y + b.height - 0.01 &&
    b.y < a.y + a.height - 0.01
  );
}

function groupedDoc(): Record<string, unknown> {
  const nodes: Record<string, unknown>[] = [
    { id: "hub", label: "Hub" },
    { id: "free1" },
    { id: "free2" },
  ];
  const members: Record<string, string[]> = {
    g1: ["a1", "a2", "a3"],
    g2: ["b1", "b2"],
    g3: ["c1", "c2", "c3", "c4"],
  };
  for (const [group, ids] of Object.entries(members)) {
    for (const id of ids) nodes.push({ id, group });
  }
  const edges: Record<string, unknown>[] = [
    { from: "hub", to: "free1", label: "uses" },
    { from: "hub", to: "free2" },
    { from: "a1", to: "a2" },
    { from: "b1", to: "c1", label: "calls" },
  ];
  for (const ids of Object.values(members)) {
    for (const id of ids) edges.push({ from: "hub", to: id });
  }
  return {
    version: 1,
    kind: "graph",
    layout: "stress",
    groups: [
      { id: "g1", label: "Group one" },
      { id: "g2", label: "Group two" },
      { id: "g3", label: "Nested", parent: "g1" },
    ],
    nodes,
    edges,
  };
}

describe("stress layout", () => {
  test("is deterministic", async () => {
    const first = await graphOf(groupedDoc());
    const second = await graphOf(groupedDoc());
    expect(second).toEqual(first);
  });

  test("keeps sibling groups and nodes apart", async () => {
    const result = await graphOf(groupedDoc());
    const topGroups = result.groups.filter((group) => group.depth === 0);
    expect(topGroups.length).toBe(2);
    for (let i = 0; i < topGroups.length; i++) {
      for (let j = i + 1; j < topGroups.length; j++) {
        expect(overlaps(topGroups[i]!, topGroups[j]!)).toBe(false);
      }
    }
    for (let i = 0; i < result.nodes.length; i++) {
      for (let j = i + 1; j < result.nodes.length; j++) {
        expect(overlaps(result.nodes[i]!, result.nodes[j]!)).toBe(false);
      }
    }
  });

  test("puts the hub of a star near the middle", async () => {
    const leaves = Array.from({ length: 8 }, (_, i) => `leaf${i}`);
    const result = await graphOf({
      version: 1,
      kind: "graph",
      layout: "stress",
      nodes: [{ id: "hub" }, ...leaves.map((id) => ({ id }))],
      edges: leaves.map((id) => ({ from: "hub", to: id })),
    });
    const center = (node: Box): { x: number; y: number } => ({
      x: node.x + node.width / 2,
      y: node.y + node.height / 2,
    });
    const leafNodes = result.nodes.filter((node) => node.id !== "hub");
    const centroid = {
      x: leafNodes.reduce((sum, node) => sum + center(node).x, 0) / leafNodes.length,
      y: leafNodes.reduce((sum, node) => sum + center(node).y, 0) / leafNodes.length,
    };
    const distance = (node: Box): number => {
      const c = center(node);
      return Math.hypot(c.x - centroid.x, c.y - centroid.y);
    };
    const hub = result.nodes.find((node) => node.id === "hub")!;
    for (const leaf of leafNodes) {
      expect(distance(hub)).toBeLessThan(distance(leaf));
    }
  });

  test("gives edge labels a box", async () => {
    const result = await graphOf(groupedDoc());
    const labelled = result.edges.filter((edge) => edge.label !== undefined);
    expect(labelled.length).toBe(2);
    for (const edge of labelled) expect(edge.labelBox).toBeDefined();
  });

  test("leaves the layered default unchanged", async () => {
    const base = groupedDoc();
    const { layout: _unused, ...withoutLayout } = base;
    const layered = await graphOf({ ...withoutLayout, layout: "layered" });
    const absent = await graphOf(withoutLayout);
    expect(layered).toEqual(absent);
  });
});
