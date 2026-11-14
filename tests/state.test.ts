import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createView, HOVERABLE, sceneItemCount } from "../src/core/view";
import { transitionLabel, validate } from "../src/format";
import { layout } from "../src/layout";
import type { Box, LaidOutStateMachine } from "../src/layout/types";
import { renderSvg } from "../src/svg";

function example(): Record<string, any> {
  return JSON.parse(
    readFileSync(new URL("../examples/order-state.json", import.meta.url), "utf8"),
  );
}

function small(): Record<string, any> {
  return {
    version: 1,
    kind: "state",
    states: [{ id: "i", pseudo: "initial" }, { id: "a" }, { id: "f", pseudo: "final" }],
    transitions: [
      { from: "i", to: "a" },
      { from: "a", to: "f" },
    ],
  };
}

function errorsOf(input: unknown): { path: string; message: string }[] {
  const result = validate(input);
  if (result.ok) throw new Error("expected validation to fail");
  return result.errors;
}

async function sceneOf(input: unknown): Promise<LaidOutStateMachine> {
  const scene = await layout(input);
  if (scene.kind !== "state") throw new Error("expected a state machine");
  return scene;
}

function inside(inner: Box, outer: Box): boolean {
  return (
    inner.x >= outer.x - 0.01 &&
    inner.y >= outer.y - 0.01 &&
    inner.x + inner.width <= outer.x + outer.width + 0.01 &&
    inner.y + inner.height <= outer.y + outer.height + 0.01
  );
}

describe("validation", () => {
  test("the example and a small machine are valid", () => {
    expect(validate(example()).ok).toBe(true);
    expect(validate(small()).ok).toBe(true);
  });

  test("a state document needs at least one state", () => {
    const doc = small();
    doc.states = [];
    expect(errorsOf(doc).map((error) => error.path)).toEqual(["/states"]);
  });

  test("an unknown pseudo-state names the allowed values", () => {
    const doc = small();
    doc.states[1].pseudo = "start";
    expect(errorsOf(doc)).toEqual([
      {
        path: "/states/1/pseudo",
        message: "Expected one of initial, final, choice, fork, join, history",
      },
    ]);
  });

  test("duplicate ids", () => {
    const doc = small();
    doc.states.push({ id: "a" });
    doc.transitions[0].id = "x";
    doc.transitions[1].id = "x";
    expect(errorsOf(doc)).toEqual([
      { path: "/states/3/id", message: 'Duplicate state id "a"' },
      { path: "/transitions/1/id", message: 'Duplicate transition id "x"' },
    ]);
  });

  test("unknown transition ends", () => {
    const doc = small();
    doc.transitions.push({ from: "ghost", to: "a" }, { from: "a", to: "phantom" });
    expect(errorsOf(doc)).toEqual([
      { path: "/transitions/2/from", message: 'Transition source "ghost" is not a known state id' },
      { path: "/transitions/3/to", message: 'Transition target "phantom" is not a known state id' },
    ]);
  });

  test("parents: unknown, pseudo-state and cycle", () => {
    const unknown = small();
    unknown.states[1].parent = "ghost";
    expect(errorsOf(unknown)).toEqual([
      { path: "/states/1/parent", message: 'Parent state "ghost" is not a known state id' },
    ]);

    const pseudo = small();
    pseudo.states[1].parent = "i";
    expect(errorsOf(pseudo)).toEqual([
      {
        path: "/states/1/parent",
        message: 'Parent state "i" is a pseudo-state and cannot contain states',
      },
    ]);

    const cycle = small();
    cycle.states.push({ id: "b", parent: "c" }, { id: "c", parent: "b" });
    expect(errorsOf(cycle)).toEqual([
      { path: "/states/3/parent", message: "State parent cycle: b -> c -> b" },
    ]);
  });

  test("pseudo-states carry no actions", () => {
    const doc = small();
    doc.states[0].actions = ["entry / x"];
    expect(errorsOf(doc)).toEqual([
      { path: "/states/0/actions", message: "Pseudo-states carry no actions" },
    ]);
  });

  test("transitions into an initial and out of a final pseudo-state", () => {
    const doc = small();
    doc.transitions.push({ from: "a", to: "i" }, { from: "f", to: "a" });
    expect(errorsOf(doc)).toEqual([
      { path: "/transitions/2/to", message: 'Transition into an initial pseudo-state "i"' },
      { path: "/transitions/3/from", message: 'Transition out of a final pseudo-state "f"' },
    ]);
  });

  test("an initial pseudo-state needs exactly one outgoing transition", () => {
    const none = small();
    none.transitions.shift();
    expect(errorsOf(none)).toEqual([
      {
        path: "/states/0",
        message: 'Initial pseudo-state "i" needs exactly one outgoing transition (found 0)',
      },
    ]);
    const two = small();
    two.transitions.push({ from: "i", to: "f" });
    expect(errorsOf(two)).toEqual([
      {
        path: "/states/0",
        message: 'Initial pseudo-state "i" needs exactly one outgoing transition (found 2)',
      },
    ]);
  });

  test("one initial pseudo-state per region, the root region is named root", () => {
    const doc = small();
    doc.states.push({ id: "j", pseudo: "initial" });
    doc.transitions.push({ from: "j", to: "a" });
    expect(errorsOf(doc)).toEqual([
      {
        path: "/states/3/pseudo",
        message: 'More than one initial pseudo-state in region "root"',
      },
    ]);
    const nested = example();
    nested.states.push({ id: "second", pseudo: "initial", parent: "fulfilment" });
    nested.transitions.push({ from: "second", to: "picking" });
    expect(errorsOf(nested)).toEqual([
      {
        path: "/states/10/pseudo",
        message: 'More than one initial pseudo-state in region "fulfilment"',
      },
    ]);
  });

  test("a transition may leave a composite for a descendant and loop on it", () => {
    const doc = example();
    doc.transitions.push(
      { from: "fulfilment", to: "picking" },
      { from: "fulfilment", to: "fulfilment" },
    );
    expect(validate(doc).ok).toBe(true);
  });

  test("an unknown kind lists the state kind", () => {
    expect(errorsOf({ version: 1, kind: "pie" })[0]!.message).toContain('"state"');
  });
});

