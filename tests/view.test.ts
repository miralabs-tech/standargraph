import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createSpatialIndex } from "../src/core/spatial";
import { type Change, createView, type View } from "../src/core/view";
import { layout } from "../src/layout";
import type { LaidOut } from "../src/layout/types";

const scene: LaidOut = {
  kind: "graph",
  width: 2200,
  height: 2100,
  groups: [{ id: "g", label: "Group", x: 0, y: 0, width: 400, height: 300, depth: 0 }],
  nodes: [
    { id: "a", label: "Alpha", type: "service", x: 50, y: 50, width: 100, height: 40, group: "g" },
    { id: "b", label: "Beta", x: 250, y: 50, width: 100, height: 40, group: "g" },
    { id: "c", label: "Gamma", x: 50, y: 200, width: 100, height: 40, group: "g" },
    { id: "d", label: "Delta", x: 2000, y: 2000, width: 100, height: 40 },
  ],
  edges: [
    {
      id: "e0",
      from: "a",
      to: "b",
      label: "calls",
      directed: true,
      points: [
        { x: 150, y: 70 },
        { x: 250, y: 70 },
      ],
      labelBox: { x: 180, y: 55, width: 40, height: 14 },
    },
    {
      id: "e1",
      from: "a",
      to: "c",
      directed: true,
      points: [
        { x: 100, y: 90 },
        { x: 100, y: 200 },
      ],
    },
  ],
};

function makeView(): View {
  const view = createView(scene);
  view.setViewport(800, 600);
  view.setCamera({ x: 0, y: 0, scale: 1 });
  return view;
}

function collect(view: View): Set<Change>[] {
  const calls: Set<Change>[] = [];
  view.subscribe((changes) => calls.push(new Set(changes)));
  return calls;
}

describe("camera", () => {
  test("fit centers the scene and contains it", () => {
    const view = createView(scene);
    view.setViewport(800, 600);
    view.fit();
    const camera = view.camera();
    expect(camera.scale).toBeCloseTo(Math.min(800 / 2200, 600 / 2100), 12);
    const center = view.worldToScreen(scene.width / 2, scene.height / 2);
    expect(center.x).toBeCloseTo(400, 9);
    expect(center.y).toBeCloseTo(300, 9);
    const corner = view.worldToScreen(scene.width, scene.height);
    const origin = view.worldToScreen(0, 0);
    expect(origin.x).toBeGreaterThanOrEqual(0);
    expect(origin.y).toBeGreaterThanOrEqual(0);
    expect(corner.x).toBeLessThanOrEqual(800 + 1e-9);
    expect(corner.y).toBeLessThanOrEqual(600 + 1e-9);
  });

  test("zoomAt keeps the world point under the cursor fixed and clamps", () => {
    const view = createView(scene);
    view.setViewport(800, 600);
    view.fit();
    for (const [factor, x, y] of [
      [1.5, 300, 200],
      [0.7, 10, 590],
      [2.2, 799, 1],
    ] as const) {
      const before = view.screenToWorld(x, y);
      view.zoomAt(factor, x, y);
      const after = view.screenToWorld(x, y);
      expect(Math.abs(after.x - before.x)).toBeLessThan(1e-9);
      expect(Math.abs(after.y - before.y)).toBeLessThan(1e-9);
    }
    view.zoomAt(1e9, 400, 300);
    expect(view.camera().scale).toBe(8);
    view.zoomAt(1e-9, 400, 300);
    expect(view.camera().scale).toBe(0.05);
  });

  test("panBy translates the camera", () => {
    const view = makeView();
    view.panBy(30, -12);
    expect(view.camera()).toEqual({ x: 30, y: -12, scale: 1 });
  });

  test("screenToWorld and worldToScreen are inverse", () => {
    const view = makeView();
    view.setCamera({ x: 123.5, y: -77.25, scale: 0.37 });
    for (const [x, y] of [
      [0, 0],
      [512.25, 99.5],
      [-40, 3000],
    ] as const) {
      const world = view.screenToWorld(x, y);
      const back = view.worldToScreen(world.x, world.y);
      expect(back.x).toBeCloseTo(x, 9);
      expect(back.y).toBeCloseTo(y, 9);
    }
  });
});

