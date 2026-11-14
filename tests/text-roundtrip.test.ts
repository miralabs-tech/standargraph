import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { generate } from "../scripts/generate";
import { validate, type Document, type Meta } from "../src/format";
import { canonicalize, parse, print, type PrintStyle } from "../src/text";

const EXAMPLES = new URL("../examples/", import.meta.url);
const STYLES: readonly PrintStyle[] = ["symbols", "words"];

function readJson(name: string): any {
  return JSON.parse(readFileSync(new URL(name, EXAMPLES), "utf8"));
}

function withoutSchema(name: string): any {
  const { $schema, ...rest } = readJson(name);
  return rest;
}

function names(extension: string): string[] {
  return readdirSync(EXAMPLES)
    .filter((file) => file.endsWith(extension))
    .map((file) => file.slice(0, -extension.length))
    .sort();
}

function reparse(text: string): Document {
  const result = parse(text);
  if (!result.ok) {
    throw new Error(
      `${result.errors.map((error) => `${error.line}:${error.column} ${error.message} [${error.code}]`).join("\n")}\n---\n${text}`,
    );
  }
  return result.document;
}

const META: Meta = {
  provenance: { source: "src/a.ts", confidence: "inferred", tool: "scanner" },
  coverage: 0.5,
  freshness: "2026-11-14T10:00:00Z",
  data: { plain: "text", "first name": "Ada", "1x": 1, "a..b": true, "x.y": "1", flag: false, n: -2.5 },
};

const GRAPH_EDGE_CASES: Document = {
  version: 1,
  kind: "graph",
  title: 'He said "hi" # not a comment',
  direction: "right",
  meta: { data: {} },
  nodes: [
    { id: "404", label: "Not found" },
    { id: "PATCH /api/settings", label: "line one\nline two\ttabbed" },
    { id: "to", label: "to" },
    { id: "group", label: "" },
    { id: "end", label: "# starts with hash" },
    { id: "café.v2/x-y", label: "Ünïcode \u0001 control", type: "file", link: "https://example.com/?a=1&b=2" },
    { id: "inside", group: "outer", label: "In outer", meta: META },
    { id: "ungrouped", shape: "diamond", position: { x: -10, y: 2.5 }, description: "d" },
    { id: "deep", group: "inner" },
    { id: "second", group: "other" },
    { id: "late", group: "outer" },
    { id: "last" },
  ],
  groups: [
    { id: "other", label: "Other", meta: {} },
    { id: "inner", parent: "outer", label: "Inner" },
    { id: "outer", label: 'Outer "quoted"', meta: { provenance: { source: "s" } } },
  ],
  edges: [
    { from: "404", to: "to", directed: false, label: "", type: "t" },
    { from: "to", to: "group", id: "e1", meta: { data: {} } },
    { from: "end", to: "inside", directed: true, meta: META },
    { from: "last", to: "last" },
  ],
};

const NUMBER_EDGE_CASES: Document = {
  version: 1,
  kind: "graph",
  nodes: [
    {
      id: "tiny",
      position: { x: 1e-7, y: 1e21 },
      meta: { coverage: 1e-7, data: { small: 1e-7, big: 1e21, negative: -1.5e-9, zero: -0 } },
    },
    { id: "negzero", position: { x: -0, y: -0 } },
    { id: "plain", position: { x: -10, y: 2.5 } },
  ],
  edges: [{ from: "tiny", to: "negzero", meta: { data: { n: -0 } } }],
};

const EMPTY_ARRAYS: Document = {
  version: 1,
  kind: "graph",
  nodes: [{ id: "a", meta: {} }],
  edges: [],
  groups: [],
  meta: {},
};

const SEQUENCE_EDGE_CASES: Document = {
  version: 1,
  kind: "sequence",
  title: "Weird",
  meta: META,
  participants: [
    { id: "app", label: "App", type: "client" },
    { id: "with", label: "" },
    { id: "api gateway", meta: { data: {} } },
  ],
  messages: [
    { from: "app", to: "with", label: "POST /x", style: "sync" },
    { from: "with", to: "api gateway", label: "async\nmsg", style: "async", meta: META },
    { from: "api gateway", to: "app", style: "reply" },
    { from: "app", to: "app", label: "implicit sync" },
  ],
};

