import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { exportDocument } from "../src/export";
import { type Document, validate } from "../src/format";
import { toMermaid } from "../src/mermaid";
import { loadSource } from "../src/text";

const NAMES = readdirSync(new URL("../examples", import.meta.url))
  .filter((file) => file.endsWith(".json"))
  .map((file) => file.slice(0, -".json".length))
  .sort();

function example(name: string, extension = "json"): string {
  return readFileSync(new URL(`../examples/${name}.${extension}`, import.meta.url), "utf8");
}

function documentOf(value: unknown): Document {
  const result = validate(value);
  if (!result.ok) throw new Error(result.errors.map((error) => error.message).join("\n"));
  return result.document;
}

function graph(nodes: { id: string; label?: string; shape?: string }[], extra: object = {}): Document {
  return documentOf({ version: 1, kind: "graph", nodes, ...extra });
}

describe("examples", () => {
  test("there is one example per kind and shape set", () => {
    expect(NAMES.length).toBe(8);
  });

  for (const name of NAMES) {
    test(`${name} matches its snapshot`, () => {
      expect(toMermaid(documentOf(JSON.parse(example(name))))).toMatchSnapshot();
    });

    test(`${name}.sg gives the same output as ${name}.json`, () => {
      const json = loadSource(example(name));
      const text = loadSource(example(name, "sg"));
      if (!json.ok || !text.ok) throw new Error(name);
      expect(toMermaid(text.document)).toEqual(toMermaid(json.document));
    });
  }
});

