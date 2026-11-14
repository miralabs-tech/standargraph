import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parse, type TextError } from "../src/text";

function format(error: TextError): string {
  return `${error.line}:${error.column}: ${error.message} [${error.code}]`;
}

function doc(source: string): Record<string, any> {
  const result = parse(source);
  if (!result.ok) throw new Error(result.errors.map(format).join("\n"));
  return result.document as Record<string, any>;
}

function errors(source: string): TextError[] {
  const result = parse(source);
  if (result.ok) throw new Error("expected the parse to fail");
  return result.errors;
}

function example(name: string): Record<string, any> {
  const { $schema, ...rest } = JSON.parse(
    readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf8"),
  );
  return rest;
}

const GRAPH = `# Deploy pipeline as a flowchart
graph "Deploy pipeline"

start "Push to main" [shape=pill]
build "Build and test"
ok "Tests green?" [shape=diamond]
deploy "Deploy" [shape=subroutine]
db "Release table" [type="database", shape=cylinder]
fix "Open an issue" [shape=document]
done "Done" [shape=pill]

start -> build -> ok
ok -> deploy "yes"
ok -> fix "no"
deploy -> db "records"
deploy -> done
`;

const GRAPH_WORDS = `graph "Deploy pipeline"

start "Push to main" [shape=pill]
build "Build and test"
ok "Tests green?" [shape=diamond]
deploy "Deploy" [shape=subroutine]
db "Release table" [type="database", shape=cylinder]
fix "Open an issue" [shape=document]
done "Done" [shape=pill]

start to build to ok
ok to deploy "yes"
ok to fix "no"
deploy to db "records"
deploy to done
`;

const GRAPH_JSON = {
  version: 1,
  kind: "graph",
  title: "Deploy pipeline",
  nodes: [
    { id: "start", label: "Push to main", shape: "pill" },
    { id: "build", label: "Build and test" },
    { id: "ok", label: "Tests green?", shape: "diamond" },
    { id: "deploy", label: "Deploy", shape: "subroutine" },
    { id: "db", label: "Release table", type: "database", shape: "cylinder" },
    { id: "fix", label: "Open an issue", shape: "document" },
    { id: "done", label: "Done", shape: "pill" },
  ],
  edges: [
    { from: "start", to: "build", directed: true },
    { from: "build", to: "ok", directed: true },
    { from: "ok", to: "deploy", label: "yes", directed: true },
    { from: "ok", to: "fix", label: "no", directed: true },
    { from: "deploy", to: "db", label: "records", directed: true },
    { from: "deploy", to: "done", directed: true },
  ],
};

const SEQUENCE = `sequence "Token refresh"

app "App" [type="client"]
auth "Authorization server" [type="service"]

app -> auth "POST /token"
auth --> app "Access token"
app ->> app "Schedule refresh"
`;

const SEQUENCE_WORDS = `sequence "Token refresh"

app "App" [type="client"]
auth "Authorization server" [type="service"]

app to auth "POST /token"
auth reply app "Access token"
app async app "Schedule refresh"
`;

const SEQUENCE_JSON = {
  version: 1,
  kind: "sequence",
  title: "Token refresh",
  participants: [
    { id: "app", label: "App", type: "client" },
    { id: "auth", label: "Authorization server", type: "service" },
  ],
  messages: [
    { from: "app", to: "auth", label: "POST /token", style: "sync" },
    { from: "auth", to: "app", label: "Access token", style: "reply" },
    { from: "app", to: "app", label: "Schedule refresh", style: "async" },
  ],
};

const STATE = `state "Order lifecycle" [direction=right]

* -> pending
pending "Pending" [actions=["entry / reserve stock"]]
paid "Paid"
cancelled "Cancelled" [source="src/orders/machine.ts", confidence=confirmed]
fulfilment "Fulfilment" {
  * -> picking
  picking "Picking"
  shipped "Shipped"
  picking -> shipped "handed to carrier" [action="notify customer"]
}
check [pseudo=choice]

pending -> paid "payment received"
pending -> cancelled "timeout" [guard="after 30 min"]
paid -> fulfilment
shipped -> check "delivery report"
check -> * [guard="delivered"]
check -> cancelled [guard="lost"]
cancelled -> *
`;