const STATE_EDGE_CASES: Document = {
  version: 1,
  kind: "state",
  title: "States",
  direction: "left",
  states: [
    { id: "__initial", pseudo: "initial" },
    { id: "initial", label: "Initial word" },
    { id: "final", label: "Final word", actions: [] },
    { id: "box", label: "Box", actions: ["entry / a", 'exit / "b"'], type: "composite", meta: META },
    { id: "end", parent: "box", description: "d", link: "x" },
    { id: "box__initial", pseudo: "initial", parent: "box" },
    { id: "nested", parent: "box", label: "Nested" },
    { id: "deeper", parent: "nested" },
    { id: "choice", pseudo: "choice" },
    { id: "__final", pseudo: "final" },
  ],
  transitions: [
    { from: "__initial", to: "initial" },
    { from: "initial", to: "final", event: "go", guard: "x > 1", action: "run", type: "t", id: "t1" },
    { from: "final", to: "box" },
    { from: "box__initial", to: "end", event: "" },
    { from: "end", to: "deeper", meta: META },
    { from: "deeper", to: "choice" },
    { from: "choice", to: "__final", guard: "ok" },
  ],
};

const STATE_EMPTY_TRANSITIONS: Document = {
  version: 1,
  kind: "state",
  states: [{ id: "only", label: "Only" }],
  transitions: [],
};

const ER_EDGE_CASES: Document = {
  version: 1,
  kind: "er",
  title: "ER",
  direction: "down",
  entities: [
    {
      id: "end",
      label: "End",
      type: "t",
      description: "d",
      link: "l",
      meta: META,
      attributes: [
        { name: "pk", type: "uuid", keys: ["pk"] },
        { name: "end", type: "decimal(10,2)", keys: ["pk", "fk"], nullable: false },
        { name: "list", type: "int[]", nullable: true },
        { name: "free", type: "double precision" },
        { name: "flagged", type: "pk", keys: ["uk"] },
        { name: "digits", type: "1x" },
        { name: "empty", type: "" },
        { name: "with note", note: "just a note" },
        { name: "typed note", type: "text", note: 'with "quotes"', nullable: true, keys: [] },
        { name: "plain" },
        { name: "dotted.name", type: "ns.type(a,b)" },
      ],
    },
    { id: "empty", attributes: [] },
    { id: "bare" },
    { id: "to", label: "To", attributes: [{ name: "id", type: "int", keys: ["pk"] }] },
  ],
  relations: [
    { from: "end", to: "to", fromCardinality: "one", toCardinality: "zero-or-more", label: "has", identifying: true },
    { from: "to", to: "bare", fromCardinality: "zero-or-one", toCardinality: "one-or-more", identifying: false, id: "r1", type: "x" },
    { from: "bare", to: "empty" },
    { from: "empty", to: "end", identifying: false, meta: META },
  ],
};

const ER_EMPTY_RELATIONS: Document = {
  version: 1,
  kind: "er",
  entities: [{ id: "a", attributes: [{ name: "x", keys: [] }] }],
  relations: [],
};

const TREE_EDGE_CASES: Document = {
  version: 1,
  kind: "tree",
  title: "Tree",
  layout: "tree",
  direction: "right",
  meta: META,
  nodes: [
    { id: "child-b", label: "Child B", parent: "root" },
    { id: "grand", label: "Grand", parent: "child-a" },
    { id: "root", label: "The root", shape: "pill", meta: META },
    { id: "child-a", label: "Child A", parent: "root" },
    { id: "dup", label: "Same", parent: "root" },
    { id: "same-2", label: "Same", parent: "root" },
    { id: "same", label: "Same", parent: "child-b" },
    { id: "hash", label: "C# basics", parent: "child-b", type: "t", description: "d", link: "l" },
    { id: "quote", label: 'Say "x"', parent: "child-b" },
    { id: "bracket", label: "list [1]", parent: "child-b" },
    { id: "empty", label: "", parent: "grand" },
    { id: "padded", label: "  padded  ", parent: "grand" },
    { id: "multi", label: "two\nlines", parent: "grand" },
    { id: "accent", label: "Café", parent: "grand" },
    { id: "cafe", label: "Cafe", parent: "grand" },
    { id: "node", label: "###", parent: "grand" },
  ],
};

const CORPUS: readonly [string, Document][] = [
  ...names(".json").map((name): [string, Document] => [`examples/${name}.json`, readJson(`${name}.json`) as Document]),
  ["generate(300, seed 1)", generate({ nodes: 300, seed: 1 })],
  ["graph edge cases", GRAPH_EDGE_CASES],
  ["empty arrays", EMPTY_ARRAYS],
  ["number edge cases", NUMBER_EDGE_CASES],
  ["sequence edge cases", SEQUENCE_EDGE_CASES],
  ["state edge cases", STATE_EDGE_CASES],
  ["state with empty transitions", STATE_EMPTY_TRANSITIONS],
  ["er edge cases", ER_EDGE_CASES],
  ["er with empty relations", ER_EMPTY_RELATIONS],
  ["tree edge cases", TREE_EDGE_CASES],
];

describe("corpus", () => {
  for (const [name, document] of CORPUS) {
    test(`${name} is a valid document`, () => {
      const result = validate(document);
      expect(result.ok ? [] : result.errors).toEqual([]);
    });
  }
});

