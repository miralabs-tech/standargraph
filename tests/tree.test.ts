import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createView, HOVERABLE, sceneItemCount } from "../src/core/view";
import { type TreeDocument, validate } from "../src/format";
import { layout } from "../src/layout";
import { layoutTree } from "../src/layout/tree";
import { MARGIN } from "../src/layout/shared";
import type { Box, LaidOutTree } from "../src/layout/types";
import { renderSvg } from "../src/svg";

function example(name: string): Record<string, any> {
  return JSON.parse(readFileSync(new URL(`../examples/${name}.json`, import.meta.url), "utf8"));
}

function small(): Record<string, any> {
  return {
    version: 1,
    kind: "tree",
    nodes: [
      { id: "root", label: "Root" },
      { id: "a", label: "A", parent: "root" },
      { id: "b", label: "B", parent: "root" },
      { id: "a1", label: "A1", parent: "a" },
    ],
  };
}

function errorsOf(input: unknown): { path: string; message: string }[] {
  const result = validate(input);
  if (result.ok) throw new Error("expected validation to fail");
  return result.errors;
}

async function sceneOf(input: unknown): Promise<LaidOutTree> {
  const scene = await layout(input);
  if (scene.kind !== "tree") throw new Error("expected a tree");
  return scene;
}

function node(scene: LaidOutTree, id: string) {
  const found = scene.nodes.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`missing node ${id}`);
  return found;
}

function overlap(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width - 0.01 &&
    b.x < a.x + a.width - 0.01 &&
    a.y < b.y + b.height - 0.01 &&
    b.y < a.y + a.height - 0.01
  );
}

function chain(length: number): Record<string, any> {
  return {
    version: 1,
    kind: "tree",
    nodes: Array.from({ length }, (_, index) => ({
      id: `n${index}`,
      label: `N${index}`,
      ...(index === 0 ? {} : { parent: `n${index - 1}` }),
    })),
  };
}

describe("validation", () => {
  test("the examples and a small tree are valid", () => {
    expect(validate(example("roadmap-mindmap")).ok).toBe(true);
    expect(validate(example("repo-tree")).ok).toBe(true);
    expect(validate(small()).ok).toBe(true);
  });

  test("a child may precede its parent", () => {
    const doc = small();
    doc.nodes.reverse();
    expect(validate(doc).ok).toBe(true);
  });

  test("a tree document needs at least one node and a label per node", () => {
    const doc = small();
    doc.nodes = [];
    expect(errorsOf(doc).map((error) => error.path)).toEqual(["/nodes"]);
    const unlabeled = small();
    delete unlabeled.nodes[1].label;
    expect(errorsOf(unlabeled).map((error) => error.path)).toContain("/nodes/1/label");
  });

  test("duplicate ids and unknown parents", () => {
    const doc = small();
    doc.nodes.push({ id: "a", label: "again", parent: "root" }, { id: "x", label: "X", parent: "ghost" });
    expect(errorsOf(doc)).toEqual([
      { path: "/nodes/4/id", message: 'Duplicate node id "a"' },
      { path: "/nodes/5/parent", message: 'Parent node "ghost" is not a known node id' },
    ]);
  });

  test("a parent cycle", () => {
    const doc = small();
    doc.nodes[0].parent = "a1";
    expect(errorsOf(doc)).toEqual([
      { path: "/nodes/0/parent", message: "Node parent cycle: root -> a1 -> a -> root" },
      { path: "/nodes", message: "A tree needs exactly one root (a node without parent): found none" },
    ]);
  });

  test("a tree needs exactly one root", () => {
    const none = small();
    none.nodes[0].parent = "a";
    expect(errorsOf(none)).toContainEqual({
      path: "/nodes",
      message: "A tree needs exactly one root (a node without parent): found none",
    });
    const second = small();
    second.nodes.push({ id: "other", label: "Other" });
    expect(errorsOf(second)).toEqual([
      {
        path: "/nodes/4",
        message: 'Second root "other": a tree has exactly one node without parent (first: "root")',
      },
    ]);
  });

  test("direction does not apply to a mindmap", () => {
    const doc = small();
    doc.layout = "mindmap";
    doc.direction = "right";
    expect(errorsOf(doc)).toEqual([
      { path: "/direction", message: 'direction does not apply to layout "mindmap"' },
    ]);
    doc.layout = "tree";
    expect(validate(doc).ok).toBe(true);
  });

  test("an unknown layout or shape names the allowed values", () => {
    const doc = small();
    doc.layout = "radial";
    doc.nodes[1].shape = "blob";
    expect(errorsOf(doc)).toEqual([
      { path: "/layout", message: "Expected one of tree, mindmap" },
      {
        path: "/nodes/1/shape",
        message:
          "Expected one of box, rect, pill, diamond, circle, ellipse, hexagon, parallelogram, cylinder, document, subroutine",
      },
    ]);
  });

  test("an unknown kind lists the tree kind", () => {
    expect(errorsOf({ version: 1, kind: "pie" })[0]!.message).toContain('"tree"');
  });
});