describe("ids", () => {
  test("characters outside [A-Za-z0-9_] become underscores", () => {
    const { text } = toMermaid(graph([{ id: "a b" }, { id: "é.x" }]));
    expect(text).toContain('a_b("a b")');
    expect(text).toContain('__x("é.x")');
  });

  test("a leading digit or a reserved word, in any case, gets the n_ prefix", () => {
    const ids = ["1a", "end", "End", "subgraph", "classDef", "state", "default", "href", "call", "direction"];
    const { text } = toMermaid(graph(ids.map((id) => ({ id }))));
    for (const id of ids) expect(text).toContain(`n_${id}("${id}")`);
    expect(text).not.toMatch(/^ {2}end\(/m);
  });

  test("collisions get _2, _3 in document order and edges follow the same table", () => {
    const { text } = toMermaid(
      graph([{ id: "a-b" }, { id: "a_b" }, { id: "a b" }, { id: "a_b_2" }], {
        edges: [
          { from: "a-b", to: "a_b" },
          { from: "a b", to: "a_b_2" },
        ],
      }),
    );
    expect(text).toContain('a_b("a-b")');
    expect(text).toContain('a_b_2("a_b")');
    expect(text).toContain('a_b_3("a b")');
    expect(text).toContain('a_b_2_2("a_b_2")');
    expect(text).toContain("a_b --> a_b_2");
    expect(text).toContain("a_b_3 --> a_b_2_2");
  });

  test("a node and a group sharing an id do not collide", () => {
    const { text } = toMermaid(
      graph([{ id: "x", label: "Node" }], { groups: [{ id: "x", label: "Group" }] }),
    );
    expect(text).toContain('x("Node")');
    expect(text).toContain('subgraph x_2 ["Group"]');
  });

  test("participants, states, entities and tree nodes use the same rules", () => {
    const sequence = toMermaid(
      documentOf({
        version: 1,
        kind: "sequence",
        participants: [{ id: "end" }, { id: "1" }],
        messages: [{ from: "end", to: "1", label: "go" }],
      }),
    ).text;
    expect(sequence).toContain("participant n_end");
    expect(sequence).toContain("n_end->>n_1: go");
    const entity = toMermaid(
      documentOf({
        version: 1,
        kind: "er",
        entities: [{ id: "order-item" }],
      }),
    ).text;
    expect(entity).toContain('order_item["order-item"] {');
  });
});

describe("labels", () => {
  test("quotes and line breaks are escaped inside quoted labels", () => {
    const { text } = toMermaid(
      graph([{ id: "a", label: 'say "hi"\nthere' }, { id: "b" }], {
        edges: [{ from: "a", to: "b", label: 'x "y"' }],
      }),
    );
    expect(text).toContain('a("say #quot;hi#quot;<br>there")');
    expect(text).toContain('a -->|"x #quot;y#quot;"| b');
  });

  test("sequence texts are not quoted and escape # and ;", () => {
    const { text } = toMermaid(
      documentOf({
        version: 1,
        kind: "sequence",
        participants: [{ id: "a", label: "A; B" }, { id: "b" }],
        messages: [{ from: "a", to: "b", label: "see #1; ok\nnext", style: "async" }],
      }),
    );
    expect(text).toContain("participant a as A#59; B");
    expect(text).toContain("a-)b: see #35;1#59; ok<br>next");
  });

  test("the title goes in the front matter with its quotes escaped", () => {
    const { text } = toMermaid(graph([{ id: "a" }], { title: 'The "main" flow' }));
    expect(text.startsWith('---\ntitle: "The \\"main\\" flow"\n---\nflowchart TD\n')).toBe(true);
  });

  test("a document without a title has no front matter", () => {
    expect(toMermaid(graph([{ id: "a" }])).text.startsWith("flowchart TD\n")).toBe(true);
  });
});

describe("graph", () => {
  test("directions, undirected and dotted edges, nested groups", () => {
    const { text } = toMermaid(
      documentOf({
        version: 1,
        kind: "graph",
        direction: "left",
        groups: [
          { id: "outer", label: "Outer" },
          { id: "inner", parent: "outer" },
        ],
        nodes: [
          { id: "a", group: "inner" },
          { id: "b", group: "outer" },
          { id: "c" },
        ],
        edges: [
          { from: "a", to: "b", directed: false },
          {
            from: "b",
            to: "c",
            directed: false,
            meta: { provenance: { source: "s", confidence: "unknown" } },
          },
          { from: "a", to: "c", meta: { provenance: { source: "s", confidence: "inferred" } } },
        ],
      }),
    );
    expect(text).toBe(
      [
        "flowchart RL",
        '  c("c")',
        '  subgraph outer ["Outer"]',
        '    b("b")',
        '    subgraph inner ["inner"]',
        '      a("a")',
        "    end",
        "  end",
        "  a --- b",
        "  b -.- c",
        "  a -.-> c",
        "",
      ].join("\n"),
    );
  });
});

describe("state", () => {
  const states = [
    { id: "i", pseudo: "initial" },
    { id: "a", label: "A" },
    { id: "box", label: "Box" },
    { id: "i2", pseudo: "initial", parent: "box" },
    { id: "x", parent: "box" },
    { id: "f2", pseudo: "final", parent: "box" },
    { id: "other", label: "Other" },
    { id: "y", parent: "other" },
    { id: "h", pseudo: "history", parent: "other" },
    { id: "f", pseudo: "final" },
  ];

  test("initial and final markers are written in the block of their region", () => {
    const { text } = toMermaid(
      documentOf({
        version: 1,
        kind: "state",
        states,
        transitions: [
          { from: "i", to: "a" },
          { from: "i2", to: "x" },
          { from: "x", to: "f2" },
          { from: "a", to: "box", event: "go" },
          { from: "box", to: "f" },
        ],
      }),
    );
    expect(text).toContain("  [*] --> a\n");
    expect(text).toContain("    [*] --> x\n    x --> [*]\n  }");
    expect(text).toContain("  a --> box : go\n");
    expect(text).toContain("  box --> [*]\n");
  });

  test("a transition between internal states of different composites is written and warned", () => {
    const result = toMermaid(
      documentOf({
        version: 1,
        kind: "state",
        states,
        transitions: [
          { from: "i", to: "a" },
          { from: "i2", to: "x" },
          { from: "x", to: "y" },
        ],
      }),
    );
    expect(result.text).toContain("\n  x --> y\n");
    expect(result.warnings).toContain(
      "a transition between internal states of different composites may be refused by Mermaid",
    );
    expect(result.warnings).toContain('pseudo-state "history" written as a plain state');
  });

  test("choice, fork and join are declared with their stereotype", () => {
    const { text } = toMermaid(
      documentOf({
        version: 1,
        kind: "state",
        direction: "up",
        states: [
          { id: "c", pseudo: "choice" },
          { id: "f", pseudo: "fork" },
          { id: "j", pseudo: "join" },
        ],
      }),
    );
    expect(text).toBe(
      [
        "stateDiagram-v2",
        "  direction BT",
        "  state c <<choice>>",
        "  state f <<fork>>",
        "  state j <<join>>",
        "",
      ].join("\n"),
    );
  });
});

describe("er", () => {
  test("types are sanitized, keys joined, cardinalities and operators mapped", () => {
    const { text, warnings } = toMermaid(
      documentOf({
        version: 1,
        kind: "er",
        entities: [
          {
            id: "a",
            attributes: [
              { name: "k", type: "decimal(10,2)", keys: ["pk", "fk"], note: 'the "key"' },
              { name: "n" },
              { name: "m", type: "2d point" },
            ],
          },
          { id: "b", label: "B" },
        ],
        relations: [
          { from: "a", to: "b", fromCardinality: "zero-or-one", toCardinality: "one-or-more" },
          {
            from: "b",
            to: "a",
            fromCardinality: "one-or-more",
            toCardinality: "zero-or-one",
            identifying: false,
            label: "back",
          },
          { from: "a", to: "a", fromCardinality: "zero-or-more" },
        ],
      }),
    );
    expect(text).toContain("    decimal(10_2) k PK, FK \"the key\"\n");
    expect(text).toContain("    any n\n");
    expect(text).toContain("    t_2d_point m\n");
    expect(text).toContain('  a |o--|{ b : ""\n');
    expect(text).toContain('  b }|..o| a : "back"\n');
    expect(text).toContain('  a }o--|| a : ""\n');
    expect(text).toContain('  b["B"] {\n  }\n');
    expect(warnings).toContain('relation cardinality missing, written as "one"');
  });
});

describe("mindmap", () => {
  test("shapes, special characters and unsupported shapes", () => {
    const { text, warnings } = toMermaid(
      documentOf({
        version: 1,
        kind: "tree",
        layout: "mindmap",
        nodes: [
          { id: "r", label: "Root", shape: "circle" },
          { id: "a", label: "A (x)", parent: "r", shape: "hexagon" },
          { id: "b", label: '"quoted"', parent: "a", shape: "rect" },
          { id: "c", label: "C", parent: "r", shape: "diamond" },
          { id: "d", label: "back`tick", parent: "r" },
        ],
      }),
    );
    expect(text).toBe(
      [
        "mindmap",
        "  r((Root))",
        '    a{{"`A (x)`"}}',
        '      b["`"quoted"`"]',
        "    c[C]",
        "    d(back`tick)",
        "",
      ].join("\n"),
    );
    expect(warnings).toEqual(['shape "diamond" written as a rectangle']);
  });
});

describe("tree", () => {
  test("the tree layout is a flowchart with parent --- child edges", () => {
    const { text } = toMermaid(
      documentOf({
        version: 1,
        kind: "tree",
        direction: "right",
        nodes: [
          { id: "r", label: "Root", shape: "pill" },
          { id: "a", label: "A", parent: "r" },
        ],
      }),
    );
    expect(text).toBe(['flowchart LR', '  r(["Root"])', '  a("A")', "  r --- a", ""].join("\n"));
  });
});

describe("warnings", () => {
  test("edge description, link and weight are reported", () => {
    const { warnings } = toMermaid(
      graph([{ id: "a" }, { id: "b" }], {
        edges: [{ from: "a", to: "b", description: "d", link: "https://x.test", weight: 3 }],
      }),
    );
    expect(warnings).toEqual(["description dropped", "link dropped", "weight dropped"]);
  });

  test("a loss is reported once per category", () => {
    const { warnings } = toMermaid(
      graph(
        [
          { id: "a", shape: "ellipse", type: "t", link: "l" } as any,
          { id: "b", shape: "ellipse", type: "u", description: "d", meta: { coverage: 1 } } as any,
          { id: "c", shape: "document", position: { x: 1, y: 2 } } as any,
        ],
        { meta: { coverage: 0.5 } },
      ),
    );
    expect(warnings).toEqual([
      "metadata dropped",
      "type dropped",
      "link dropped",
      "description dropped",
      "position dropped",
      'shape "ellipse" written as a circle',
      'shape "document" written as a rectangle',
    ]);
  });

  test("more than 500 edges", () => {
    const edges = Array.from({ length: 501 }, () => ({ from: "a", to: "b" }));
    const nodes = [{ id: "a" }, { id: "b" }];
    expect(toMermaid(graph(nodes, { edges })).warnings).toEqual([
      "More than 500 edges: Mermaid's default maxEdges may refuse to render",
    ]);
    expect(toMermaid(graph(nodes, { edges: edges.slice(0, 500) })).warnings).toEqual([]);
  });

  test("a text of more than 50000 characters", () => {
    const { warnings } = toMermaid(graph([{ id: "a", label: "x".repeat(50000) }]));
    expect(warnings).toEqual(["Mermaid's default maxTextSize (50000) is exceeded"]);
  });
});

describe("exportDocument", () => {
  test("returns the Mermaid text without a layout, next to the other formats", async () => {
    const source = example("order-state");
    const only = await exportDocument(source, { formats: ["mermaid"] });
    expect(Object.keys(only)).toEqual(["mermaid"]);
    const loaded = loadSource(source);
    if (!loaded.ok) throw new Error("invalid example");
    expect(only.mermaid).toBe(toMermaid(loaded.document).text);
    const both = await exportDocument(source, { formats: ["svg", "mermaid"] });
    expect(both.svg).toContain("<svg");
    expect(both.mermaid).toBe(only.mermaid);
  });
});