describe("transitionLabel", () => {
  test("composes event, guard and action", () => {
    expect(transitionLabel({})).toBe("");
    expect(transitionLabel({ event: "go" })).toBe("go");
    expect(transitionLabel({ event: "go", guard: "ok" })).toBe("go [ok]");
    expect(transitionLabel({ event: "go", action: "run" })).toBe("go / run");
    expect(transitionLabel({ guard: "ok" })).toBe("[ok]");
    expect(transitionLabel({ guard: "ok", action: "run" })).toBe("[ok] / run");
    expect(transitionLabel({ event: "go", guard: "ok", action: "run" })).toBe("go [ok] / run");
  });
});

describe("layout", () => {
  test("every state has a box and every transition a route", async () => {
    const scene = await sceneOf(example());
    expect(scene.states.map((state) => state.id)).toEqual(
      example().states.map((state: { id: string }) => state.id),
    );
    expect(scene.transitions).toHaveLength(10);
    for (const transition of scene.transitions) {
      expect(transition.points.length).toBeGreaterThanOrEqual(2);
    }
    for (const state of scene.states) {
      expect(state.x + state.width).toBeLessThanOrEqual(scene.width + 0.01);
      expect(state.y + state.height).toBeLessThanOrEqual(scene.height + 0.01);
    }
  });

  test("composites contain their children and carry depths", async () => {
    const scene = await sceneOf(example());
    const byId = new Map(scene.states.map((state) => [state.id, state]));
    const composite = byId.get("fulfilment")!;
    expect(composite.composite).toBe(true);
    expect(composite.depth).toBe(0);
    for (const id of ["fulfilment__initial", "picking", "shipped"]) {
      const child = byId.get(id)!;
      expect(child.composite).toBe(false);
      expect(child.depth).toBe(1);
      expect(child.parent).toBe("fulfilment");
      expect(inside(child, composite)).toBe(true);
    }
    expect(byId.get("pending")!.depth).toBe(0);
    expect(byId.get("pending")!.composite).toBe(false);
  });

  test("pseudo-state sizes", async () => {
    const doc = small();
    doc.states.push(
      { id: "c", pseudo: "choice" },
      { id: "h", pseudo: "history" },
      { id: "fk", pseudo: "fork" },
      { id: "jn", pseudo: "join" },
    );
    const size = (scene: LaidOutStateMachine, id: string) => {
      const state = scene.states.find((candidate) => candidate.id === id)!;
      return [state.width, state.height];
    };
    const down = await sceneOf(doc);
    expect(size(down, "i")).toEqual([20, 20]);
    expect(size(down, "f")).toEqual([24, 24]);
    expect(size(down, "h")).toEqual([24, 24]);
    expect(size(down, "c")).toEqual([28, 28]);
    expect(size(down, "fk")).toEqual([64, 6]);
    expect(size(down, "jn")).toEqual([64, 6]);
    doc.direction = "right";
    const right = await sceneOf(doc);
    expect(size(right, "fk")).toEqual([6, 64]);
    expect(size(right, "jn")).toEqual([6, 64]);
  });

  test("actions widen and heighten a simple state", async () => {
    const plain = small();
    const withActions = small();
    withActions.states[1].actions = [
      "entry / reserve stock and notify the warehouse team",
      "exit / release",
    ];
    const before = (await sceneOf(plain)).states[1]!;
    const after = (await sceneOf(withActions)).states[1]!;
    expect(after.height).toBeGreaterThan(before.height + 2 * 13);
    expect(after.width).toBeGreaterThan(before.width);
    expect(after.actions).toEqual(withActions.states[1].actions);
  });

  test("actions push the children of a composite down", async () => {
    const plain = example();
    const withActions = example();
    withActions.states.find((state: { id: string }) => state.id === "fulfilment").actions = [
      "entry / start picking",
    ];
    const gap = async (doc: unknown) => {
      const scene = await sceneOf(doc);
      const composite = scene.states.find((state) => state.id === "fulfilment")!;
      const child = scene.states.find((state) => state.id === "picking")!;
      return child.y - composite.y;
    };
    expect((await gap(withActions)) - (await gap(plain))).toBeGreaterThan(13);
  });

  test("transition labels are composed and ids default to their index", async () => {
    const scene = await sceneOf(example());
    expect(scene.transitions.map((transition) => transition.id)).toEqual([
      "t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9",
    ]);
    const labels = scene.transitions.map((transition) => transition.label);
    expect(labels[0]).toBeUndefined();
    expect(labels[2]).toBe("handed to carrier / notify customer");
    expect(labels[4]).toBe("timeout [after 30 min]");
    expect(labels[7]).toBe("[delivered]");
    expect(scene.transitions[2]!.labelBox).toBeDefined();
    expect(scene.transitions[0]!.labelBox).toBeUndefined();
    expect(scene.transitions[4]!.guard).toBe("after 30 min");
  });

  test("ends are clipped on the circle of a final and the diamond of a choice", async () => {
    const scene = await sceneOf(example());
    const final = scene.states.find((state) => state.id === "__final")!;
    const choice = scene.states.find((state) => state.id === "check")!;
    const toFinal = scene.transitions[7]!;
    const end = toFinal.points[toFinal.points.length - 1]!;
    const cx = final.x + final.width / 2;
    const cy = final.y + final.height / 2;
    expect(Math.hypot(end.x - cx, end.y - cy)).toBeCloseTo(12, 0);
    const start = toFinal.points[0]!;
    const dx = Math.abs(start.x - (choice.x + 14));
    const dy = Math.abs(start.y - (choice.y + 14));
    expect(dx / 14 + dy / 14).toBeCloseTo(1, 1);
  });

  test("a custom transition id is kept", async () => {
    const doc = small();
    doc.transitions[1].id = "finish";
    const scene = await sceneOf(doc);
    expect(scene.transitions.map((transition) => transition.id)).toEqual(["t0", "finish"]);
  });

  test("metadata, type, link and description travel to the scene", async () => {
    const doc = small();
    doc.states[1] = {
      id: "a",
      label: "A",
      type: "service",
      description: "d",
      link: "https://example.com",
      meta: { coverage: 0.5 },
    };
    const state = (await sceneOf(doc)).states[1]!;
    expect(state).toMatchObject({
      label: "A",
      type: "service",
      description: "d",
      link: "https://example.com",
      meta: { coverage: 0.5 },
      composite: false,
      depth: 0,
    });
  });

  test("the layout is deterministic and the direction changes the shape", async () => {
    expect(await sceneOf(example())).toEqual(await sceneOf(example()));
    const down = example();
    down.direction = "down";
    const right = await sceneOf(example());
    const vertical = await sceneOf(down);
    expect(right.width).toBeGreaterThan(right.height);
    expect(vertical.height).toBeGreaterThan(right.height);
  });

  test("an invalid state document is rejected", async () => {
    const doc = small();
    doc.transitions[0].to = "ghost";
    await expect(layout(doc)).rejects.toThrow("/transitions/0/to");
  });
});