const STATE_WORDS = `state "Order lifecycle" [direction=right]

initial to pending
pending "Pending" [actions=["entry / reserve stock"]]
paid "Paid"
cancelled "Cancelled" [source="src/orders/machine.ts", confidence=confirmed]
fulfilment "Fulfilment" do
  initial to picking
  picking "Picking"
  shipped "Shipped"
  picking to shipped "handed to carrier" [action="notify customer"]
end
check [pseudo=choice]

pending to paid "payment received"
pending to cancelled "timeout" [guard="after 30 min"]
paid to fulfilment
shipped to check "delivery report"
check to final [guard="delivered"]
check to cancelled [guard="lost"]
cancelled to final
`;

const ER = `er "Shop orders"

customer "Customer" {
  id uuid pk
  email varchar(255) uk
  name text
}
order "Order" {
  id uuid pk
  customer_id uuid fk
  placed_at timestamp
  note text null [note="free text from checkout"]
}
order_item "Order item" {
  order_id uuid pk fk
  product_id uuid pk fk
  quantity int
}
product "Product" [type="catalog"] {
  id uuid pk
  price decimal(10,2)
}

customer 1 .. 0..* order "places"
order 1 -- 1..* order_item "contains"
product 1 -- 0..* order_item "appears in"
`;

const ER_WORDS = `er "Shop orders"

customer "Customer" do
  id uuid pk
  email varchar(255) uk
  name text
end
order "Order" do
  id uuid pk
  customer_id uuid fk
  placed_at timestamp
  note text null [note="free text from checkout"]
end
order_item "Order item" do
  order_id uuid pk fk
  product_id uuid pk fk
  quantity int
end
product "Product" [type="catalog"] do
  id uuid pk
  price decimal(10, 2)
end

customer 1 via 0..* order "places"
order 1 with 1..* order_item "contains"
product 1 with 0..* order_item "appears in"
`;

const TREE = `tree "StandarGraph v1" [layout=mindmap]

StandarGraph v1 [shape=pill]
  Format
    graph
    sequence
    state, er, tree
  Rendering [id=render]
    SVG
    WebGL [description="Sigma.js above 2000 nodes"]
  "Text syntax [J8]"
  GitHub
    Mermaid export
    Pages demo
`;

describe("section 7.7 examples", () => {
  test("graph", () => {
    expect(doc(GRAPH)).toEqual(GRAPH_JSON);
  });

  test("sequence", () => {
    expect(doc(SEQUENCE)).toEqual(SEQUENCE_JSON);
  });

  test("state", () => {
    expect(doc(STATE)).toEqual(example("order-state.json"));
  });

  test("er", () => {
    expect(doc(ER)).toEqual(example("shop-er.json"));
  });

  test("tree", () => {
    expect(doc(TREE)).toEqual(example("roadmap-mindmap.json"));
  });
});

