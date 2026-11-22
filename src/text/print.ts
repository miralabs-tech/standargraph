import type {
  Cardinality,
  Document,
  Entity,
  Meta,
} from "../format/schema";
import { groupNodes, preorder, walk } from "./canonical";
import { slug } from "./slug";

export type PrintStyle = "symbols" | "words";
export type PrintOptions = { style?: PrintStyle };

type Pair = [key: string, value: string];
type Operator = "->" | "--" | "->>" | "-->" | "..";
type Style = { ops: Readonly<Record<Operator, string>>; open: string; close: string };
type Fields = {
  id?: string;
  label?: string;
  type?: string;
  weight?: number;
  shape?: string;
  pseudo?: string;
  actions?: string[];
  guard?: string;
  action?: string;
  link?: string;
  description?: string;
  position?: { x: number; y: number };
  meta?: Meta;
};

const STYLES: Readonly<Record<PrintStyle, Style>> = {
  symbols: {
    ops: { "->": "->", "--": "--", "->>": "->>", "-->": "-->", "..": ".." },
    open: "{",
    close: "}",
  },
  words: {
    ops: { "->": "to", "--": "with", "->>": "async", "-->": "reply", "..": "via" },
    open: "do",
    close: "end",
  },
};

const IDENT_SOURCE = String.raw`[\p{L}_][\p{L}\p{N}_]*(?:[./-][\p{L}\p{N}_]+)*`;
const IDENT = new RegExp(`^${IDENT_SOURCE}$`, "u");
const NUMBER_SOURCE = String.raw`-?[0-9]+(?:\.[0-9]+)?`;
const TYPE_ARG = `(?:${NUMBER_SOURCE}|${IDENT_SOURCE})`;
const TYPE = new RegExp(
  String.raw`^${IDENT_SOURCE}(?:\(${TYPE_ARG}(?:,${TYPE_ARG})*\))?(?:\[\])?$`,
  "u",
);
const ESCAPED = /["\\\u0000-\u001f\u007f-\u009f]/g;
const ESCAPES: Readonly<Record<string, string>> = {
  '"': '\\"',
  "\\": "\\\\",
  "\n": "\\n",
  "\t": "\\t",
};
const WORDS = new Set(["to", "with", "async", "reply", "via", "initial", "final", "do", "end"]);
const GRAPH_RESERVED = new Set(["group"]);
const ATTRIBUTE_RESERVED = new Set(["pk", "fk", "uk", "null"]);
const FLAGS = new Set(["pk", "fk", "uk", "null"]);
const CARDINALITY_TEXT: Readonly<Record<Cardinality, string>> = {
  one: "1",
  "zero-or-one": "0..1",
  "one-or-more": "1..*",
  "zero-or-more": "0..*",
};

function numberText(value: number): string {
  return Object.is(value, -0) ? "-0" : String(value);
}

function quote(value: string): string {
  return `"${value.replace(ESCAPED, (char) => ESCAPES[char] ?? `\\u{${char.charCodeAt(0).toString(16)}}`)}"`;
}

function backticked(value: string): string {
  return `\`${value.replace(/[\\`]/g, "\\$&")}\``;
}

function ident(value: string, reserved?: ReadonlySet<string>): string {
  return IDENT.test(value) && !WORDS.has(value) && !reserved?.has(value)
    ? value
    : backticked(value);
}

function pad(depth: number): string {
  return "  ".repeat(depth);
}

function labelText(label: string | undefined): string {
  return label === undefined ? "" : ` ${quote(label)}`;
}

function attrText(pairs: readonly Pair[]): string {
  return pairs.length === 0 ? "" : ` [${pairs.map(([key, value]) => `${key}=${value}`).join(", ")}]`;
}

function metaPairs(meta: Meta | undefined): Pair[] {
  const pairs: Pair[] = [];
  if (!meta) return pairs;
  const { provenance } = meta;
  if (provenance) {
    pairs.push(["source", quote(provenance.source)]);
    if (provenance.confidence !== undefined) pairs.push(["confidence", provenance.confidence]);
    if (provenance.tool !== undefined) pairs.push(["tool", quote(provenance.tool)]);
  }
  if (meta.coverage !== undefined) pairs.push(["coverage", numberText(meta.coverage)]);
  if (meta.freshness !== undefined) pairs.push(["freshness", quote(meta.freshness)]);
  for (const [name, value] of Object.entries(meta.data ?? {})) {
    const key = `data.${name}`;
    pairs.push([
      IDENT.test(key) ? key : backticked(key),
      typeof value === "string"
        ? quote(value)
        : typeof value === "number"
          ? numberText(value)
          : String(value),
    ]);
  }
  return pairs;
}

