import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { layout, measureText } from "../src/layout";
import { placeEdgeLabels } from "../src/layout/graph";
import { groupTopPadding } from "../src/layout/shared";
import type {
  Box,
  LaidOutGraph,
  LaidOutSequence,
} from "../src/layout/types";

function example(name: string): Record<string, any> {
  return JSON.parse(
    readFileSync(new URL(`../examples/${name}.json`, import.meta.url), "utf8"),
  );
}

async function graphOf(doc: unknown): Promise<LaidOutGraph> {
  const result = await layout(doc);
  if (result.kind !== "graph") throw new Error("expected a graph");
  return result;
}

async function sequenceOf(doc: unknown): Promise<LaidOutSequence> {
  const result = await layout(doc);
  if (result.kind !== "sequence") throw new Error("expected a sequence");
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

function inside(inner: Box, outer: Box): boolean {
  return (
    inner.x >= outer.x - 0.01 &&
    inner.y >= outer.y - 0.01 &&
    inner.x + inner.width <= outer.x + outer.width + 0.01 &&
    inner.y + inner.height <= outer.y + outer.height + 0.01
  );
}

function onBorder(point: { x: number; y: number }, box: Box): boolean {
  const withinOuter =
    point.x >= box.x - 1 &&
    point.x <= box.x + box.width + 1 &&
    point.y >= box.y - 1 &&
    point.y <= box.y + box.height + 1;
  const withinInner =
    point.x > box.x + 1 &&
    point.x < box.x + box.width - 1 &&
    point.y > box.y + 1 &&
    point.y < box.y + box.height - 1;
  return withinOuter && !withinInner;
}

function checkGraph(laid: LaidOutGraph): void {
  const nodes = new Map(laid.nodes.map((node) => [node.id, node]));
  const groups = new Map(laid.groups.map((group) => [group.id, group]));

  for (let i = 0; i < laid.nodes.length; i++) {
    for (let j = i + 1; j < laid.nodes.length; j++) {
      expect(overlaps(laid.nodes[i]!, laid.nodes[j]!)).toBe(false);
    }
  }

  for (const node of laid.nodes) {
    if (node.group !== undefined) {
      expect(inside(node, groups.get(node.group)!)).toBe(true);
    }
  }

  for (const group of laid.groups) {
    expect(inside(group, { x: 0, y: 0, width: laid.width, height: laid.height })).toBe(true);
  }

  for (const edge of laid.edges) {
    expect(edge.points.length).toBeGreaterThanOrEqual(2);
    expect(onBorder(edge.points[0]!, nodes.get(edge.from)!)).toBe(true);
    expect(onBorder(edge.points[edge.points.length - 1]!, nodes.get(edge.to)!)).toBe(true);
  }
}

describe("measureText", () => {
  test("width grows with the text", () => {
    const options = { size: 14, weight: "regular" } as const;
    const widths = ["", "a", "ab", "abc", "abcd"].map(
      (text) => measureText(text, options).width,
    );
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]!).toBeGreaterThan(widths[i - 1]!);
    }
  });

  test("width scales with the size and the weight", () => {
    const small = measureText("Hello", { size: 10, weight: "regular" });
    const large = measureText("Hello", { size: 20, weight: "regular" });
    expect(large.width).toBeCloseTo(small.width * 2, 6);
    const bold = measureText("Hello", { size: 10, weight: "semibold" });
    expect(bold.width).toBeGreaterThan(small.width);
  });

  test("is deterministic", () => {
    const options = { size: 12, weight: "semibold" } as const;
    expect(measureText("Same text", options)).toEqual(
      measureText("Same text", options),
    );
  });

  test("multi-line text uses the widest line and the line count", () => {
    const options = { size: 12, weight: "regular" } as const;
    const single = measureText("a much longer line", options);
    const multi = measureText("a much longer line\nshort", options);
    expect(multi.width).toBe(single.width);
    expect(multi.height).toBeCloseTo(2 * 12 * 1.25, 6);
    expect(single.height).toBeCloseTo(12 * 1.25, 6);
  });

  test("unknown code points use a fallback advance", () => {
    expect(measureText("中", { size: 10, weight: "regular" }).width).toBeGreaterThan(0);
  });
});