describe("section 7.4 bis, the word form", () => {
  test("every example rewritten in words gives the same document", () => {
    expect(doc(GRAPH_WORDS)).toEqual(doc(GRAPH));
    expect(doc(SEQUENCE_WORDS)).toEqual(SEQUENCE_JSON);
    expect(doc(STATE_WORDS)).toEqual(doc(STATE));
    expect(doc(ER_WORDS)).toEqual(doc(ER));
  });

  test("symbols and words mix in one file", () => {
    const mixed = `state "Mixed"
initial -> a
a "A" do
  initial to a1
  a1 -> a2
  a2 -> *
end
a to final
`;
    const symbols = `state "Mixed"
* -> a
a "A" {
  * -> a1
  a1 -> a2
  a2 -> *
}
a -> *
`;
    expect(doc(mixed)).toEqual(doc(symbols));
  });

  test("a graph mixing -> and to, -- and with", () => {
    const mixed = `graph
a -> b to c
c with d -- e
`;
    expect(doc(mixed).edges).toEqual([
      { from: "a", to: "b", directed: true },
      { from: "b", to: "c", directed: true },
      { from: "c", to: "d", directed: false },
      { from: "d", to: "e", directed: false },
    ]);
  });

  test("do and end open and close group blocks", () => {
    const text = `graph
group outer "Outer" do
  a
  group inner do
    b
  end
  c
end
`;
    const symbols = `graph
group outer "Outer" {
  a
  group inner {
    b
  }
  c
}
`;
    expect(doc(text)).toEqual(doc(symbols));
    expect(doc(text).groups).toEqual([
      { id: "outer", label: "Outer" },
      { id: "inner", parent: "outer" },
    ]);
  });

  test("a node named `to`, then to used as an id outside the operator position", () => {
    const text = `graph
\`to\` "Target"
a to \`to\`
to to a
with
via -> async
`;
    const document = doc(text);
    expect(document.nodes.map((node: { id: string }) => node.id)).toEqual([
      "to",
      "a",
      "with",
      "via",
      "async",
    ]);
    expect(document.nodes[0]).toEqual({ id: "to", label: "Target" });
    expect(document.edges).toEqual([
      { from: "a", to: "to", directed: true },
      { from: "to", to: "a", directed: true },
      { from: "via", to: "async", directed: true },
    ]);
  });

  test("a node named like a word is an operator when it sits in operator position", () => {
    expect(errors("graph\na to")[0]).toMatchObject({
      code: "E_EXPECTED",
      message: "Expected an id, found end of file",
    });
  });

  test("initial and final are ordinary ids outside transitions", () => {
    const document = doc(`state
initial "Initial"
final "Final"
x -> \`final\`
`);
    expect(document.states.map((state: { id: string }) => state.id)).toEqual(["initial", "final", "x"]);
    expect(document.transitions).toEqual([{ from: "x", to: "final" }]);
  });

  test("E_BLOCK when a do block closes with a brace", () => {
    const found = errors(`graph
group g do
  a
}
`);
    expect(found).toHaveLength(1);
    expect(found[0]).toEqual({
      line: 4,
      column: 1,
      endLine: 4,
      endColumn: 2,
      code: "E_BLOCK",
      message: 'block opened with "do" must close with "end"',
    });
  });

  test("E_BLOCK when a brace block closes with end", () => {
    const found = errors(`graph
group g {
  a
end
`);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      line: 4,
      code: "E_BLOCK",
      message: 'block opened with "{" must close with "}"',
    });
  });

  test("E_BLOCK for a block never closed and for a stray closer", () => {
    expect(errors("graph\ngroup g {\n  a\n").map(format)).toEqual([
      "2:9: Block opened at line 2 is never closed [E_BLOCK]",
    ]);
    expect(errors("graph\na\n}\n").map(format)).toEqual(['3:1: Unexpected "}" [E_BLOCK]']);
    expect(errors("graph\ngroup g do\n  a\n").map((error) => error.code)).toEqual(["E_BLOCK"]);
  });

  test("end alone on a line outside any block is an ordinary node", () => {
    expect(doc("graph\nend\n").nodes).toEqual([{ id: "end" }]);
  });
});