function fieldPairs(item: Fields, withId: boolean): Pair[] {
  const pairs: Pair[] = [];
  if (withId && item.id !== undefined) pairs.push(["id", quote(item.id)]);
  if (item.type !== undefined) pairs.push(["type", quote(item.type)]);
  if (item.weight !== undefined) pairs.push(["weight", numberText(item.weight)]);
  if (item.shape !== undefined) pairs.push(["shape", item.shape]);
  if (item.pseudo !== undefined) pairs.push(["pseudo", item.pseudo]);
  if (item.actions !== undefined) {
    pairs.push(["actions", `[${item.actions.map(quote).join(", ")}]`]);
  }
  if (item.guard !== undefined) pairs.push(["guard", quote(item.guard)]);
  if (item.action !== undefined) pairs.push(["action", quote(item.action)]);
  if (item.link !== undefined) pairs.push(["link", quote(item.link)]);
  if (item.description !== undefined) pairs.push(["description", quote(item.description)]);
  if (item.position !== undefined) {
    pairs.push(["x", numberText(item.position.x)], ["y", numberText(item.position.y)]);
  }
  pairs.push(...metaPairs(item.meta));
  return pairs;
}

function declaration(
  id: string,
  item: Fields,
  depth: number,
  reserved?: ReadonlySet<string>,
  suffix = "",
): string {
  return `${pad(depth)}${ident(id, reserved)}${labelText(item.label)}${attrText(fieldPairs(item, false))}${suffix}`;
}

function assemble(header: string, sections: readonly (readonly string[])[]): string {
  const lines = [header];
  for (const section of sections) {
    if (section.length > 0) lines.push("", ...section);
  }
  return `${lines.join("\n")}\n`;
}

function headerLine(doc: Document): string {
  const pairs: Pair[] = [];
  if ("direction" in doc && doc.direction !== undefined) {
    pairs.push(["direction", doc.direction]);
  }
  if ((doc.kind === "tree" || doc.kind === "graph") && doc.layout !== undefined) {
    pairs.push(["layout", doc.layout]);
  }
  pairs.push(...metaPairs(doc.meta));
  return `${doc.kind}${labelText(doc.title)}${attrText(pairs)}`;
}

function connection(
  from: string,
  operator: string,
  to: string,
  item: Fields,
  middle?: [string, string],
): string {
  const left = middle?.[0] ? ` ${middle[0]}` : "";
  const right = middle?.[1] ? ` ${middle[1]}` : "";
  return `${ident(from)}${left} ${operator}${right} ${ident(to)}${labelText(item.label)}${attrText(fieldPairs(item, true))}`;
}

function printGraph(doc: Extract<Document, { kind: "graph" }>, style: Style): string[][] {
  const byGroup = groupNodes(doc.nodes);
  const declarations: string[] = [];
  const nodeLines = (group: string | undefined, depth: number): void => {
    for (const node of byGroup.get(group) ?? []) {
      declarations.push(declaration(node.id, node, depth, GRAPH_RESERVED));
    }
  };
  nodeLines(undefined, 0);
  walk(
    doc.groups ?? [],
    (group, depth) => {
      declarations.push(
        `${pad(depth)}group ${ident(group.id, GRAPH_RESERVED)}${labelText(group.label)}${attrText(metaPairs(group.meta))} ${style.open}`,
      );
      nodeLines(group.id, depth + 1);
    },
    (_group, depth) => {
      declarations.push(`${pad(depth)}${style.close}`);
    },
  );
  const edges = (doc.edges ?? []).map((edge) =>
    connection(edge.from, style.ops[edge.directed === false ? "--" : "->"], edge.to, edge),
  );
  return [declarations, edges];
}

function printSequence(
  doc: Extract<Document, { kind: "sequence" }>,
  style: Style,
): string[][] {
  const operators = { sync: "->", async: "->>", reply: "-->" } as const;
  return [
    doc.participants.map((participant) => declaration(participant.id, participant, 0)),
    doc.messages.map((message) =>
      connection(message.from, style.ops[operators[message.style ?? "sync"]], message.to, message),
    ),
  ];
}