describe("layout tree", () => {
  test("nodes come in pre-order with depth, parent and one edge per child", async () => {
    const scene = await sceneOf(small());
    expect(scene.layout).toBe("tree");
    expect(scene.nodes.map((entry) => `${entry.id}:${entry.depth}`)).toEqual([
      "root:0",
      "a:1",
      "a1:2",
      "b:1",
    ]);
    expect(node(scene, "a1").parent).toBe("a");
    expect(node(scene, "root").parent).toBeUndefined();
    expect(scene.nodes.every((entry) => entry.side === undefined)).toBe(true);
    expect(scene.edges.map((edge) => `${edge.from}>${edge.to}:${edge.id}:${edge.curve}`)).toEqual([
      "root>a:a:elbow",
      "a>a1:a1:elbow",
      "root>b:b:elbow",
    ]);
  });

  test("the minimum is at the margin and the bounds close on it", async () => {
    const scene = await sceneOf(example("repo-tree"));
    expect(Math.min(...scene.nodes.map((entry) => entry.x))).toBe(MARGIN);
    expect(Math.min(...scene.nodes.map((entry) => entry.y))).toBe(MARGIN);
    expect(Math.max(...scene.nodes.map((entry) => entry.x + entry.width)) + MARGIN).toBeCloseTo(
      scene.width,
      1,
    );
    expect(Math.max(...scene.nodes.map((entry) => entry.y + entry.height)) + MARGIN).toBeCloseTo(
      scene.height,
      1,
    );
  });

  test("a parent is centered over its first and last child and levels are aligned", async () => {
    const scene = await sceneOf(small());
    const root = node(scene, "root");
    const a = node(scene, "a");
    const b = node(scene, "b");
    expect(root.x + root.width / 2).toBeCloseTo((a.x + a.width / 2 + b.x + b.width / 2) / 2, 1);
    expect(a.y).toBe(b.y);
    expect(a.y).toBeGreaterThan(root.y + root.height);
    const a1 = node(scene, "a1");
    expect(a1.x + a1.width / 2).toBeCloseTo(a.x + a.width / 2, 1);
  });

  test("siblings keep a gap and no two nodes overlap", async () => {
    const scene = await sceneOf(example("repo-tree"));
    for (const [index, first] of scene.nodes.entries()) {
      for (const second of scene.nodes.slice(index + 1)) {
        expect(overlap(first, second)).toBe(false);
      }
    }
    const level = scene.nodes.filter((entry) => entry.depth === 2);
    for (let index = 1; index < level.length; index++) {
      const previous = level[index - 1]!;
      expect(level[index]!.x - (previous.x + previous.width)).toBeGreaterThanOrEqual(19.99);
    }
  });

  test("a wide subtree pushes its neighbor away at deeper levels only", async () => {
    const doc = {
      version: 1,
      kind: "tree",
      nodes: [
        { id: "r", label: "R" },
        { id: "l", label: "L", parent: "r" },
        { id: "r2", label: "R2", parent: "r" },
        ...["x1", "x2", "x3", "x4"].map((id) => ({ id, label: id, parent: "l" })),
        { id: "y1", label: "y1", parent: "r2" },
      ],
    };
    const scene = await sceneOf(doc);
    const lastLeft = node(scene, "x4");
    const firstRight = node(scene, "y1");
    expect(firstRight.x - (lastLeft.x + lastLeft.width)).toBeGreaterThanOrEqual(19.99);
    const left = node(scene, "l");
    const right = node(scene, "r2");
    expect(right.x - (left.x + left.width)).toBeGreaterThanOrEqual(19.99);
  });

  test("an elbow edge leaves the parent, turns mid-gap and enters the child", async () => {
    const scene = await sceneOf(small());
    const root = node(scene, "root");
    const a = node(scene, "a");
    const edge = scene.edges.find((entry) => entry.id === "a")!;
    expect(edge.points).toHaveLength(4);
    expect(edge.points[0]).toEqual({ x: root.x + root.width / 2, y: root.y + root.height });
    expect(edge.points[3]).toEqual({ x: a.x + a.width / 2, y: a.y });
    expect(edge.points[1]!.y).toBe(edge.points[2]!.y);
    expect(edge.points[1]!.y).toBe(root.y + root.height + 24);
    expect(edge.points[1]!.x).toBe(edge.points[0]!.x);
    expect(edge.points[2]!.x).toBe(edge.points[3]!.x);
  });

  test("an aligned child gets a two point edge", async () => {
    const scene = await sceneOf(chain(3));
    expect(scene.edges.every((edge) => edge.points.length === 2)).toBe(true);
    const first = node(scene, "n0");
    expect(scene.edges[0]!.points[0]!.x).toBe(scene.edges[0]!.points[1]!.x);
    expect(first.x + first.width / 2).toBeCloseTo(scene.edges[0]!.points[0]!.x, 1);
  });

  test("directions rotate the layout", async () => {
    const at = async (direction: string) => {
      const doc = small();
      doc.direction = direction;
      return sceneOf(doc);
    };
    const down = await at("down");
    const up = await at("up");
    const right = await at("right");
    const left = await at("left");
    expect(node(down, "a").y).toBeGreaterThan(node(down, "root").y);
    expect(node(up, "a").y).toBeLessThan(node(up, "root").y);
    expect(node(right, "a").x).toBeGreaterThan(node(right, "root").x);
    expect(node(left, "a").x).toBeLessThan(node(left, "root").x);
    expect(node(right, "a").y).toBeLessThan(node(right, "b").y);
    const edge = right.edges.find((entry) => entry.id === "a")!;
    const root = node(right, "root");
    expect(edge.points[0]).toEqual({ x: root.x + root.width, y: root.y + root.height / 2 });
    expect(edge.points[1]!.x).toBe(edge.points[2]!.x);
    const flipped = left.edges.find((entry) => entry.id === "a")!;
    const leftRoot = node(left, "root");
    expect(flipped.points[0]).toEqual({ x: leftRoot.x, y: leftRoot.y + leftRoot.height / 2 });
  });

  test("shapes drive the size and are emitted only when given", async () => {
    const doc = small();
    doc.nodes[1].shape = "diamond";
    const scene = await sceneOf(doc);
    expect(node(scene, "a").shape).toBe("diamond");
    expect(node(scene, "a").height).toBeGreaterThanOrEqual(48);
    expect("shape" in node(scene, "b")).toBe(false);
  });

  test("a single node is laid out alone", async () => {
    const scene = await sceneOf({ version: 1, kind: "tree", nodes: [{ id: "only", label: "Only" }] });
    expect(scene.edges).toEqual([]);
    expect(node(scene, "only").x).toBe(MARGIN);
    expect(node(scene, "only").y).toBe(MARGIN);
  });

  test("a deep chain does not overflow the stack", async () => {
    const scene = layoutTree(chain(5000) as TreeDocument);
    expect(scene.nodes).toHaveLength(5000);
    expect(scene.edges).toHaveLength(4999);
  });

  test("a rejected document throws with the paths", async () => {
    const doc = small();
    doc.nodes[1].parent = "ghost";
    await expect(layout(doc)).rejects.toThrow("/nodes/1/parent");
  });
});