describe("round trip", () => {
  for (const style of STYLES) {
    for (const [name, document] of CORPUS) {
      test(`${name} (${style})`, () => {
        const text = print(document, { style });
        const parsed = reparse(text);
        expect(parsed).toEqual(canonicalize(document));
        expect(print(parsed, { style })).toBe(text);
      });
    }
  }

  test("both styles read back to the same document", () => {
    for (const [, document] of CORPUS) {
      expect(reparse(print(document, { style: "words" }))).toEqual(
        reparse(print(document, { style: "symbols" })),
      );
    }
  });

  test("the default style is symbols", () => {
    for (const [, document] of CORPUS) {
      expect(print(document)).toBe(print(document, { style: "symbols" }));
    }
  });

  test("print does not change its input", () => {
    const copy = structuredClone(TREE_EDGE_CASES);
    print(TREE_EDGE_CASES);
    expect(TREE_EDGE_CASES).toEqual(copy);
  });
});

describe("examples twins", () => {
  test("every JSON example has a text twin and the other way round", () => {
    expect(names(".sg")).toEqual(names(".json"));
  });

  for (const name of names(".json")) {
    const source = readFileSync(new URL(`${name}.sg`, EXAMPLES), "utf8");

    test(`${name}.sg parses to the canonical form of ${name}.json`, () => {
      expect(reparse(source)).toEqual(canonicalize(readJson(`${name}.json`) as Document));
    });

    if (name !== "deploy-flowchart") {
      test(`${name}.sg parses to ${name}.json without $schema`, () => {
        expect(reparse(source)).toEqual(withoutSchema(`${name}.json`));
      });
    }

    test(`${name}.sg survives printing in both styles`, () => {
      const document = reparse(source);
      for (const style of STYLES) {
        expect(reparse(print(document, { style }))).toEqual(document);
      }
    });
  }

  test("deploy-flowchart.json leaves directed implicit, which the text always writes", () => {
    const json = withoutSchema("deploy-flowchart.json");
    const parsed = reparse(readFileSync(new URL("deploy-flowchart.sg", EXAMPLES), "utf8"));
    expect(json.edges.every((edge: Record<string, unknown>) => edge.directed === undefined)).toBe(true);
    expect(parsed).toEqual({
      ...json,
      edges: json.edges.map((edge: object) => ({ ...edge, directed: true })),
    });
  });
});