describe("svg", () => {
  async function svgOf(input: unknown, options?: Parameters<typeof renderSvg>[1]) {
    return renderSvg(await layout(input), options);
  }

  test("the root tells the diagram kind and items carry data attributes", async () => {
    const svg = await svgOf(example());
    expect(svg).toContain('data-diagram="state"');
    expect(svg).toContain('<g data-kind="state" data-id="fulfilment" data-composite="true">');
    expect(svg).toContain('<g data-kind="state" data-id="__initial" data-pseudo="initial">');
    expect(svg).toContain('<g data-kind="state" data-id="check" data-pseudo="choice">');
    expect(svg).toContain(
      '<g data-kind="state" data-id="cancelled" data-confidence="confirmed">',
    );
    expect(svg).toContain('<g data-kind="transition" data-id="t4" data-from="pending" data-to="cancelled">');
  });

  test("composites come first, then transitions, then the other states", async () => {
    const svg = await svgOf(example());
    const order = [...svg.matchAll(/data-kind="(state|transition)" data-id="([^"]+)"/g)].map(
      (match) => `${match[1]}:${match[2]}`,
    );
    expect(order[0]).toBe("state:fulfilment");
    const firstTransition = order.findIndex((entry) => entry.startsWith("transition:"));
    const lastTransition = order.map((entry) => entry.startsWith("transition:")).lastIndexOf(true);
    expect(firstTransition).toBe(1);
    expect(order.slice(lastTransition + 1)).toEqual(
      example()
        .states.filter((state: { id: string }) => state.id !== "fulfilment")
        .map((state: { id: string }) => `state:${state.id}`),
    );
  });

  test("states with actions get a divider and left aligned action lines", async () => {
    const svg = await svgOf(example());
    expect(svg).toContain('class="sg-divider"');
    expect(svg).toMatch(
      /<text class="sg-muted sg-caption"[^>]*text-anchor="start"[^>]*>entry \/ reserve stock<\/text>/,
    );
  });

  test("pseudo-states are drawn with explicit paint for PNG and PDF", async () => {
    const svg = await svgOf(example(), { styles: false });
    expect(svg).not.toContain("<style>");
    expect(svg).toMatch(/<circle class="sg-pseudo"[^>]*r="10" fill="#1f2430"\/>/);
    expect(svg).toMatch(/<circle class="sg-node"[^>]*r="12" fill="#ffffff" stroke="#475569"/);
    expect(svg).toMatch(/<circle class="sg-pseudo"[^>]*r="7" fill="#1f2430"\/>/);
    expect(svg).toMatch(/<polygon class="sg-node" points="[^"]+" fill="#ffffff"/);
    expect(svg).toMatch(/class="sg-divider"[^>]*stroke="#475569"/);
  });

  test("history shows an H, fork and join are bars, and pseudo-states get no coverage bar", async () => {
    const doc = small();
    doc.states.push(
      { id: "h", pseudo: "history", meta: { coverage: 0.5 } },
      { id: "fk", pseudo: "fork" },
    );
    const svg = await svgOf(doc);
    expect(svg).toMatch(/>H<\/text>/);
    expect(svg).toMatch(/<rect class="sg-pseudo" x="[\d.]+" y="[\d.]+" width="64" height="6"/);
    expect(svg).not.toContain('<rect class="sg-accent"');
  });

  test("a simple state shows its coverage and unknown confidence", async () => {
    const doc = small();
    doc.states[1].meta = { coverage: 0.5, provenance: { source: "s", confidence: "unknown" } };
    const svg = await svgOf(doc);
    expect(svg).toContain('<rect class="sg-accent"');
    expect(svg).toContain('class="sg-node sg-unknown"');
    expect(svg).toContain('stroke-dasharray="2 3"');
  });

  test("transitions are directed edges with a labelled background", async () => {
    const svg = await svgOf(example());
    const transition = svg.split('data-kind="transition" data-id="t3"')[1]!.split("</g>")[0]!;
    expect(transition).toContain('class="sg-edge"');
    expect(transition).toContain('marker-end="url(#sg-arrow-filled)"');
    expect(transition).toContain("payment received");
    expect(transition).toContain("sg-label-bg");
  });

  test("type attribute and escaping", async () => {
    const doc = small();
    doc.states[1] = { id: "a", label: '<&">', type: "svc", actions: ["<x>"] };
    const svg = await svgOf(doc);
    expect(svg).toContain('data-type="svc"');
    expect(svg).toContain("&lt;&amp;&quot;&gt;");
    expect(svg).toContain("&lt;x&gt;");
  });

  test("rendering is deterministic", async () => {
    expect(await svgOf(example())).toBe(await svgOf(example()));
  });
});