describe("graph layout", () => {
  for (const name of ["architecture", "agent-output"]) {
    test(`${name} lays out without overlap and with routed edges`, async () => {
      const laid = await graphOf(example(name));
      expect(laid.nodes.length).toBe(example(name).nodes.length);
      checkGraph(laid);
    });
  }

  test("architecture keeps groups, ids and defaults", async () => {
    const laid = await graphOf(example("architecture"));
    expect(laid.groups.map((group) => group.id)).toEqual([
      "frontend",
      "backend",
      "storage",
    ]);
    expect(laid.edges[0]!.id).toBe("e0");
    expect(laid.edges.every((edge) => edge.directed)).toBe(true);
  });

  test("is deterministic", async () => {
    const first = await layout(example("architecture"));
    const second = await layout(example("architecture"));
    expect(second).toEqual(first);
  });

  test("direction changes the main axis", async () => {
    const doc = {
      version: 1,
      kind: "graph",
      nodes: [{ id: "a" }, { id: "b" }],
      edges: [{ from: "a", to: "b" }],
    };
    const down = await graphOf({ ...doc, direction: "down" });
    const right = await graphOf({ ...doc, direction: "right" });
    expect(down.nodes[1]!.y).toBeGreaterThan(down.nodes[0]!.y);
    expect(right.nodes[1]!.x).toBeGreaterThan(right.nodes[0]!.x);
    expect(down.nodes[0]!.label).toBe("a");
  });

  test("nested groups are ordered parents first with their depth", async () => {
    const laid = await graphOf({
      version: 1,
      kind: "graph",
      groups: [
        { id: "inner", label: "Inner", parent: "outer" },
        { id: "outer", label: "Outer" },
      ],
      nodes: [
        { id: "a", group: "inner" },
        { id: "b", group: "outer" },
        { id: "c" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    });
    expect(laid.groups.map((group) => [group.id, group.depth])).toEqual([
      ["outer", 0],
      ["inner", 1],
    ]);
    const outer = laid.groups[0]!;
    const inner = laid.groups[1]!;
    expect(inside(inner, outer)).toBe(true);
    checkGraph(laid);
  });

  test("precomputed positions are kept exactly", async () => {
    const laid = await graphOf({
      version: 1,
      kind: "graph",
      groups: [
        { id: "outer", label: "Outer" },
        { id: "inner", label: "Inner", parent: "outer" },
      ],
      nodes: [
        { id: "a", group: "inner", position: { x: 100, y: 150 } },
        { id: "b", group: "outer", position: { x: 400, y: 220 } },
        { id: "c", type: "db", position: { x: 40, y: 400 } },
      ],
      edges: [
        { from: "a", to: "b", label: "link" },
        { from: "b", to: "c" },
        { from: "c", to: "c" },
      ],
    });
    const positions = Object.fromEntries(
      laid.nodes.map((node) => [node.id, [node.x, node.y]]),
    );
    expect(positions).toEqual({ a: [100, 150], b: [400, 220], c: [40, 400] });
    checkGraph(laid);
    const outer = laid.groups.find((group) => group.id === "outer")!;
    const inner = laid.groups.find((group) => group.id === "inner")!;
    expect(inside(inner, outer)).toBe(true);
    expect(laid.edges[0]!.points.length).toBe(2);
    expect(laid.edges[0]!.labelBox).toBeDefined();
  });

  test("stress layout keeps edge labels off each other, nodes and group titles", async () => {
    const spokes = [
      ["a1", "alpha"],
      ["a2", "alpha"],
      ["a3", "alpha"],
      ["b1", "beta"],
      ["b2", "beta"],
      ["c1", "gamma"],
      ["c2", "gamma"],
      ["c3", "gamma"],
    ] as const;
    const laid = await graphOf({
      version: 1,
      kind: "graph",
      layout: "stress",
      groups: [
        { id: "alpha", label: "Alpha group" },
        { id: "beta", label: "Beta group" },
        { id: "gamma", label: "Gamma group" },
      ],
      nodes: [
        { id: "hub", label: "Hub" },
        ...spokes.map(([id, group]) => ({ id, group })),
      ],
      edges: [
        ...spokes.map(([id], index) => ({
          from: "hub",
          to: id,
          label: index % 2 === 0 ? "2 close(s)" : "1 close(s)",
        })),
        { from: "a1", to: "hub", label: "1 close(s)" },
        { from: "b1", to: "c1", label: "2 close(s)" },
        { from: "a2", to: "b2", label: "1 close(s)" },
      ],
    });
    const labels = laid.edges.flatMap((edge) =>
      edge.labelBox === undefined ? [] : [edge.labelBox],
    );
    expect(labels.length).toBe(laid.edges.length);
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        expect(overlaps(labels[i]!, labels[j]!)).toBe(false);
      }
    }
    for (const label of labels) {
      for (const node of laid.nodes) {
        expect(overlaps(label, node)).toBe(false);
      }
      for (const group of laid.groups) {
        const title = { ...group, height: groupTopPadding(group.label) };
        expect(overlaps(label, title)).toBe(false);
      }
    }
  });

  test("edge labels of short edges are placed before those of long edges", () => {
    const size = { width: 62, height: 19 };
    const long = {
      ...size,
      anchor: { x: 100, y: 34 },
      path: [
        { x: 0, y: 34 },
        { x: 200, y: 34 },
      ] as const,
    };
    const short = {
      ...size,
      anchor: { x: 100, y: 34 },
      path: [
        { x: 100, y: 14 },
        { x: 100, y: 54 },
      ] as const,
    };
    const [longPlaced, shortPlaced] = placeEdgeLabels([long, short], []);
    expect(overlaps(longPlaced!.box, shortPlaced!.box)).toBe(false);
    expect(shortPlaced!.box.x + shortPlaced!.box.width / 2).toBe(100);
  });

  test("a label moves to a later segment of a polyline when the first is blocked", () => {
    const request = {
      width: 62,
      height: 19,
      anchor: { x: 100, y: 0 },
      path: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
    };
    const [placed] = placeEdgeLabels(
      [request],
      [{ x: -50, y: -30, width: 200, height: 60 }],
    );
    expect(placed!.box.x + placed!.box.width / 2).toBe(100);
    expect(placed!.box.y + placed!.box.height / 2).toBe(40);
    expect(placed!.leader).toBeUndefined();
  });

  test("a blocked label falls back to a side position with a leader line", () => {
    const strip = { x: -50, y: -30, width: 300, height: 60 };
    const request = {
      width: 62,
      height: 19,
      anchor: { x: 100, y: 0 },
      path: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      ],
      allowLeader: true,
    };
    const [placed] = placeEdgeLabels([request], [strip]);
    expect(overlaps(placed!.box, strip)).toBe(false);
    expect(placed!.leader).toHaveLength(2);
    expect(placed!.leader![0]).toEqual({ x: 100, y: 0 });
    expect(placed!.leader![1]).toEqual({ x: 100, y: placed!.box.y });
    const [flat] = placeEdgeLabels([{ ...request, allowLeader: false }], [strip]);
    expect(flat!.leader).toBeUndefined();
  });

  test("a label whose midpoint sits on another edge's path moves off every other path", () => {
    const own = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ];
    const other = [
      { x: 100, y: -50 },
      { x: 100, y: 50 },
    ];
    const request = {
      width: 62,
      height: 19,
      anchor: { x: 100, y: 0 },
      path: own,
      allowLeader: true,
    };
    const [placed] = placeEdgeLabels([request, undefined], [], [own, other]);
    const box = placed!.box;
    expect(box.x + box.width <= 100 || box.x >= 100).toBe(true);
    expect(placed!.leader).toBeUndefined();
  });

  test("a label's own path does not count against its placement", () => {
    const own = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ];
    const request = {
      width: 62,
      height: 19,
      anchor: { x: 100, y: 0 },
      path: own,
      allowLeader: true,
    };
    const [placed] = placeEdgeLabels([request], [], [own]);
    expect(placed!.box.x + placed!.box.width / 2).toBe(100);
    expect(placed!.box.y + placed!.box.height / 2).toBe(0);
  });

  test("a label with no clear spot along its path takes a side position that crosses no other path", () => {
    const own = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ];
    const band = [
      { x: -20, y: 0 },
      { x: 220, y: 0 },
    ];
    const request = {
      width: 62,
      height: 19,
      anchor: { x: 100, y: 0 },
      path: own,
      allowLeader: true,
    };
    const [placed] = placeEdgeLabels([request], [], [own, band]);
    const box = placed!.box;
    expect(box.y > 0 || box.y + box.height < 0).toBe(true);
    expect(placed!.leader).toHaveLength(2);
  });

  test("layered output carries no label leader", async () => {
    const laid = await graphOf({
      version: 1,
      kind: "graph",
      nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
      edges: [
        { from: "a", to: "b", label: "one" },
        { from: "b", to: "c", label: "two" },
      ],
    });
    for (const edge of laid.edges) expect(edge.labelLeader).toBeUndefined();
  });
});