describe("print output", () => {
  const SEQUENCE = readJson("protocol.json") as Document;

  test("symbols style writes operators and braces", () => {
    const text = print(GRAPH_EDGE_CASES);
    expect(text).toContain("group outer ");
    expect(text).toContain("{\n");
    expect(text).toContain("`404` -- `to`");
    expect(text).not.toContain(" do\n");
  });

  test("words style writes words and do/end", () => {
    const text = print(GRAPH_EDGE_CASES, { style: "words" });
    expect(text).toContain("`404` with `to`");
    expect(text).toContain(" do\n");
    expect(text).toContain("\nend\n");
    expect(text).not.toMatch(/ {$/m);
  });

  test("sequence operators follow the message style", () => {
    const symbols = print(SEQUENCE).split("\n");
    const words = print(SEQUENCE, { style: "words" }).split("\n");
    expect(symbols.some((line) => line.includes(" --> "))).toBe(true);
    expect(words.some((line) => line.includes(" reply "))).toBe(true);
    expect(words.some((line) => line.includes("->"))).toBe(false);
  });

  test("ER relations keep symbol cardinalities in both styles", () => {
    expect(print(ER_EDGE_CASES)).toContain("`end` 1 -- 0..* `to` \"has\"");
    expect(print(ER_EDGE_CASES, { style: "words" })).toContain("`end` 1 with 0..* `to` \"has\"");
    expect(print(ER_EDGE_CASES, { style: "words" })).toContain("via");
  });

  test("state pseudo-states are declared, never written with *", () => {
    const text = print(STATE_EDGE_CASES);
    expect(text).toContain("__initial [pseudo=initial]");
    expect(text).not.toContain("*");
  });

  test("escapes, backticks and bare tree labels", () => {
    expect(print(GRAPH_EDGE_CASES)).toContain('"line one\\nline two\\ttabbed"');
    expect(print(GRAPH_EDGE_CASES)).toContain("\\u{1}");
    expect(print(GRAPH_EDGE_CASES)).toContain("`PATCH /api/settings`");
    const tree = print(TREE_EDGE_CASES);
    expect(tree).toContain('\n    "C# basics"');
    expect(tree).toContain("\n  Child A");
    expect(tree).toContain('"  padded  "');
  });

  test("tree ids are written only when the slug differs", () => {
    const text = print(readJson("roadmap-mindmap.json") as Document);
    expect(text).toContain("Rendering [id=\"render\"]");
    expect(text).not.toContain('Format [');
  });

  test("numbers in exponent form and negative zero are written so they read back", () => {
    const text = print(NUMBER_EDGE_CASES);
    expect(text).toContain("x=1e-7, y=1e+21");
    expect(text).toContain("x=-0, y=-0");
    expect(text).toContain("data.zero=-0");
    const node = (reparse(text) as any).nodes.find((item: { id: string }) => item.id === "negzero");
    expect(Object.is(node.position.x, -0)).toBe(true);
    expect(Object.is(node.position.y, -0)).toBe(true);
  });

  test("data keys are bare only when they form a whole identifier", () => {
    const text = print(GRAPH_EDGE_CASES);
    expect(text).toContain("data.plain=\"text\"");
    expect(text).toContain("`data.first name`=\"Ada\"");
    expect(text).toContain("`data.a..b`=true");
    expect(text).toContain("data.1x=1");
    expect(text).toContain('data.flag=false');
  });

  test("nothing is written for empty optional parts", () => {
    expect(print(EMPTY_ARRAYS)).toBe('graph\n\na\n');
    expect(print(STATE_EMPTY_TRANSITIONS)).toBe('state\n\nonly "Only"\n');
  });
});

describe("canonicalize", () => {
  test("removes $schema and fills the defaults the text writes", () => {
    const result = canonicalize({
      $schema: "../schema/graph-document.v1.json",
      version: 1,
      kind: "graph",
      nodes: [{ id: "a" }, { id: "b" }],
      edges: [{ from: "a", to: "b" }],
    }) as Record<string, any>;
    expect(result.$schema).toBeUndefined();
    expect(result.edges).toEqual([{ from: "a", to: "b", directed: true }]);
  });

  test("fills message style and relation identifying", () => {
    const sequence = canonicalize({
      version: 1,
      kind: "sequence",
      participants: [{ id: "a" }],
      messages: [{ from: "a", to: "a" }],
    }) as Record<string, any>;
    expect(sequence.messages[0].style).toBe("sync");
    const er = canonicalize({
      version: 1,
      kind: "er",
      entities: [{ id: "a" }],
      relations: [{ from: "a", to: "a" }],
    }) as Record<string, any>;
    expect(er.relations[0].identifying).toBe(true);
  });

  test("drops empty optional arrays, nullable false, empty meta, keeps actions and attributes", () => {
    const state = canonicalize(STATE_EMPTY_TRANSITIONS) as Record<string, any>;
    expect("transitions" in state).toBe(false);
    const empty = canonicalize(EMPTY_ARRAYS) as Record<string, any>;
    expect(empty).toEqual({ version: 1, kind: "graph", nodes: [{ id: "a" }] });
    const er = canonicalize(ER_EDGE_CASES) as Record<string, any>;
    const attributes = er.entities[0].attributes;
    expect("nullable" in attributes[1]).toBe(false);
    expect("keys" in attributes[8]).toBe(false);
    expect(er.entities[1].attributes).toEqual([]);
    const state2 = canonicalize(STATE_EDGE_CASES) as Record<string, any>;
    expect(state2.states.find((item: { id: string }) => item.id === "final").actions).toEqual([]);
  });

  test("orders graph nodes, groups, states and tree nodes like the printer", () => {
    const graph = canonicalize(GRAPH_EDGE_CASES) as Record<string, any>;
    expect(graph.groups.map((group: { id: string }) => group.id)).toEqual(["other", "outer", "inner"]);
    expect(graph.nodes.map((node: { id: string }) => node.id)).toEqual([
      "404",
      "PATCH /api/settings",
      "to",
      "group",
      "end",
      "café.v2/x-y",
      "ungrouped",
      "last",
      "second",
      "inside",
      "late",
      "deep",
    ]);
    const state = canonicalize(STATE_EDGE_CASES) as Record<string, any>;
    expect(state.states.map((item: { id: string }) => item.id)).toEqual([
      "__initial",
      "initial",
      "final",
      "box",
      "end",
      "box__initial",
      "nested",
      "deeper",
      "choice",
      "__final",
    ]);
    const tree = canonicalize(TREE_EDGE_CASES) as Record<string, any>;
    expect(tree.nodes.map((node: { id: string }) => node.id).slice(0, 5)).toEqual([
      "root",
      "child-b",
      "same",
      "hash",
      "quote",
    ]);
  });

  test("does not change its input and is idempotent", () => {
    for (const [, document] of CORPUS) {
      const copy = structuredClone(document);
      const once = canonicalize(document);
      expect(document).toEqual(copy);
      expect(canonicalize(once)).toEqual(once);
    }
  });
});