describe("construction", () => {
  test("header comments, BOM and CRLF", () => {
    const text = "\uFEFF# first\r\n\r\ngraph \"T\" [direction=up] # tail\r\na -> b\r\n";
    expect(doc(text)).toEqual({
      version: 1,
      kind: "graph",
      title: "T",
      direction: "up",
      nodes: [{ id: "a" }, { id: "b" }],
      edges: [{ from: "a", to: "b", directed: true }],
    });
  });

  test("a header attribute list over several lines", () => {
    const document = doc(`graph "T" [
  direction=right,
  source="x.ts",
]
a
`);
    expect(document.direction).toBe("right");
    expect(document.meta).toEqual({ provenance: { source: "x.ts" } });
  });

  test("mandatory arrays are always emitted and optional ones only when filled", () => {
    expect(doc("graph")).toEqual({ version: 1, kind: "graph", nodes: [] });
    expect(doc("graph\na")).toEqual({ version: 1, kind: "graph", nodes: [{ id: "a" }] });
    expect(doc("sequence\na")).toEqual({
      version: 1,
      kind: "sequence",
      participants: [{ id: "a" }],
      messages: [],
    });
  });

  test("the operator fixes directed, style and identifying", () => {
    const document = doc("graph\na -> b\nb -- c\n");
    expect(document.edges.map((edge: { directed: boolean }) => edge.directed)).toEqual([true, false]);
    expect(doc("er\na -- b\nb .. c\n").relations.map((r: { identifying: boolean }) => r.identifying)).toEqual([
      true,
      false,
    ]);
  });

  test("a chain makes one edge per pair with the same label and attributes", () => {
    const document = doc('graph\na -> b -- c "x" [type="calls", source="s"]\n');
    expect(document.edges).toEqual([
      { from: "a", to: "b", label: "x", type: "calls", directed: true, meta: { provenance: { source: "s" } } },
      { from: "b", to: "c", label: "x", type: "calls", directed: false, meta: { provenance: { source: "s" } } },
    ]);
  });

  test("an edge id on a single edge, but not on a chain", () => {
    expect(doc("graph\na -> b [id=e1]\n").edges[0].id).toBe("e1");
    const found = errors("graph\na -> b -> c [id=e1]\n");
    expect(found.map(format)).toEqual([
      "2:14: id cannot be set on a chain of several edges [E_ATTR]",
    ]);
  });

  test("first mention declares, in order of first mention", () => {
    const document = doc("graph\nb -> a\na \"Alpha\"\nc\n");
    expect(document.nodes).toEqual([{ id: "b" }, { id: "a", label: "Alpha" }, { id: "c" }]);
  });

  test("groups, nested groups and nodes declared inside", () => {
    const document = doc(`graph
group g1 "One" {
  a
  group g2 {
    b -> c
  }
  d
}
e
a -> e
`);
    expect(document.groups).toEqual([{ id: "g1", label: "One" }, { id: "g2", parent: "g1" }]);
    expect(document.nodes).toEqual([
      { id: "a", group: "g1" },
      { id: "b", group: "g2" },
      { id: "c", group: "g2" },
      { id: "d", group: "g1" },
      { id: "e" },
    ]);
  });

  test("node attributes, coordinates and meta", () => {
    const document = doc(`graph
n "N" [
  type=file, shape="hexagon", link="https://x.y", description="d",
  x=1.5, y=-2,
  source="a.ts", confidence=inferred, tool="scip", coverage=0.5, freshness="2026-11-14T09:30:00Z",
  data.flag=true, data.text="true", data.n=3, \`data.first name\`="Ada"
]
`);
    expect(document.nodes[0]).toEqual({
      id: "n",
      label: "N",
      type: "file",
      shape: "hexagon",
      link: "https://x.y",
      description: "d",
      position: { x: 1.5, y: -2 },
      meta: {
        provenance: { source: "a.ts", confidence: "inferred", tool: "scip" },
        coverage: 0.5,
        freshness: "2026-11-14T09:30:00Z",
        data: { flag: true, text: "true", n: 3, "first name": "Ada" },
      },
    });
  });

  test("quoted ids and string escapes", () => {
    const document = doc('graph\n`404` "Not \\"found\\"\\n#1"\n`PATCH /api` -> `404`\n');
    expect(document.nodes).toEqual([
      { id: "404", label: 'Not "found"\n#1' },
      { id: "PATCH /api" },
    ]);
  });

  test("states: stars are scoped to the region", () => {
    const document = doc(`state
* -> a
a {
  * -> b
  b -> *
}
`);
    expect(document.states).toEqual([
      { id: "__initial", pseudo: "initial" },
      { id: "a" },
      { id: "a__initial", pseudo: "initial", parent: "a" },
      { id: "b", parent: "a" },
      { id: "a__final", pseudo: "final", parent: "a" },
    ]);
  });

  test("a star conflicts with a state of the same id and another pseudo", () => {
    const found = errors("state\n__initial [pseudo=choice]\n* -> a\n");
    expect(found.map((error) => error.code)).toEqual(["E_VALUE"]);
    expect(found[0]?.line).toBe(3);
  });

  test("actions=[] is kept and an empty entity block gives attributes: []", () => {
    expect(doc("state\ns [actions=[]]\n").states[0]).toEqual({ id: "s", actions: [] });
    expect(doc("er\ne {\n}\nf\n").entities).toEqual([{ id: "e", attributes: [] }, { id: "f" }]);
  });

  test("entity attributes: types, flags, notes", () => {
    const document = doc(`er
t {
  a
  b int[]
  c decimal(10, 2) pk null
  d "double precision" uk fk
  e pk
  f [note="only a note"]
  g text [note="n"]
  h "pk"
  id.x varchar(8) [note="dotted"]
}
`);
    expect(document.entities[0].attributes).toEqual([
      { name: "a" },
      { name: "b", type: "int[]" },
      { name: "c", type: "decimal(10,2)", keys: ["pk"], nullable: true },
      { name: "d", type: "double precision", keys: ["uk", "fk"] },
      { name: "e", keys: ["pk"] },
      { name: "f", note: "only a note" },
      { name: "g", type: "text", note: "n" },
      { name: "h", type: "pk" },
      { name: "id.x", type: "varchar(8)", note: "dotted" },
    ]);
  });

  test("relation cardinalities", () => {
    const document = doc(`er
a 0..1 -- 1..* b
a 1 .. 0..* b
a -- b
c with d
`);
    expect(document.relations).toEqual([
      { from: "a", to: "b", fromCardinality: "zero-or-one", toCardinality: "one-or-more", identifying: true },
      { from: "a", to: "b", fromCardinality: "one", toCardinality: "zero-or-more", identifying: false },
      { from: "a", to: "b", identifying: true },
      { from: "c", to: "d", identifying: true },
    ]);
  });

  test("the same text always gives the same document", () => {
    expect(doc(GRAPH)).toEqual(doc(GRAPH));
    expect(JSON.stringify(doc(STATE))).toBe(JSON.stringify(doc(STATE)));
  });

  test("architecture.json written as text", () => {
    const document = doc(`graph "Settings page flow" [direction=down]

group frontend "Frontend" {
  GeneralSettings "GeneralSettings" [type="page"]
  ThemeSelector "ThemeSelector" [type="component"]
  useSettings "useSettings" [type="hook"]
}
group backend "Backend" {
  PatchSettings "PATCH /api/settings" [type="endpoint"]
  SettingsController "settings.controller" [type="handler"]
  SettingsService "SettingsService" [type="service"]
}
group storage "Storage" {
  SettingsRepository "SettingsRepository" [type="repository"]
  SettingsTable "settings table" [type="database"]
}

GeneralSettings -> ThemeSelector "renders"
GeneralSettings -> useSettings "uses"
useSettings -> PatchSettings "calls"
PatchSettings -> SettingsController "handles"
SettingsController -> SettingsService "delegates"
SettingsService -> SettingsRepository "uses"
SettingsRepository -> SettingsTable "reads/writes"
`);
    expect(document).toEqual(example("architecture.json"));
  });

  test("protocol.json written as text", () => {
    const document = doc(`sequence "OAuth 2.0 authorization code flow with PKCE"
browser "Browser" [type="client"]
app "App" [type="client"]
auth "Authorization server" [type="service"]
api "API" [type="service"]

browser -> app "Click sign in"
app -> app "Generate code_verifier and code_challenge"
app --> browser "Redirect to /authorize with code_challenge"
browser -> auth "GET /authorize"
auth --> browser "Login and consent, redirect with code"
browser ->> app "Callback with authorization code"
app -> auth "POST /token with code and code_verifier"
auth --> app "Access token and refresh token"
app -> api "GET /resource with bearer token"
api --> app "Protected resource"
`);
    expect(document).toEqual(example("protocol.json"));
  });
});