describe("hitTest", () => {
  test("returns the node under a point", () => {
    expect(makeView().hitTest(100, 70)).toEqual({ kind: "node", id: "a" });
  });

  test("returns an edge near its path, before the group", () => {
    const view = makeView();
    expect(view.hitTest(165, 73)).toEqual({ kind: "edge", id: "e0" });
    expect(view.hitTest(103, 150)).toEqual({ kind: "edge", id: "e1" });
    expect(view.hitTest(200, 62)).toEqual({ kind: "edge", id: "e0" });
    expect(view.hitTest(165, 80)).toEqual({ kind: "group", id: "g" });
  });

  test("the edge tolerance is in screen pixels", () => {
    const view = makeView();
    view.setCamera({ x: 0, y: 0, scale: 4 });
    expect(view.hitTest(165 * 4, 73 * 4)).toEqual({ kind: "group", id: "g" });
    expect(view.hitTest(165 * 4, 70 * 4 + 3)).toEqual({ kind: "edge", id: "e0" });
  });

  test("returns a group on its padding and null on empty space", () => {
    const view = makeView();
    expect(view.hitTest(10, 10)).toEqual({ kind: "group", id: "g" });
    expect(view.hitTest(700, 500)).toBeNull();
  });
});

describe("visible", () => {
  test("drops off-screen items", () => {
    const view = makeView();
    const keys = (items: readonly { kind: string; id: string }[]) =>
      items.map((item) => `${item.kind}:${item.id}`);
    const first = view.visible();
    expect(first.count).toBe(first.items.length);
    expect(keys(first.items)).toContain("node:a");
    expect(keys(first.items)).not.toContain("node:d");
    view.setCamera({ x: -1900, y: -1900, scale: 1 });
    const second = keys(view.visible().items);
    expect(second).toContain("node:d");
    expect(second).not.toContain("node:a");
    expect(second).not.toContain("group:g");
  });

  test("notifies visible only when the culled set changes", () => {
    const view = makeView();
    const calls = collect(view);
    view.panBy(1, 1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.has("visible")).toBe(false);
    view.setCamera({ x: -1900, y: -1900, scale: 1 });
    expect(calls[1]!.has("visible")).toBe(true);
  });

  test("with no viewport every item is visible", () => {
    const view = createView(scene);
    expect(view.visible().count).toBe(7);
  });
});

describe("lod", () => {
  test("flips at the threshold and notifies only on flips", () => {
    const view = makeView();
    const calls = collect(view);
    expect(view.lod()).toEqual({ labels: true, captions: true, edgeLabels: true });
    view.setCamera({ x: 0, y: 0, scale: 0.4 });
    expect(view.lod()).toEqual({ labels: false, captions: false, edgeLabels: false });
    expect(calls[0]!.has("lod")).toBe(true);
    view.setCamera({ x: 0, y: 0, scale: 0.3 });
    expect(calls[1]!.has("lod")).toBe(false);
    view.setCamera({ x: 0, y: 0, scale: 0.6 });
    expect(view.lod()).toEqual({ labels: true, captions: false, edgeLabels: true });
    expect(calls[2]!.has("lod")).toBe(true);
    view.setCamera({ x: 0, y: 0, scale: 0.5 });
    expect(view.lod().labels).toBe(true);
    view.setCamera({ x: 0, y: 0, scale: 0.4999 });
    expect(view.lod().labels).toBe(false);
  });

  test("labelMinPx moves the thresholds", () => {
    const view = createView(scene, { labelMinPx: 14 });
    view.setViewport(800, 600);
    view.setCamera({ x: 0, y: 0, scale: 0.9 });
    expect(view.lod()).toEqual({ labels: false, captions: false, edgeLabels: false });
    view.setCamera({ x: 0, y: 0, scale: 1 });
    expect(view.lod()).toEqual({ labels: true, captions: false, edgeLabels: false });
  });
});

