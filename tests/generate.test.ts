import { expect, test } from "bun:test";
import { generate } from "../scripts/generate";
import { validate } from "../src/format";

test("the same seed gives an identical document", () => {
  expect(generate({ nodes: 300, seed: 7 })).toEqual(generate({ nodes: 300, seed: 7 }));
  expect(generate({ nodes: 300, seed: 7 })).not.toEqual(generate({ nodes: 300, seed: 8 }));
});

test("generated documents validate and have the requested node count", () => {
  for (const nodes of [1, 2, 50, 1000]) {
    const document = generate({ nodes, seed: 1 });
    expect(document.nodes).toHaveLength(nodes);
    expect(validate(document).ok).toBe(true);
  }
});

test("edges refer to existing nodes and nodes are spread over the groups", () => {
  const document = generate({ nodes: 500, seed: 3, groups: 5 });
  const ids = new Set(document.nodes.map((node) => node.id));
  for (const edge of document.edges ?? []) {
    expect(ids.has(edge.from)).toBe(true);
    expect(ids.has(edge.to)).toBe(true);
  }
  expect(document.groups).toHaveLength(5);
  expect(new Set(document.nodes.map((node) => node.group)).size).toBe(5);
  expect((document.edges ?? []).length).toBe(Math.round(500 * 1.25));
});