describe("layout mindmap", () => {
  test("the children split by leaf weight, the first ones going right", async () => {
    const scene = await sceneOf(example("roadmap-mindmap"));
    expect(scene.layout).toBe("mindmap");
    const sides = Object.fromEntries(scene.nodes.map((entry) => [entry.id, entry.side]));
    expect(sides["standargraph-v1"]).toBeUndefined();
    expect(sides.format).toBe("right");
    expect(sides.graph).toBe("right");
    expect(sides.render).toBe("right");
    expect(sides.webgl).toBe("right");
    expect(sides["text-syntax-j8"]).toBe("left");
    expect(sides.github).toBe("left");
    expect(sides["pages-demo"]).toBe("left");
  });

  test("one child goes right, and several equal children split in two", async () => {
    const single = await sceneOf({
      version: 1,
      kind: "tree",
      layout: "mindmap",
      nodes: [
        { id: "r", label: "R" },
        { id: "a", label: "A", parent: "r" },
      ],
    });
    expect(node(single, "a").side).toBe("right");
    const four = await sceneOf({
      version: 1,
      kind: "tree",
      layout: "mindmap",
      nodes: [
        { id: "r", label: "R" },
        ...["a", "b", "c", "d"].map((id) => ({ id, label: id, parent: "r" })),
      ],
    });
    expect(four.nodes.filter((entry) => entry.side === "right").map((entry) => entry.id)).toEqual([
      "a",
      "b",
    ]);
    expect(four.nodes.filter((entry) => entry.side === "left").map((entry) => entry.id)).toEqual([
      "c",
      "d",
    ]);
  });

  test("the root is emitted once and both sides are centered on it", async () => {
    const scene = await sceneOf(example("roadmap-mindmap"));
    expect(scene.nodes.filter((entry) => entry.id === "standargraph-v1")).toHaveLength(1);
    const root = node(scene, "standargraph-v1");
    const rightEdge = Math.min(
      ...scene.nodes.filter((entry) => entry.side === "right").map((entry) => entry.x),
    );
    const leftEdge = Math.max(
      ...scene.nodes.filter((entry) => entry.side === "left").map((entry) => entry.x + entry.width),
    );
    expect(rightEdge).toBeGreaterThan(root.x + root.width);
    expect(leftEdge).toBeLessThan(root.x);
    expect(Math.min(...scene.nodes.map((entry) => entry.x))).toBe(MARGIN);
    expect(Math.min(...scene.nodes.map((entry) => entry.y))).toBe(MARGIN);
  });

  test("no two nodes overlap", async () => {
    const scene = await sceneOf(example("roadmap-mindmap"));
    for (const [index, first] of scene.nodes.entries()) {
      for (const second of scene.nodes.slice(index + 1)) {
        expect(overlap(first, second)).toBe(false);
      }
    }
  });

  test("edges are cubic Béziers from the facing sides", async () => {
    const scene = await sceneOf(example("roadmap-mindmap"));
    expect(scene.edges.every((edge) => edge.curve === "bezier" && edge.points.length === 4)).toBe(
      true,
    );
    const root = node(scene, "standargraph-v1");
    const format = node(scene, "format");
    const edge = scene.edges.find((entry) => entry.id === "format")!;
    const [p0, c1, c2, p3] = edge.points as [
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
    ];
    expect(p0).toEqual({ x: root.x + root.width, y: root.y + root.height / 2 });
    expect(p3).toEqual({ x: format.x, y: format.y + format.height / 2 });
    const dx = p3.x - p0.x;
    expect(c1.x).toBeCloseTo(p0.x + dx / 2, 1);
    expect(c1.y).toBe(p0.y);
    expect(c2.x).toBeCloseTo(p3.x - dx / 2, 1);
    expect(c2.y).toBe(p3.y);

    const github = node(scene, "github");
    const left = scene.edges.find((entry) => entry.id === "github")!;
    expect(left.points[0]).toEqual({ x: root.x, y: root.y + root.height / 2 });
    expect(left.points[3]).toEqual({ x: github.x + github.width, y: github.y + github.height / 2 });
  });
});

