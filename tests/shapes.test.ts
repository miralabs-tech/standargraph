import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SHAPES, validate } from "../src/format";
import { layout } from "../src/layout";
import {
  clipEnds,
  clipToShape,
  outline,
  shapeSize,
} from "../src/layout/shapes";
import { boxSize } from "../src/layout/shared";
import type { Box, LaidOutGraph } from "../src/layout/types";
import { renderSvg } from "../src/svg";

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

describe("schema", () => {
  test("every shape validates and an unknown one does not", () => {
    for (const shape of SHAPES) {
      expect(
        validate({ version: 1, kind: "graph", nodes: [{ id: "a", shape }] }).ok,
      ).toBe(true);
    }
    const result = validate({
      version: 1,
      kind: "graph",
      nodes: [{ id: "a", shape: "star" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]!.path).toBe("/nodes/0/shape");
      expect(result.errors[0]!.message).toContain("diamond");
    }
  });

  test("the flowchart example is valid", () => {
    expect(validate(example("deploy-flowchart")).ok).toBe(true);
  });
});

describe("shapeSize", () => {
  test("box and rect keep the current size", () => {
    const base = boxSize("Hello", "kind", 80);
    expect(shapeSize(undefined, "Hello", "kind", 80)).toEqual(base);
    expect(shapeSize("box", "Hello", "kind", 80)).toEqual(base);
    expect(shapeSize("rect", "Hello", "kind", 80)).toEqual(base);
  });

  test("each shape grows from the box size as documented", () => {
    const base = boxSize("Hello", undefined, 80);
    expect(shapeSize("pill", "Hello", undefined, 80)).toEqual({
      width: Math.ceil(base.width + base.height / 2),
      height: base.height,
    });
    expect(shapeSize("hexagon", "Hello", undefined, 80)).toEqual({
      width: Math.ceil(base.width + base.height / 2),
      height: base.height,
    });
    expect(shapeSize("parallelogram", "Hello", undefined, 80)).toEqual({
      width: Math.ceil(base.width + base.height / 3),
      height: base.height,
    });
    expect(shapeSize("cylinder", "Hello", undefined, 80)).toEqual({
      width: base.width,
      height: base.height + 14,
    });
    expect(shapeSize("document", "Hello", undefined, 80)).toEqual({
      width: base.width,
      height: base.height + 6,
    });
    expect(shapeSize("subroutine", "Hello", undefined, 80)).toEqual({
      width: base.width + 16,
      height: base.height,
    });
  });

  test("circle is square and the round shapes keep their minimums", () => {
    const circle = shapeSize("circle", "A", undefined, 80);
    expect(circle.width).toBe(circle.height);
    expect(circle.width).toBeGreaterThanOrEqual(48);
    const diamond = shapeSize("diamond", "A", undefined, 80);
    expect(diamond.width).toBeGreaterThanOrEqual(80);
    expect(diamond.height).toBeGreaterThanOrEqual(48);
    const ellipse = shapeSize("ellipse", "A", undefined, 80);
    expect(ellipse.width).toBeGreaterThanOrEqual(80);
    expect(ellipse.height).toBeGreaterThanOrEqual(40);
  });

  test("a long label widens a diamond beyond its box", () => {
    const label = "A rather long decision label";
    const diamond = shapeSize("diamond", label, undefined, 80);
    expect(diamond.width).toBeGreaterThan(boxSize(label, undefined, 80).width);
  });
});

describe("outline and clipping", () => {
  const box: Box = { x: 100, y: 50, width: 120, height: 60 };

  test("rectangular shapes have no outline", () => {
    for (const shape of ["box", "rect", "document", "subroutine", undefined] as const) {
      expect(outline(shape, box)).toBeUndefined();
    }
  });

  test("segment counts follow the documented values", () => {
    expect(outline("diamond", box)).toHaveLength(4);
    expect(outline("hexagon", box)).toHaveLength(6);
    expect(outline("parallelogram", box)).toHaveLength(4);
    expect(outline("circle", { ...box, width: 60 })).toHaveLength(48);
    expect(outline("ellipse", box)).toHaveLength(48);
    expect(outline("pill", box)).toHaveLength(26);
    expect(outline("cylinder", box)).toHaveLength(50);
  });

  test("an edge ends on the diamond contour, not on its box", () => {
    const centered = clipEnds(
      [
        { x: 160, y: 0 },
        { x: 160, y: 50 },
      ],
      undefined,
      box,
      "diamond",
      box,
    );
    expect(centered[1]!.x).toBeCloseTo(160, 6);
    expect(centered[1]!.y).toBeCloseTo(50, 6);
    const offCenter = clipEnds(
      [
        { x: 130, y: 0 },
        { x: 130, y: 50 },
      ],
      undefined,
      box,
      "diamond",
      box,
    );
    expect(offCenter[1]!.x).toBeCloseTo(130, 6);
    expect(offCenter[1]!.y).toBeCloseTo(50 + (30 / 60) * 30, 6);
  });

  test("the start of an edge is clipped too", () => {
    const circleBox = { x: 130, y: 50, width: 60, height: 60 };
    const clipped = clipEnds(
      [
        { x: 160, y: 110 },
        { x: 160, y: 200 },
      ],
      "circle",
      circleBox,
      undefined,
      box,
    );
    expect(clipped[0]!.x).toBeCloseTo(160, 6);
    expect(clipped[0]!.y).toBeCloseTo(110, 6);
    expect(clipped[1]).toEqual({ x: 160, y: 200 });
  });

  test("rectangular shapes leave the points untouched", () => {
    const points = [
      { x: 160, y: 0 },
      { x: 160, y: 50 },
    ];
    expect(clipEnds(points, "box", box, "rect", box)).toEqual(points);
  });

  test("clipToShape follows the contour and falls back to the rectangle", () => {
    const up = { x: 160, y: -100 };
    expect(clipToShape("diamond", box, up).y).toBeCloseTo(50, 6);
    expect(clipToShape("box", box, up).y).toBeCloseTo(50, 6);
    const diagonal = { x: 260, y: 140 };
    const onDiamond = clipToShape("diamond", box, diagonal);
    const onBox = clipToShape("box", box, diagonal);
    expect(onDiamond.x).toBeLessThan(onBox.x);
    expect(onDiamond.x).toBeGreaterThan(160);
  });
});

describe("layout and rendering", () => {
  test("a document without shape emits no shape", async () => {
    const laid = await graphOf({
      version: 1,
      kind: "graph",
      nodes: [{ id: "a" }, { id: "b" }],
      edges: [{ from: "a", to: "b" }],
    });
    for (const node of laid.nodes) expect("shape" in node).toBe(false);
  });

  test("the flowchart lays out with sized nodes and edges that meet the boxes", async () => {
    const laid = await graphOf(example("deploy-flowchart"));
    const byId = new Map(laid.nodes.map((node) => [node.id, node]));
    const green = byId.get("green")!;
    expect(green.shape).toBe("diamond");
    const size = shapeSize("diamond", "Green?", undefined, 80);
    expect(green.width).toBe(size.width);
    expect(green.height).toBe(size.height);
    const toGreen = laid.edges.find((edge) => edge.to === "green")!;
    const end = toGreen.points[toGreen.points.length - 1]!;
    expect(end.y).toBeGreaterThanOrEqual(green.y - 0.01);
    expect(end.y).toBeLessThanOrEqual(green.y + green.height + 0.01);
  });

  test("precomputed positions use the shape size and contour", async () => {
    const laid = await graphOf({
      version: 1,
      kind: "graph",
      nodes: [
        { id: "a", shape: "circle", position: { x: 0, y: 0 } },
        { id: "b", shape: "diamond", position: { x: 300, y: 0 } },
      ],
      edges: [{ from: "a", to: "b" }],
    });
    const a = laid.nodes[0]!;
    const b = laid.nodes[1]!;
    expect(a.width).toBe(a.height);
    const edge = laid.edges[0]!;
    expect(edge.points[0]!.x).toBeCloseTo(a.x + a.width, 1);
    expect(edge.points[1]!.x).toBeCloseTo(b.x, 1);
  });

  test("every shape renders its own element with data attributes", async () => {
    const nodes = SHAPES.map((shape) => ({ id: shape, label: shape, shape }));
    const svg = renderSvg(await graphOf({ version: 1, kind: "graph", nodes }));
    const section = (id: string): string => {
      const start = svg.indexOf(`data-kind="node" data-id="${id}"`);
      expect(start).toBeGreaterThan(-1);
      return svg.slice(start, svg.indexOf("</g>", start));
    };
    expect(section("box")).toContain('<rect class="sg-node"');
    expect(section("box")).toContain('rx="8"');
    expect(section("rect")).toContain('rx="0"');
    expect(section("pill")).toMatch(/rx="[\d.]+"/);
    expect(section("diamond")).toContain("<polygon");
    expect(section("hexagon")).toContain("<polygon");
    expect(section("parallelogram")).toContain("<polygon");
    expect(section("circle")).toContain("<circle");
    expect(section("ellipse")).toContain("<ellipse");
    expect(section("cylinder")).toContain("<path");
    expect(section("cylinder")).toContain('class="sg-node-detail"');
    expect(section("document")).toContain("<path");
    expect(section("subroutine").split('class="sg-node-detail"').length - 1).toBe(2);
    for (const shape of SHAPES) {
      expect(section(shape)).toContain(`data-shape="${shape}"`);
    }
    expect(svg).toContain(".sg-node-detail{fill:none;stroke:var(--sg-node-stroke)}");
    expect(svg).toContain('data-diagram="graph"');
  });

  test("detail strokes carry fill none and never the node class", async () => {
    const svg = renderSvg(await graphOf(example("deploy-flowchart")));
    const details = [...svg.matchAll(/<[a-z]+ class="sg-node-detail"[^>]*>/g)];
    expect(details.length).toBe(3);
    for (const match of details) {
      expect(match[0]).toContain('fill="none"');
      expect(match[0]).not.toContain("sg-node ");
    }
  });

  test("confidence and coverage apply to the shape geometry", async () => {
    const svg = renderSvg(
      await graphOf({
        version: 1,
        kind: "graph",
        nodes: [
          {
            id: "d",
            shape: "diamond",
            type: "decision",
            meta: { provenance: { source: "s", confidence: "unknown" }, coverage: 0.5 },
          },
        ],
      }),
    );
    expect(svg).toContain('<polygon class="sg-node sg-unknown"');
    expect(svg).toContain('stroke-dasharray="2 3"');
    expect(svg).toMatch(/<clipPath id="sg-clip-0"><polygon points="/);
    expect(svg).toContain('data-type="decision" data-confidence="unknown" data-shape="diamond"');
  });

  test("data attributes follow the documented order on every item", async () => {
    const svg = renderSvg(
      await graphOf({
        version: 1,
        kind: "graph",
        groups: [{ id: "g", label: "G" }],
        nodes: [{ id: "a", group: "g" }, { id: "b" }],
        edges: [{ from: "a", to: "b", type: "calls", directed: false }],
      }),
    );
    expect(svg).toContain('<g data-kind="group" data-id="g" data-depth="0">');
    expect(svg).toContain('<g data-kind="node" data-id="a" data-shape="box">');
    expect(svg).toContain(
      '<g data-kind="edge" data-id="e0" data-type="calls" data-from="a" data-to="b" data-directed="false">',
    );
    const sequence = renderSvg(
      await layout({
        version: 1,
        kind: "sequence",
        participants: [{ id: "p", type: "client" }, { id: "q" }],
        messages: [{ from: "p", to: "q", style: "async" }],
      }),
    );
    expect(sequence).toContain('data-diagram="sequence"');
    expect(sequence).toContain('<g data-kind="participant" data-id="p" data-type="client">');
    expect(sequence).toContain(
      '<g data-kind="message" data-id="0" data-from="p" data-to="q" data-style="async">',
    );
  });
});