describe("highlight", () => {
  test("hover gives the node, its incident edges and their endpoints", () => {
    const view = makeView();
    expect(view.highlight()).toEqual({ focused: false, active: new Set() });
    view.hover({ kind: "node", id: "a" });
    const { focused, active } = view.highlight();
    expect(focused).toBe(true);
    expect([...active].sort()).toEqual(
      ["edge:e0", "edge:e1", "node:a", "node:b", "node:c"].sort(),
    );
    expect(view.hovered()).toEqual({ kind: "node", id: "a" });
    view.hover(null);
    expect(view.highlight().focused).toBe(false);
    expect(view.hovered()).toBeNull();
  });

  test("search highlights the matching nodes and hover takes priority", () => {
    const view = makeView();
    view.search("  ALP ");
    expect([...view.highlight().active]).toEqual(["node:a"]);
    expect(view.highlight().focused).toBe(true);
    view.search("zzz");
    expect(view.highlight()).toEqual({ focused: true, active: new Set() });
    view.search("ta");
    expect([...view.highlight().active].sort()).toEqual(["node:b", "node:d"]);
    view.hover({ kind: "node", id: "c" });
    expect(view.highlight().active.has("node:c")).toBe(true);
    expect(view.highlight().active.has("node:d")).toBe(false);
    view.hover(null);
    view.search("");
    expect(view.highlight().focused).toBe(false);
  });

  test("a participant gathers its messages and their endpoints", async () => {
    const doc = JSON.parse(
      readFileSync(new URL("../examples/protocol.json", import.meta.url), "utf8"),
    );
    const sequence = await layout(doc);
    expect(sequence.kind).toBe("sequence");
    if (sequence.kind !== "sequence") return;
    const view = createView(sequence);
    const first = sequence.participants[0]!;
    view.hover({ kind: "participant", id: first.id });
    const { active } = view.highlight();
    expect(active.has(`participant:${first.id}`)).toBe(true);
    const touching = sequence.messages.filter(
      (message) => message.from === first.id || message.to === first.id,
    );
    expect(touching.length).toBeGreaterThan(0);
    for (const message of touching) {
      expect(active.has(`message:${message.index}`)).toBe(true);
      expect(active.has(`participant:${message.from}`)).toBe(true);
      expect(active.has(`participant:${message.to}`)).toBe(true);
    }
    for (const message of sequence.messages) {
      if (!touching.includes(message)) expect(active.has(`message:${message.index}`)).toBe(false);
    }
  });
});

describe("notifications", () => {
  test("batch coalesces into one notification", () => {
    const view = makeView();
    const calls = collect(view);
    view.batch(() => {
      view.panBy(10, 10);
      view.zoomAt(1.2, 100, 100);
      view.hover({ kind: "node", id: "a" });
      view.select({ kind: "node", id: "b" });
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.has("camera")).toBe(true);
    expect(calls[0]!.has("hover")).toBe(true);
    expect(calls[0]!.has("selection")).toBe(true);
  });

  test("each mutating call notifies once, and only for real changes", () => {
    const view = makeView();
    const calls = collect(view);
    view.panBy(0, 0);
    view.setViewport(800, 600);
    view.hover(null);
    view.select(null);
    view.search("");
    expect(calls).toHaveLength(0);
    view.panBy(5, 0);
    expect([...calls[0]!].sort()).toEqual(["camera"]);
    view.select({ kind: "edge", id: "e0" });
    expect([...calls[1]!]).toEqual(["selection"]);
    expect(view.selected()).toEqual({ kind: "edge", id: "e0" });
    view.search("a");
    expect([...calls[2]!]).toEqual(["search"]);
    expect(calls).toHaveLength(3);
  });

  test("unsubscribe stops notifications", () => {
    const view = makeView();
    let count = 0;
    const stop = view.subscribe(() => {
      count += 1;
    });
    view.panBy(1, 1);
    expect(count).toBe(1);
    stop();
    view.panBy(1, 1);
    expect(count).toBe(1);
  });

  test("item returns the laid-out item", () => {
    const view = makeView();
    expect(view.item({ kind: "node", id: "b" })?.label).toBe("Beta");
    expect(view.item({ kind: "node", id: "missing" })).toBeUndefined();
  });
});

describe("spatial index", () => {
  test("query and at return the intersecting boxes once", () => {
    const index = createSpatialIndex([
      { box: { x: 0, y: 0, width: 10, height: 10 }, value: "a" },
      { box: { x: 100, y: 100, width: 10, height: 10 }, value: "b" },
      { box: { x: 0, y: 0, width: 5000, height: 5000 }, value: "big" },
    ]);
    expect(index.size).toBe(3);
    expect(index.at(5, 5).sort()).toEqual(["a", "big"]);
    expect(index.query({ x: 90, y: 90, width: 20, height: 20 }).sort()).toEqual(["b", "big"]);
    expect(index.at(7000, 7000)).toEqual([]);
  });
});