describe("sequence layout", () => {
  test("protocol example", async () => {
    const doc = example("protocol");
    const laid = await sequenceOf(doc);
    expect(laid.participants.length).toBe(doc.participants.length);
    expect(laid.messages.length).toBe(doc.messages.length);

    for (let i = 1; i < laid.participants.length; i++) {
      expect(laid.participants[i]!.lifelineX).toBeGreaterThan(
        laid.participants[i - 1]!.lifelineX,
      );
      const previous = laid.participants[i - 1]!;
      expect(laid.participants[i]!.x - (previous.x + previous.width)).toBeGreaterThanOrEqual(40);
    }

    for (let i = 1; i < laid.messages.length; i++) {
      expect(laid.messages[i]!.y).toBeGreaterThan(laid.messages[i - 1]!.y);
    }

    const columns = new Map(
      laid.participants.map((participant) => [participant.id, participant.lifelineX]),
    );
    const lines = laid.participants.map((participant) => participant.lifelineX).sort((a, b) => a - b);
    for (const message of laid.messages) {
      expect(message.x1).toBe(columns.get(message.from)!);
      expect(message.x2).toBe(columns.get(message.to)!);
      expect(message.self).toBe(message.from === message.to);
      if (message.labelBox === undefined) continue;
      const left = message.self ? message.x1 : Math.min(message.x1, message.x2);
      const next = lines.find((line) => line > left);
      const right = message.self ? (next ?? laid.width) : Math.max(message.x1, message.x2);
      expect(message.labelBox.x).toBeGreaterThanOrEqual(left);
      expect(message.labelBox.x + message.labelBox.width).toBeLessThanOrEqual(right);
    }

    expect(laid.lifelineBottom).toBeGreaterThan(laid.messages.at(-1)!.y);
    expect(laid.height).toBeGreaterThan(laid.lifelineBottom);
    expect(laid.messages.some((message) => message.self)).toBe(true);
    expect(laid.messages.some((message) => message.style === "reply")).toBe(true);
  });

  test("a wide label between non-adjacent participants widens the gaps", async () => {
    const label = "a very long message label spanning two columns".repeat(2);
    const base = {
      version: 1,
      kind: "sequence",
      participants: [{ id: "a" }, { id: "b" }, { id: "c" }],
    };
    const narrow = await sequenceOf({
      ...base,
      messages: [{ from: "a", to: "c", label: "x" }],
    });
    const wide = await sequenceOf({
      ...base,
      messages: [{ from: "a", to: "c", label }],
    });
    const spanOf = (laid: LaidOutSequence) =>
      laid.participants[2]!.lifelineX - laid.participants[0]!.lifelineX;
    expect(spanOf(wide)).toBeGreaterThan(spanOf(narrow));
    const box = wide.messages[0]!.labelBox!;
    expect(box.x).toBeGreaterThanOrEqual(wide.messages[0]!.x1);
    expect(box.x + box.width).toBeLessThanOrEqual(wide.messages[0]!.x2);
  });

  test("a document without messages still lays out", async () => {
    const laid = await sequenceOf({
      version: 1,
      kind: "sequence",
      participants: [{ id: "solo" }],
      messages: [],
    });
    expect(laid.messages).toEqual([]);
    expect(laid.lifelineBottom).toBeGreaterThan(laid.participants[0]!.y);
  });
});

describe("validation", () => {
  test("an invalid document rejects with the validation message", async () => {
    const doc = {
      version: 1,
      kind: "graph",
      nodes: [{ id: "a" }],
      edges: [{ from: "a", to: "missing" }],
    };
    await expect(layout(doc)).rejects.toThrow(/not a known node id/);
    await expect(layout(doc)).rejects.toThrow(/\/edges\/0\/to/);
  });

  test("a non-object rejects", async () => {
    await expect(layout(42)).rejects.toThrow(/Expected a JSON object/);
  });
});