describe("tree lines", () => {
  test("repo-tree.json written as text", () => {
    const document = doc(`tree "Repository layout"
standargraph [id=repo, type=folder, shape=pill]
  src [type=folder]
    format [type=folder, description="Schema and semantic checks"]
    layout [type=folder]
    svg [type=folder]
    html [type=folder]
  tests [type=folder]
    browser [type=folder]
  examples [type=folder]
  README.md [id=readme, type=file, shape=document]
`);
    expect(document).toEqual(example("repo-tree.json"));
  });

  test("slugs: diacritics, symbols, empty and collisions in pre-order", () => {
    const document = doc(`tree
Root
  Café Crème
  Café Crème
    !!!
    ???
  café-crème
  "Café Crème" [id=cafe-creme-2]
`);
    expect(document.nodes.map((node: { id: string }) => node.id)).toEqual([
      "root",
      "cafe-creme",
      "cafe-creme-3",
      "node",
      "node-2",
      "cafe-creme-4",
      "cafe-creme-2",
    ]);
    expect(document.nodes[3].parent).toBe("cafe-creme-3");
  });

  test("indentation can be tabs, with any width, but must fall back exactly", () => {
    const tabs = doc("tree\nroot\n\ta\n\t\tb\n\tc\n");
    expect(tabs.nodes.map((node: { parent?: string }) => node.parent)).toEqual([undefined, "root", "a", "root"]);
    const wide = doc("tree\nroot\n    a\n        b\n    c\n");
    expect(wide.nodes).toEqual(tabs.nodes);
  });

  test("a bad fallback is an E_INDENT listing the open levels", () => {
    const found = errors("tree\nroot\n  a\n    b\n   c\n");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      code: "E_INDENT",
      line: 5,
      column: 1,
      message: "Indentation of 3 does not match an open level (0, 2, 4)",
    });
  });

  test("tabs and spaces mixed", () => {
    expect(errors("tree\nroot\n \ta\n")[0]).toMatchObject({ code: "E_INDENT", line: 3 });
    expect(errors("tree\nroot\n  a\n\tb\n")[0]).toMatchObject({
      code: "E_INDENT",
      message: "Tabs and spaces are mixed in indentation",
    });
  });

  test("a second root", () => {
    const found = errors("tree\n# c\nroot\n  a\nother\n");
    expect(found.map(format)).toEqual([
      "5:1: A tree has one root; this line starts a second one (first root at line 3) [E_ROOT]",
    ]);
  });

  test("an indented first line", () => {
    expect(errors("tree\n  root\n")[0]).toMatchObject({ code: "E_INDENT", line: 2 });
  });

  test("bare text stops at # and [", () => {
    const document = doc(`tree
root # a comment
  child one   [type=x] # another
  "C# basics"
  "with [brackets]" [description="d"]
`);
    expect(document.nodes).toEqual([
      { id: "root", label: "root" },
      { id: "child-one", label: "child one", parent: "root", type: "x" },
      { id: "c-basics", label: "C# basics", parent: "root" },
      { id: "with-brackets", label: "with [brackets]", parent: "root", description: "d" },
    ]);
  });

  test("bare text with a quote", () => {
    const found = errors('tree\nroot\n  say "hi"\n');
    expect(found[0]).toMatchObject({ code: "E_TOKEN", line: 3, column: 7 });
  });

  test("a line that starts with an attribute list has no label", () => {
    expect(errors("tree\nroot\n  [type=x]\n")[0]).toMatchObject({ code: "E_EXPECTED", line: 3 });
  });

  test("attributes over several lines on a tree line", () => {
    const document = doc('tree\nroot [\n  type=a,\n  description="x"\n]\n  child\n');
    expect(document.nodes[0]).toMatchObject({ type: "a", description: "x" });
    expect(document.nodes[1].parent).toBe("root");
  });

  test("duplicate explicit ids", () => {
    expect(errors("tree\nroot [id=a]\n  x [id=a]\n").map(format)).toEqual([
      '3:9: Node "a" is already declared at line 2 [E_DUPLICATE]',
    ]);
  });

  test("direction and mindmap together is a validation error at the attribute", () => {
    const found = errors('tree [layout=mindmap, direction=right]\nroot\n');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      code: "E_VALIDATE",
      line: 1,
      column: 33,
      message: 'direction does not apply to layout "mindmap"',
    });
  });
});