function printState(doc: Extract<Document, { kind: "state" }>, style: Style): string[][] {
  const states: string[] = [];
  walk(
    doc.states,
    (state, depth, children) => {
      states.push(declaration(state.id, state, depth, undefined, children > 0 ? ` ${style.open}` : ""));
    },
    (_state, depth, children) => {
      if (children > 0) states.push(`${pad(depth)}${style.close}`);
    },
  );
  const transitions = (doc.transitions ?? []).map((transition) =>
    connection(transition.from, style.ops["->"], transition.to, {
      ...transition,
      label: transition.event,
    }),
  );
  return [states, transitions];
}

function typeText(type: string): string {
  const first = /^[^(\[]*/.exec(type)![0];
  return TYPE.test(type) && !FLAGS.has(first) ? type : quote(type);
}

function entityLines(entity: Entity, style: Style): string[] {
  const attributes = entity.attributes;
  const lines = [
    declaration(entity.id, entity, 0, undefined, attributes === undefined ? "" : ` ${style.open}`),
  ];
  if (attributes === undefined) return lines;
  for (const attribute of attributes) {
    const parts = [ident(attribute.name, ATTRIBUTE_RESERVED)];
    if (attribute.type !== undefined) parts.push(typeText(attribute.type));
    parts.push(...(attribute.keys ?? []));
    if (attribute.nullable === true) parts.push("null");
    const note: Pair[] = attribute.note === undefined ? [] : [["note", quote(attribute.note)]];
    lines.push(`${pad(1)}${parts.join(" ")}${attrText(note)}`);
  }
  lines.push(style.close);
  return lines;
}

function printEr(doc: Extract<Document, { kind: "er" }>, style: Style): string[][] {
  const relations = (doc.relations ?? []).map((relation) =>
    connection(
      relation.from,
      style.ops[relation.identifying === false ? ".." : "--"],
      relation.to,
      relation,
      [
        relation.fromCardinality ? CARDINALITY_TEXT[relation.fromCardinality] : "",
        relation.toCardinality ? CARDINALITY_TEXT[relation.toCardinality] : "",
      ],
    ),
  );
  return [doc.entities.flatMap((entity) => entityLines(entity, style)), relations];
}

function bareLabel(label: string): boolean {
  return label !== "" && label === label.trim() && !/["#\[\n\r]/.test(label);
}

function explicitIds(nodes: readonly { id: string; label: string }[]): Set<number> {
  let explicit = new Set<number>();
  for (;;) {
    const used = new Set([...explicit].map((index) => nodes[index]!.id));
    const next = new Set(explicit);
    nodes.forEach((node, index) => {
      if (explicit.has(index)) return;
      const base = slug(node.label);
      let candidate = base;
      for (let suffix = 2; used.has(candidate); suffix++) candidate = `${base}-${suffix}`;
      used.add(candidate);
      if (candidate !== node.id) next.add(index);
    });
    if (next.size === explicit.size) return explicit;
    explicit = next;
  }
}

function printTree(doc: Extract<Document, { kind: "tree" }>): string[][] {
  const nodes = preorder(doc.nodes);
  const explicit = explicitIds(nodes);
  const index = new Map(nodes.map((node, position) => [node, position]));
  const lines: string[] = [];
  walk(doc.nodes, (node, depth) => {
    const item = { ...node, id: explicit.has(index.get(node)!) ? node.id : undefined };
    const text = bareLabel(node.label) ? node.label : quote(node.label);
    lines.push(`${pad(depth)}${text}${attrText(fieldPairs(item, true))}`);
  });
  return [lines];
}

export function print(doc: Document, options: PrintOptions = {}): string {
  const style = STYLES[options.style ?? "symbols"];
  const header = headerLine(doc);
  switch (doc.kind) {
    case "graph":
      return assemble(header, printGraph(doc, style));
    case "sequence":
      return assemble(header, printSequence(doc, style));
    case "state":
      return assemble(header, printState(doc, style));
    case "er":
      return assemble(header, printEr(doc, style));
    case "tree":
      return assemble(header, printTree(doc));
  }
}