describe("svg", () => {
  async function svgOf(input: unknown, options?: Parameters<typeof renderSvg>[1]) {
    return renderSvg(await layout(input), options);
  }

  test("the root tells the diagram kind and the layout", async () => {
    expect(await svgOf(small())).toContain('class="sg-root" data-diagram="tree" data-layout="tree" version');
    expect(await svgOf(example("roadmap-mindmap"))).toContain(
      'data-diagram="tree" data-layout="mindmap"',
    );
    expect(await svgOf(example("shop-er"))).not.toContain("data-layout");
  });

  test("nodes carry the shape, the depth and the side", async () => {
    const svg = await svgOf(example("roadmap-mindmap"));
    expect(svg).toContain(
      '<g data-kind="node" data-id="standargraph-v1" data-shape="pill" data-depth="0">',
    );
    expect(svg).toContain('<g data-kind="node" data-id="format" data-shape="box" data-depth="1" data-side="right">');
    expect(svg).toContain('<g data-kind="node" data-id="github" data-shape="box" data-depth="1" data-side="left">');
    expect(svg).toContain('<g data-kind="edge" data-id="format" data-from="standargraph-v1" data-to="format">');
  });

  test("an elbow is drawn with lines and a Bézier with a curve, without markers", async () => {
    const tree = await svgOf(small());
    const elbow = tree.split('data-kind="edge" data-id="a"')[1]!.split("</g>")[0]!;
    expect(elbow).toMatch(/ d="M[\d.]+,[\d.]+ L[\d.]+,[\d.]+ L[\d.]+,[\d.]+ L[\d.]+,[\d.]+"/);
    expect(elbow).toContain('class="sg-edge"');
    expect(elbow).not.toContain("marker-end");
    const mindmap = await svgOf(example("roadmap-mindmap"));
    const curve = mindmap.split('data-kind="edge" data-id="format"')[1]!.split("</g>")[0]!;
    expect(curve).toMatch(/ d="M[\d.]+,[\d.]+ C[\d.]+,[\d.]+ [\d.]+,[\d.]+ [\d.]+,[\d.]+"/);
    expect(curve).not.toContain("marker-end");
  });

  test("edges are drawn before the nodes", async () => {
    const svg = await svgOf(small());
    const order = [...svg.matchAll(/data-kind="(node|edge)" data-id="([^"]+)"/g)].map(
      (match) => `${match[1]}:${match[2]}`,
    );
    expect(order).toEqual([
      "edge:a",
      "edge:a1",
      "edge:b",
      "node:root",
      "node:a",
      "node:a1",
      "node:b",
    ]);
  });

  test("a node keeps its type, confidence, shape and coverage", async () => {
    const doc = small();
    doc.nodes[1].type = "folder";
    doc.nodes[1].shape = "cylinder";
    doc.nodes[1].meta = { coverage: 0.5, provenance: { source: "s", confidence: "unknown" } };
    const svg = await svgOf(doc);
    expect(svg).toContain(
      '<g data-kind="node" data-id="a" data-type="folder" data-confidence="unknown" data-shape="cylinder" data-depth="1">',
    );
    expect(svg).toContain('class="sg-node sg-unknown"');
    expect(svg).toContain('<rect class="sg-accent"');
  });

  test("escaping", async () => {
    const doc = small();
    doc.title = "<t>";
    doc.nodes[1].label = '<&">';
    const svg = await svgOf(doc);
    expect(svg).toContain("&lt;&amp;&quot;&gt;");
    expect(svg).toContain("<title>&lt;t&gt;</title>");
  });

  test("rendering is deterministic", async () => {
    expect(await svgOf(example("roadmap-mindmap"))).toBe(await svgOf(example("roadmap-mindmap")));
  });
});

