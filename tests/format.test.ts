import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { validate } from "../src/format";

function example(name: string): Record<string, any> {
  return JSON.parse(
    readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf8"),
  );
}

function pathsOf(input: unknown): string[] {
  const result = validate(input);
  if (result.ok) throw new Error("expected validation to fail");
  return result.errors.map((error) => error.path);
}

describe("examples", () => {
  for (const name of ["architecture.json", "protocol.json", "agent-output.json", "order-state.json", "shop-er.json", "roadmap-mindmap.json", "repo-tree.json"]) {
    test(`${name} is valid`, () => {
      const result = validate(example(name));
      expect(result.ok).toBe(true);
    });
  }
});

describe("structural errors", () => {
  test("missing version", () => {
    const doc = example("architecture.json");
    delete doc.version;
    const result = validate(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.path)).toContain("/version");
      expect(result.errors[0]?.message).toContain("version 1");
    }
  });

  test("version 2", () => {
    const doc = example("architecture.json");
    doc.version = 2;
    expect(pathsOf(doc)).toEqual(["/version"]);
  });

  test("unknown kind", () => {
    const doc = example("architecture.json");
    doc.kind = "pie";
    expect(pathsOf(doc)).toEqual(["/kind"]);
  });

  test("unknown property on a node", () => {
    const doc = example("architecture.json");
    doc.nodes[1].color = "red";
    expect(pathsOf(doc)).toEqual(["/nodes/1/color"]);
  });

  test("coverage out of range", () => {
    const doc = example("agent-output.json");
    doc.nodes[0].meta.coverage = 1.5;
    expect(pathsOf(doc)).toEqual(["/nodes/0/meta/coverage"]);
  });

  test("bad freshness", () => {
    const doc = example("agent-output.json");
    doc.meta.freshness = "yesterday";
    expect(pathsOf(doc)).toEqual(["/meta/freshness"]);
  });
});

describe("semantic errors", () => {
  test("dangling edge target", () => {
    const doc = example("architecture.json");
    doc.edges[2].to = "Nowhere";
    expect(pathsOf(doc)).toEqual(["/edges/2/to"]);
  });

  test("duplicate node id", () => {
    const doc = example("architecture.json");
    doc.nodes.push({ id: doc.nodes[0].id });
    expect(pathsOf(doc)).toEqual(["/nodes/8/id"]);
  });

  test("node in unknown group", () => {
    const doc = example("architecture.json");
    doc.nodes[0].group = "missing";
    expect(pathsOf(doc)).toEqual(["/nodes/0/group"]);
  });

  test("group parent cycle", () => {
    const doc = example("architecture.json");
    doc.groups[0].parent = "backend";
    doc.groups[1].parent = "frontend";
    expect(pathsOf(doc)).toEqual(["/groups/0/parent"]);
  });

  test("sequence message to unknown participant", () => {
    const doc = example("protocol.json");
    doc.messages[3].to = "ghost";
    expect(pathsOf(doc)).toEqual(["/messages/3/to"]);
  });
});