describe("view", () => {
  test("item count and kinds", async () => {
    const scene = await sceneOf(example());
    expect(sceneItemCount(scene)).toBe(20);
    expect(HOVERABLE.has("state")).toBe(true);
    expect(HOVERABLE.has("transition")).toBe(false);
  });

  test("a click inside a composite hits the child first and the container elsewhere", async () => {
    const scene = await sceneOf(example());
    const view = createView(scene);
    view.setViewport(scene.width, scene.height);
    view.setCamera({ x: 0, y: 0, scale: 1 });
    const composite = scene.states.find((state) => state.id === "fulfilment")!;
    const picking = scene.states.find((state) => state.id === "picking")!;
    expect(view.hitTest(picking.x + picking.width / 2, picking.y + picking.height / 2)).toEqual({
      kind: "state",
      id: "picking",
    });
    expect(view.hitTest(composite.x + 6, composite.y + composite.height - 6)).toEqual({
      kind: "state",
      id: "fulfilment",
    });
    expect(view.hitTest(2, scene.height - 2)).toBeNull();
  });

  test("a transition is hit on its path and on its label", async () => {
    const scene = await sceneOf(example());
    const view = createView(scene);
    view.setViewport(scene.width, scene.height);
    view.setCamera({ x: 0, y: 0, scale: 1 });
    const transition = scene.transitions[3]!;
    const middle = transition.points[0]!;
    expect(view.hitTest(middle.x + 1, middle.y)).toEqual({ kind: "transition", id: "t3" });
    const box = transition.labelBox!;
    expect(view.hitTest(box.x + box.width / 2, box.y + box.height / 2)).toEqual({
      kind: "transition",
      id: "t3",
    });
  });

  test("search matches labels and ids of every state", async () => {
    const scene = await sceneOf(example());
    const view = createView(scene);
    view.search("PICK");
    expect([...view.highlight().active]).toEqual(["state:picking"]);
    view.search("__initial");
    expect([...view.highlight().active].sort()).toEqual([
      "state:__initial",
      "state:fulfilment__initial",
    ]);
    view.search("fulfil");
    expect([...view.highlight().active].sort()).toEqual([
      "state:fulfilment",
      "state:fulfilment__initial",
    ]);
  });

  test("a state gathers its transitions and their endpoints", async () => {
    const scene = await sceneOf(example());
    const view = createView(scene);
    view.hover({ kind: "state", id: "pending" });
    const { active } = view.highlight();
    expect([...active].sort()).toEqual([
      "state:__initial",
      "state:cancelled",
      "state:paid",
      "state:pending",
      "transition:t0",
      "transition:t3",
      "transition:t4",
    ]);
  });

  test("items resolve by reference and a composite can be selected", async () => {
    const scene = await sceneOf(example());
    const view = createView(scene);
    expect(view.item({ kind: "state", id: "fulfilment" })?.composite).toBe(true);
    expect(view.item({ kind: "transition", id: "t2" })?.from).toBe("picking");
    view.select({ kind: "state", id: "fulfilment" });
    expect(view.selected()).toEqual({ kind: "state", id: "fulfilment" });
  });
});