describe("errors, section 7.8", () => {
  test("E_HEADER", () => {
    expect(errors('foo "x"\n')[0]).toEqual({
      line: 1,
      column: 1,
      endLine: 1,
      endColumn: 4,
      code: "E_HEADER",
      message: 'Expected a header such as graph "Title" (kinds: graph, sequence, state, er, tree)',
    });
    expect(errors('"graph"')[0]?.code).toBe("E_HEADER");
    expect(errors("`graph`")[0]?.code).toBe("E_HEADER");
  });

  test("E_TOKEN, E_STRING, E_ESCAPE come with the right range", () => {
    expect(errors("graph\na % b\n").map(format)).toEqual(['2:3: Unexpected character "%" [E_TOKEN]']);
    expect(errors('graph\na "open\n').map(format)).toEqual(["2:3: Unterminated string [E_STRING]"]);
    expect(errors('graph\na "x\\q"\n').map(format)).toEqual(['2:5: Unknown escape "\\q" in string [E_ESCAPE]']);
  });

  test("E_EXPECTED", () => {
    expect(errors("graph\n-> a\n").map(format)).toEqual(['2:1: Expected an id, found "->" [E_EXPECTED]']);
    expect(errors("graph\na -> \n").map(format)).toEqual([
      "2:6: Expected an id, found end of line [E_EXPECTED]",
    ]);
    expect(errors("graph\na [type]\n")[0]?.message).toBe('Expected "=" after attribute "type", found "]"');
    expect(errors("graph\na [type=]\n")[0]?.message).toBe('Expected a value, found "]"');
    expect(errors("graph\na [type=x y=z]\n")[0]?.message).toBe('Expected "," or "]", found "y"');
    expect(errors('graph\na "x" b\n')[0]?.message).toBe('Expected end of line, found "b"');
    expect(errors("graph\ngroup g\n")[0]?.message).toBe(
      'Expected "{" or "do" to open a block, found end of line',
    );
    expect(errors("graph\na [type=x\nb\n")[0]).toMatchObject({ code: "E_EXPECTED", line: 2, column: 3 });
  });

  test("E_OPERATOR", () => {
    expect(errors("graph\na --> b\n").map(format)).toEqual([
      '2:3: Operator "-->" does not exist in a graph (use -> or --) [E_OPERATOR]',
    ]);
    expect(errors("graph\na async b\n")[0]?.message).toBe(
      'Operator "async" does not exist in a graph (use to or with)',
    );
    expect(errors("sequence\na -- b\n")[0]?.message).toBe(
      'Operator "--" does not exist in a sequence diagram (use ->, ->> or -->)',
    );
    expect(errors("state\na -- b\n")[0]?.message).toBe(
      'Operator "--" does not exist in a state machine (use ->)',
    );
    expect(errors("er\na -> b\n")[0]?.message).toBe(
      'Operator "->" does not exist in an entity-relation diagram (use -- or ..)',
    );
  });

  test("E_ATTR", () => {
    expect(errors("graph\na [colour=red]\n").map(format)).toEqual([
      '2:4: Unknown attribute "colour" for a node (expected: type, shape, link, description, x, y, source, confidence, tool, coverage, freshness, data.*) [E_ATTR]',
    ]);
    expect(errors('graph\na [type="x", type="y"]\n')[0]?.message).toBe('Attribute "type" is set twice');
    expect(errors("graph [version=1]\n")[0]?.message).toBe("version is implied (1) in the text syntax");
    expect(errors("graph\na [confidence=confirmed]\n")[0]?.message).toBe(
      "confidence and tool need a source",
    );
    expect(errors("graph\na [x=1]\n")[0]?.message).toBe("x and y go together");
    expect(errors("sequence [direction=down]\na\n")[0]?.message).toBe(
      "Unknown attribute \"direction\" for the header (expected: source, confidence, tool, coverage, freshness, data.*)",
    );
    expect(errors("er\ne {\n  a [type=x]\n}\n")[0]?.message).toBe(
      'Unknown attribute "type" for an attribute (expected: note)',
    );
    expect(errors("graph\na [`data.`=1]\n")[0]?.code).toBe("E_ATTR");
  });

  test("E_VALUE", () => {
    expect(errors("graph\na [shape=triangle]\n").map(format)).toEqual([
      '2:10: Attribute "shape" expects one of box, rect, pill, diamond, circle, ellipse, hexagon, parallelogram, cylinder, document, subroutine; found "triangle" [E_VALUE]',
    ]);
    expect(doc('graph\na [shape="pill"]\n').nodes[0].shape).toBe("pill");
    expect(errors("graph\na [type=5]\n")[0]?.message).toBe('Attribute "type" expects a string; found 5');
    expect(errors('graph\na [x="1", y=2]\n')[0]?.message).toBe('Attribute "x" expects a number; found "1"');
    expect(errors("state\ns [actions=x]\n")[0]?.message).toBe(
      'Attribute "actions" expects a list of strings; found "x"',
    );
    expect(errors("graph\na [data.k=foo]\n")[0]?.message).toBe(
      'Attribute "data.k" expects a string, a number or a boolean; found "foo"',
    );
    expect(errors("er\na 2 -- b\n")[0]).toMatchObject({
      code: "E_VALUE",
      message: 'Cardinality must be 1, 0..1, 1..* or 0..*; found "2"',
    });
    expect(errors("graph [direction=sideways]\na\n")[0]?.message).toBe(
      'Attribute "direction" expects one of down, right, up, left; found "sideways"',
    );
  });

  test("E_DUPLICATE", () => {
    const found = errors(`graph
build
other
build "again"
`);
    expect(found.map(format)).toEqual(['4:1: Node "build" is already declared at line 2 [E_DUPLICATE]']);
    expect(errors("graph\ngroup g {\n}\ngroup g {\n}\n")[0]?.message).toBe(
      'Group "g" is already declared at line 2',
    );
    expect(errors("er\ne\ne\n")[0]?.code).toBe("E_DUPLICATE");
  });

  test("a later declaration completes an item mentioned earlier in the same block", () => {
    expect(doc('graph\na -> b\nb "Bee"\n').nodes[1]).toEqual({ id: "b", label: "Bee" });
  });

  test("E_REGION", () => {
    const found = errors(`state
fulfilment {
  picking -> shipped
}
picking "Picking"
`);
    expect(found.map(format)).toEqual([
      '5:1: State "picking" was first used in "fulfilment" at line 3 and cannot be declared in another block [E_REGION]',
    ]);

    expect(errors("graph\na -> b\ngroup g {\n  a\n}\n")[0]).toMatchObject({
      code: "E_REGION",
      message: 'Node "a" was first used in "root" at line 2 and cannot be declared in another block',
    });
    expect(doc("graph\ngroup g {\n  a\n}\na -> b\n").nodes[0]).toEqual({ id: "a", group: "g" });
  });

  test("E_VALIDATE points at the failing value", () => {
    const found = errors(`state
__initial [pseudo=initial]
x
__initial -> x
x -> __initial
`);
    expect(found.every((error) => error.code === "E_VALIDATE")).toBe(true);
    expect(found.map(format)).toEqual([
      '5:6: Transition into an initial pseudo-state "__initial" [E_VALIDATE]',
    ]);
    expect(errors("graph\na [coverage=2]\n").map((error) => `${error.line}:${error.column}:${error.code}`)).toEqual([
      "2:13:E_VALIDATE",
    ]);
    expect(errors('graph\na [freshness="yesterday"]\n')[0]).toMatchObject({
      code: "E_VALIDATE",
      line: 2,
      column: 14,
    });
  });

  test("a validation error with no exact entry falls back to the nearest one", () => {
    const found = errors("sequence\n");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ code: "E_VALIDATE", line: 1, column: 1 });
  });

  test("construction is not run while syntax errors remain", () => {
    const found = errors("graph\na\na\n-> b\n");
    expect(found.map((error) => error.code)).toEqual(["E_EXPECTED"]);
  });

  test("errors are sorted by position and the parser recovers line by line", () => {
    const found = errors(`graph
a -> -> b
c "unterminated
d %
group g {
  e
`);
    expect(found.map((error) => `${error.line}:${error.code}`)).toEqual([
      "2:E_EXPECTED",
      "3:E_STRING",
      "4:E_TOKEN",
      "5:E_BLOCK",
    ]);
  });

  test("a failed block opener still parses its body as a block", () => {
    const found = errors(`graph
group {
  a [bad=1]
}
b
`);
    expect(found.map(format)).toEqual(['2:7: Expected an id, found "{" [E_EXPECTED]']);
  });

  test("stops after 50 errors with Too many errors", () => {
    const found = errors(`graph\n${"-> a\n".repeat(80)}`);
    expect(found).toHaveLength(51);
    expect(found[50]?.message).toBe("Too many errors");
  });

  test("columns count UTF-16 units and a tab counts for one", () => {
    expect(errors('graph\n\t"\u{1F600}" -> b\n')[0]).toMatchObject({ line: 2, column: 2 });
    expect(errors("graph\n\u{1D49C} -> %\n")[0]).toMatchObject({ line: 2, column: 7 });
  });

  test("a version key is also refused in a tree header", () => {
    expect(errors("tree [version=1]\nroot\n")[0]?.message).toBe("version is implied (1) in the text syntax");
  });
});