describe("view", () => {
  test("item count and hover rules", async () => {
    const scene = await sceneOf(small());
    expect(sceneItemCount(scene)).toBe(7);
    expect(HOVERABLE.has("node")).toBe(true);
    expect(HOVERABLE.has("edge")).toBe(false);
  });

  test("a node is hit on its box and an edge on its path", async () => {
    const scene = await sceneOf(small());
    const view = createView(scene);
    view.setViewport(scene.width, scene.height);
    view.setCamera({ x: 0, y: 0, scale: 1 });
    const a = node(scene, "a");
    expect(view.hitTest(a.x + a.width / 2, a.y + a.height / 2)).toEqual({ kind: "node", id: "a" });
    const edge = scene.edges.find((entry) => entry.id === "a")!;
    const mid = edge.points[1]!;
    const next = edge.points[2]!;
    expect(view.hitTest((mid.x + next.x) / 2, mid.y)).toEqual({ kind: "edge", id: "a" });
    expect(view.hitTest(2, scene.height - 2)).toBeNull();
  });

  test("a Bézier edge is hit along its curve", async () => {
    const scene = await sceneOf(example("roadmap-mindmap"));
    const view = createView(scene);
    view.setViewport(scene.width, scene.height);
    view.setCamera({ x: 0, y: 0, scale: 1 });
    const edge = scene.edges.find((entry) => entry.id === "webgl")!;
    const [p0, c1, c2, p3] = edge.points as [
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
    ];
    const t = 0.5;
    const u = 1 - t;
    const x = u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x;
    const y = u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y;
    expect(view.hitTest(x, y)).toEqual({ kind: "edge", id: "webgl" });
  });

  test("search matches labels and ids", async () => {
    const scene = await sceneOf(example("roadmap-mindmap"));
    const view = createView(scene);
    view.search("MERMAID");
    expect([...view.highlight().active]).toEqual(["node:mermaid-export"]);
    view.search("state-er");
    expect([...view.highlight().active]).toEqual(["node:state-er-tree"]);
  });

  test("a node gathers its edges and their endpoints", async () => {
    const scene = await sceneOf(small());
    const view = createView(scene);
    view.hover({ kind: "node", id: "a" });
    expect([...view.highlight().active].sort()).toEqual([
      "edge:a",
      "edge:a1",
      "node:a",
      "node:a1",
      "node:root",
    ]);
  });

  test("items resolve by reference and edge keys do not collide with node keys", async () => {
    const scene = await sceneOf(small());
    const view = createView(scene);
    expect(view.item({ kind: "node", id: "a1" })?.label).toBe("A1");
    expect(view.item({ kind: "edge", id: "a1" })?.from).toBe("a");
    view.select({ kind: "edge", id: "a1" });
    expect(view.selected()).toEqual({ kind: "edge", id: "a1" });
  });
});
