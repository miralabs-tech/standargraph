import { describe, expect, test } from "bun:test";
import { layout } from "../src/layout";
import { routeAroundObstacles } from "../src/layout/route";
import type { Box, LaidOutGraph, Point } from "../src/layout/types";

function insideSegment(a: Point, b: Point, box: Box): boolean {
  const steps = 200;
  for (let i = 1; i < steps; i++) {
    const x = a.x + ((b.x - a.x) * i) / steps;
    const y = a.y + ((b.y - a.y) * i) / steps;
    if (
      x > box.x + 0.01 &&
      x < box.x + box.width - 0.01 &&
      y > box.y + 0.01 &&
      y < box.y + box.height - 0.01
    ) {
      return true;
    }
  }
  return false;
}

function inflated(box: Box, margin: number): Box {
  return {
    x: box.x - margin,
    y: box.y - margin,
    width: box.width + 2 * margin,
    height: box.height + 2 * margin,
  };
}

async function graphOf(doc: unknown): Promise<LaidOutGraph> {
  const result = await layout(doc);
  if (result.kind !== "graph") throw new Error("expected a graph");
  return result;
}

describe("routeAroundObstacles", () => {
  const wall: Box = { x: 40, y: -50, width: 20, height: 100 };

  test("a free segment stays straight", () => {
    const from = { x: 0, y: 200 };
    const to = { x: 100, y: 200 };
    expect(routeAroundObstacles(from, to, [wall])).toEqual([from, to]);
  });

  test("a box across the segment is rounded through its corners", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 100, y: 0 };
    const route = routeAroundObstacles(from, to, [wall]);
    expect(route.length).toBeGreaterThan(2);
    expect(route[0]).toEqual(from);
    expect(route[route.length - 1]).toEqual(to);
    const box = inflated(wall, 12);
    const corners = [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
      { x: box.x, y: box.y + box.height },
    ];
    for (const point of route.slice(1, -1)) {
      expect(corners).toContainEqual(point);
    }
    for (let i = 0; i < route.length - 1; i++) {
      expect(insideSegment(route[i]!, route[i + 1]!, box)).toBe(false);
    }
  });

  test("is deterministic", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 100, y: 0 };
    const first = routeAroundObstacles(from, to, [wall]);
    const second = routeAroundObstacles(from, to, [wall]);
    expect(second).toEqual(first);
  });

  test("falls back to a straight line when no path exists", () => {
    const from = { x: 50, y: 0 };
    const to = { x: 200, y: 0 };
    expect(routeAroundObstacles(from, to, [wall])).toEqual([from, to]);
  });

  test("a degenerate segment stays straight", () => {
    const point = { x: 0, y: 0 };
    expect(routeAroundObstacles(point, { ...point }, [wall])).toEqual([
      point,
      point,
    ]);
  });
});

describe("stress routing around groups", () => {
  function doc(): Record<string, unknown> {
    return {
      version: 1,
      kind: "graph",
      layout: "stress",
      groups: [
        { id: "A", label: "A" },
        { id: "B", label: "B" },
        { id: "C", label: "C" },
        { id: "P", label: "Parent" },
        { id: "S", label: "Sub", parent: "P" },
      ],
      nodes: [
        { id: "a1", group: "A" },
        { id: "a2", group: "A" },
        { id: "b1", group: "B" },
        { id: "b2", group: "B" },
        { id: "c1", group: "C" },
        { id: "c2", group: "C" },
        { id: "s1", group: "S" },
        { id: "p1", group: "P" },
      ],
      edges: [
        { from: "a1", to: "b1" },
        { from: "b2", to: "c1" },
        { from: "a1", to: "c1", label: "far" },
        { from: "c1", to: "a1" },
        { from: "a2", to: "c2" },
        { from: "a1", to: "a2" },
        { from: "s1", to: "p1" },
        { from: "s1", to: "a1" },
      ],
    };
  }

  test("an edge never crosses a group it does not belong to", async () => {
    const graph = await graphOf(doc());
    const parents: Record<string, string[]> = {
      a1: ["A"],
      a2: ["A"],
      b1: ["B"],
      b2: ["B"],
      c1: ["C"],
      c2: ["C"],
      s1: ["S", "P"],
      p1: ["P"],
    };
    for (const edge of graph.edges) {
      const own = new Set([...parents[edge.from]!, ...parents[edge.to]!]);
      for (const group of graph.groups) {
        if (own.has(group.id)) continue;
        for (let i = 0; i < edge.points.length - 1; i++) {
          expect(
            insideSegment(edge.points[i]!, edge.points[i + 1]!, group),
          ).toBe(false);
        }
      }
    }
  });

  test("edges inside one group and to a parent stay straight", async () => {
    const graph = await graphOf(doc());
    const inside = graph.edges.find((e) => e.from === "a1" && e.to === "a2");
    expect(inside?.points.length).toBe(2);
    const toParent = graph.edges.find((e) => e.from === "s1" && e.to === "p1");
    expect(toParent?.points.length).toBe(2);
  });

  test("is deterministic", async () => {
    const first = await graphOf(doc());
    const second = await graphOf(doc());
    expect(second.edges.map((e) => e.points)).toEqual(
      first.edges.map((e) => e.points),
    );
  });
});
