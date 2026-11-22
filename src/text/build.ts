import { DirectionSchema, GRAPH_LAYOUTS, PSEUDO, SHAPES, TREE_LAYOUTS } from "../format/schema";
import type { Range, Sink } from "./errors";
import type {
  Ast,
  AttrNode,
  Endpoint,
  Ident,
  Kind,
  Str,
  Value,
} from "./parser";
import { slug } from "./slug";

type Json = Record<string, unknown>;
export type Marks = Map<string, Range>;
type Ctx = { sink: Sink; marks: Marks };
type Field = "string" | "number" | "strings" | readonly string[];
type Spec = {
  noun: string;
  fields: Readonly<Record<string, Field>>;
  meta: boolean;
  position?: boolean;
};

const DIRECTIONS: readonly string[] = DirectionSchema.anyOf.map((literal) => literal.const);
const CONFIDENCES = ["confirmed", "inferred", "unknown"] as const;
const META_FIELDS: Readonly<Record<string, Field>> = {
  source: "string",
  confidence: CONFIDENCES,
  tool: "string",
  coverage: "number",
  freshness: "string",
};
const PROVENANCE_KEYS = new Set(["source", "confidence", "tool"]);
const META_NAMES = [...Object.keys(META_FIELDS), "data.*"];

const NODE: Spec = {
  noun: "a node",
  fields: { type: "string", shape: SHAPES, link: "string", description: "string", x: "number", y: "number" },
  meta: true,
  position: true,
};
const GROUP: Spec = { noun: "a group", fields: {}, meta: true };
const EDGE: Spec = {
  noun: "an edge",
  fields: { id: "string", type: "string", weight: "number", description: "string", link: "string" },
  meta: true,
};
const PARTICIPANT: Spec = { noun: "a participant", fields: { type: "string" }, meta: true };
const MESSAGE: Spec = { noun: "a message", fields: {}, meta: true };
const STATE: Spec = {
  noun: "a state",
  fields: { type: "string", pseudo: PSEUDO, actions: "strings", description: "string", link: "string" },
  meta: true,
};
const TRANSITION: Spec = {
  noun: "a transition",
  fields: { id: "string", guard: "string", action: "string", type: "string" },
  meta: true,
};
const ENTITY: Spec = {
  noun: "an entity",
  fields: { type: "string", description: "string", link: "string" },
  meta: true,
};
const ATTRIBUTE: Spec = { noun: "an attribute", fields: { note: "string" }, meta: false };
const RELATION: Spec = { noun: "a relation", fields: { id: "string", type: "string" }, meta: true };
const TREE_NODE: Spec = {
  noun: "a tree node",
  fields: { id: "string", type: "string", shape: SHAPES, description: "string", link: "string" },
  meta: true,
};
const HEADERS: Readonly<Record<Kind, Spec>> = {
  graph: { noun: "the header", fields: { direction: DIRECTIONS, layout: GRAPH_LAYOUTS }, meta: true },
  sequence: { noun: "the header", fields: {}, meta: true },
  state: { noun: "the header", fields: { direction: DIRECTIONS }, meta: true },
  er: { noun: "the header", fields: { direction: DIRECTIONS }, meta: true },
  tree: { noun: "the header", fields: { direction: DIRECTIONS, layout: TREE_LAYOUTS }, meta: true },
};

function mark(ctx: Ctx, pointer: string, range: Range): void {
  ctx.marks.set(pointer, range);
}

function describe(value: Value): string {
  if (value.type === "list") return "a list";
  if (value.type === "number") return String(value.value);
  return JSON.stringify(value.value);
}

function isStringLike(value: Value): value is Value & { type: "string" | "ident" } {
  return value.type === "string" || value.type === "ident";
}

function coerce(ctx: Ctx, attr: AttrNode, field: Field): unknown {
  const value = attr.value;
  let expects: string;
  if (field === "number") {
    if (value.type === "number") return value.value;
    expects = "a number";
  } else if (field === "strings") {
    if (value.type === "list" && value.items.every(isStringLike)) {
      return value.items.map((item) => item.value);
    }
    expects = "a list of strings";
  } else if (field === "string") {
    if (isStringLike(value)) return value.value;
    expects = "a string";
  } else {
    if (isStringLike(value) && field.includes(value.value)) return value.value;
    expects = `one of ${field.join(", ")}`;
  }
  ctx.sink.report(
    "E_VALUE",
    value.range,
    `Attribute "${attr.key}" expects ${expects}; found ${describe(value)}`,
  );
  return undefined;
}

function coerceData(ctx: Ctx, attr: AttrNode): unknown {
  const value = attr.value;
  if (value.type === "string" || value.type === "number") return value.value;
  if (value.type === "ident" && (value.value === "true" || value.value === "false")) {
    return value.value === "true";
  }
  ctx.sink.report(
    "E_VALUE",
    value.range,
    `Attribute "${attr.key}" expects a string, a number or a boolean; found ${describe(value)}`,
  );
  return undefined;
}

function applyMeta(ctx: Ctx, attr: AttrNode, target: Json, pointer: string): boolean {
  const { key } = attr;
  const isData = key.startsWith("data.") && key.length > 5;
  if (!isData && !Object.hasOwn(META_FIELDS, key)) return false;
  const value = isData ? coerceData(ctx, attr) : coerce(ctx, attr, META_FIELDS[key]!);
  if (value === undefined) return true;
  const meta = (target.meta ??= {}) as Json;
  const base = `${pointer}/meta`;
  mark(ctx, base, attr.range);
  if (isData) {
    const name = key.slice(5);
    ((meta.data ??= {}) as Json)[name] = value;
    mark(ctx, `${base}/data`, attr.range);
    mark(ctx, `${base}/data/${name}`, attr.value.range);
  } else if (PROVENANCE_KEYS.has(key)) {
    ((meta.provenance ??= {}) as Json)[key] = value;
    mark(ctx, `${base}/provenance`, attr.range);
    mark(ctx, `${base}/provenance/${key}`, attr.value.range);
  } else {
    meta[key] = value;
    mark(ctx, `${base}/${key}`, attr.value.range);
  }
  return true;
}

function applyAttrs(
  ctx: Ctx,
  attrs: readonly AttrNode[],
  spec: Spec,
  target: Json,
  pointer: string,
): void {
  const seen = new Set<string>();
  const coordinates = new Map<string, { value: number; attr: AttrNode }>();
  let needsSource: AttrNode | undefined;
  for (const attr of attrs) {
    const { key } = attr;
    if (seen.has(key)) {
      ctx.sink.report("E_ATTR", attr.keyRange, `Attribute "${key}" is set twice`);
      continue;
    }
    seen.add(key);
    if (Object.hasOwn(spec.fields, key)) {
      const value = coerce(ctx, attr, spec.fields[key]!);
      if (value === undefined) continue;
      if (spec.position && (key === "x" || key === "y")) {
        coordinates.set(key, { value: value as number, attr });
      } else {
        target[key] = value;
        mark(ctx, `${pointer}/${key}`, attr.value.range);
      }
      continue;
    }
    if (spec.meta && applyMeta(ctx, attr, target, pointer)) {
      if (key === "confidence" || key === "tool") needsSource ??= attr;
      continue;
    }
    const expected = [...Object.keys(spec.fields), ...(spec.meta ? META_NAMES : [])];
    ctx.sink.report(
      "E_ATTR",
      attr.keyRange,
      `Unknown attribute "${key}" for ${spec.noun} (expected: ${expected.join(", ")})`,
    );
  }
  if (spec.position && coordinates.size > 0) {
    const x = coordinates.get("x");
    const y = coordinates.get("y");
    if (x && y) {
      target.position = { x: x.value, y: y.value };
      mark(ctx, `${pointer}/position`, { start: x.attr.range.start, end: y.attr.range.end });
      mark(ctx, `${pointer}/position/x`, x.attr.value.range);
      mark(ctx, `${pointer}/position/y`, y.attr.value.range);
    } else {
      ctx.sink.report("E_ATTR", (x ?? y)!.attr.keyRange, "x and y go together");
    }
  }
  if (needsSource) {
    const meta = target.meta as Json | undefined;
    const provenance = meta?.provenance as Json | undefined;
    if (provenance?.source === undefined) {
      ctx.sink.report("E_ATTR", needsSource.keyRange, "confidence and tool need a source");
    }
  }
}

function setLabel(ctx: Ctx, item: Json, pointer: string, label: Str | undefined): void {
  if (!label) return;
  item.label = label.value;
  mark(ctx, `${pointer}/label`, label.range);
}

type Entry = { index: number; block: string | undefined; line: number; declared: boolean };

class Registry {
  readonly items: Json[] = [];
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly ctx: Ctx,
    private readonly collection: string,
    private readonly noun: string,
    private readonly blockField?: string,
  ) {}

  pointer(entry: Entry): string {
    return `/${this.collection}/${entry.index}`;
  }

  item(entry: Entry): Json {
    return this.items[entry.index]!;
  }

  mention(id: Ident, block: string | undefined): Entry {
    let entry = this.entries.get(id.value);
    if (!entry) {
      const item: Json = { id: id.value };
      if (this.blockField && block !== undefined) item[this.blockField] = block;
      entry = {
        index: this.items.length,
        block,
        line: this.ctx.sink.lineOf(id.range.start),
        declared: false,
      };
      this.items.push(item);
      this.entries.set(id.value, entry);
      mark(this.ctx, this.pointer(entry), id.range);
      mark(this.ctx, `${this.pointer(entry)}/id`, id.range);
    }
    return entry;
  }

  declare(id: Ident, block: string | undefined, range: Range): Entry | undefined {
    const existing = this.entries.get(id.value);
    if (existing?.declared) {
      this.ctx.sink.report(
        "E_DUPLICATE",
        id.range,
        `${this.noun} "${id.value}" is already declared at line ${existing.line}`,
      );
      return undefined;
    }
    if (existing && existing.block !== block) {
      this.ctx.sink.report(
        "E_REGION",
        id.range,
        `${this.noun} "${id.value}" was first used in "${existing.block ?? "root"}" at line ${existing.line} and cannot be declared in another block`,
      );
      return undefined;
    }
    const entry = this.mention(id, block);
    entry.declared = true;
    entry.line = this.ctx.sink.lineOf(id.range.start);
    mark(this.ctx, this.pointer(entry), range);
    return entry;
  }
}

function buildGraph(ast: Extract<Ast, { kind: "graph" }>, ctx: Ctx): Json {
  const nodes = new Registry(ctx, "nodes", "Node", "group");
  const groups = new Registry(ctx, "groups", "Group", "parent");
  const edges: Json[] = [];
  const walk = (statements: typeof ast.body, block: string | undefined): void => {
    for (const statement of statements) {
      if (statement.t === "group") {
        const entry = groups.declare(statement.id, block, statement.range);
        if (entry) {
          const item = groups.item(entry);
          setLabel(ctx, item, groups.pointer(entry), statement.label);
          applyAttrs(ctx, statement.attrs, GROUP, item, groups.pointer(entry));
        }
        walk(statement.body, statement.id.value);
      } else if (statement.t === "node") {
        const entry = nodes.declare(statement.id, block, statement.range);
        if (entry) {
          const item = nodes.item(entry);
          setLabel(ctx, item, nodes.pointer(entry), statement.label);
          applyAttrs(ctx, statement.attrs, NODE, item, nodes.pointer(entry));
        }
      } else {
        for (const id of statement.ids) nodes.mention(id, block);
        const several = statement.ops.length > 1;
        const attrs = several
          ? statement.attrs.filter((attr) => {
              if (attr.key !== "id") return true;
              ctx.sink.report(
                "E_ATTR",
                attr.keyRange,
                "id cannot be set on a chain of several edges",
              );
              return false;
            })
          : statement.attrs;
        statement.ops.forEach((op, position) => {
          const edge: Json = {
            from: statement.ids[position]!.value,
            to: statement.ids[position + 1]!.value,
          };
          const pointer = `/edges/${edges.length}`;
          edges.push(edge);
          mark(ctx, pointer, statement.range);
          mark(ctx, `${pointer}/from`, statement.ids[position]!.range);
          mark(ctx, `${pointer}/to`, statement.ids[position + 1]!.range);
          mark(ctx, `${pointer}/directed`, op.range);
          setLabel(ctx, edge, pointer, statement.label);
          edge.directed = op.symbol === "->";
          if (position > 0) ctx.sink.muted++;
          applyAttrs(ctx, attrs, EDGE, edge, pointer);
          if (position > 0) ctx.sink.muted--;
        });
      }
    }
  };
  walk(ast.body, undefined);
  const result: Json = { nodes: nodes.items };
  if (edges.length > 0) result.edges = edges;
  if (groups.items.length > 0) result.groups = groups.items;
  return result;
}

function buildSequence(ast: Extract<Ast, { kind: "sequence" }>, ctx: Ctx): Json {
  const participants = new Registry(ctx, "participants", "Participant");
  const messages: Json[] = [];
  for (const statement of ast.body) {
    if (statement.t === "participant") {
      const entry = participants.declare(statement.id, undefined, statement.range);
      if (entry) {
        const item = participants.item(entry);
        setLabel(ctx, item, participants.pointer(entry), statement.label);
        applyAttrs(ctx, statement.attrs, PARTICIPANT, item, participants.pointer(entry));
      }
    } else {
      participants.mention(statement.from, undefined);
      participants.mention(statement.to, undefined);
      const pointer = `/messages/${messages.length}`;
      const message: Json = { from: statement.from.value, to: statement.to.value };
      messages.push(message);
      mark(ctx, pointer, statement.range);
      mark(ctx, `${pointer}/from`, statement.from.range);
      mark(ctx, `${pointer}/to`, statement.to.range);
      mark(ctx, `${pointer}/style`, statement.op.range);
      setLabel(ctx, message, pointer, statement.label);
      message.style =
        statement.op.symbol === "->" ? "sync" : statement.op.symbol === "->>" ? "async" : "reply";
      applyAttrs(ctx, statement.attrs, MESSAGE, message, pointer);
    }
  }
  return { participants: participants.items, messages };
}

function buildState(ast: Extract<Ast, { kind: "state" }>, ctx: Ctx): Json {
  const states = new Registry(ctx, "states", "State", "parent");
  const transitions: Json[] = [];

  const endpoint = (
    target: Endpoint,
    pseudo: "initial" | "final",
    block: string | undefined,
  ): string => {
    if (!target.star) {
      states.mention(target, block);
      return target.value;
    }
    const id = `${block ?? ""}__${pseudo}`;
    const before = states.items.length;
    const entry = states.mention({ value: id, range: target.range }, block);
    const item = states.item(entry);
    if (states.items.length > before) {
      item.pseudo = pseudo;
      mark(ctx, `${states.pointer(entry)}/pseudo`, target.range);
    } else if (item.pseudo !== pseudo) {
      ctx.sink.report(
        "E_VALUE",
        target.range,
        `State "${id}" already exists and is not an ${pseudo} pseudo-state, so "*" cannot stand for it`,
      );
    }
    return id;
  };

  const walk = (statements: typeof ast.body, block: string | undefined): void => {
    for (const statement of statements) {
      if (statement.t === "state") {
        const entry = states.declare(statement.id, block, statement.range);
        if (entry) {
          const item = states.item(entry);
          const pointer = states.pointer(entry);
          const previous = item.pseudo;
          setLabel(ctx, item, pointer, statement.label);
          applyAttrs(ctx, statement.attrs, STATE, item, pointer);
          if (previous !== undefined && item.pseudo !== previous) {
            ctx.sink.report(
              "E_VALUE",
              ctx.marks.get(`${pointer}/pseudo`) ?? statement.id.range,
              `State "${statement.id.value}" is already the ${String(previous)} pseudo-state used by "*"`,
            );
          }
        }
        if (statement.body) walk(statement.body, statement.id.value);
      } else {
        const from = endpoint(statement.from, "initial", block);
        const to = endpoint(statement.to, "final", block);
        const pointer = `/transitions/${transitions.length}`;
        const transition: Json = { from, to };
        transitions.push(transition);
        mark(ctx, pointer, statement.range);
        mark(ctx, `${pointer}/from`, statement.from.range);
        mark(ctx, `${pointer}/to`, statement.to.range);
        if (statement.label) {
          transition.event = statement.label.value;
          mark(ctx, `${pointer}/event`, statement.label.range);
        }
        applyAttrs(ctx, statement.attrs, TRANSITION, transition, pointer);
      }
    }
  };
  walk(ast.body, undefined);
  const result: Json = { states: states.items };
  if (transitions.length > 0) result.transitions = transitions;
  return result;
}

function buildEr(ast: Extract<Ast, { kind: "er" }>, ctx: Ctx): Json {
  const entities = new Registry(ctx, "entities", "Entity");
  const relations: Json[] = [];
  for (const statement of ast.body) {
    if (statement.t === "entity") {
      const entry = entities.declare(statement.id, undefined, statement.range);
      if (!entry) continue;
      const item = entities.item(entry);
      const pointer = entities.pointer(entry);
      setLabel(ctx, item, pointer, statement.label);
      applyAttrs(ctx, statement.attrs, ENTITY, item, pointer);
      if (statement.attributes) {
        item.attributes = statement.attributes.map((line, index) => {
          const attribute: Json = { name: line.name.value };
          const at = `${pointer}/attributes/${index}`;
          mark(ctx, at, line.range);
          mark(ctx, `${at}/name`, line.name.range);
          if (line.type) {
            attribute.type = line.type.value;
            mark(ctx, `${at}/type`, line.type.range);
          }
          const keys: string[] = [];
          for (const flag of line.flags) {
            if (flag.value === "null") {
              attribute.nullable = true;
              mark(ctx, `${at}/nullable`, flag.range);
            } else {
              mark(ctx, `${at}/keys/${keys.length}`, flag.range);
              keys.push(flag.value);
            }
          }
          if (keys.length > 0) {
            attribute.keys = keys;
            mark(ctx, `${at}/keys`, line.flags.find((flag) => flag.value !== "null")!.range);
          }
          applyAttrs(ctx, line.attrs, ATTRIBUTE, attribute, at);
          return attribute;
        });
      }
    } else {
      entities.mention(statement.from, undefined);
      entities.mention(statement.to, undefined);
      const pointer = `/relations/${relations.length}`;
      const relation: Json = { from: statement.from.value, to: statement.to.value };
      relations.push(relation);
      mark(ctx, pointer, statement.range);
      mark(ctx, `${pointer}/from`, statement.from.range);
      mark(ctx, `${pointer}/to`, statement.to.range);
      mark(ctx, `${pointer}/identifying`, statement.op.range);
      if (statement.fromCard) {
        relation.fromCardinality = statement.fromCard.value;
        mark(ctx, `${pointer}/fromCardinality`, statement.fromCard.range);
      }
      if (statement.toCard) {
        relation.toCardinality = statement.toCard.value;
        mark(ctx, `${pointer}/toCardinality`, statement.toCard.range);
      }
      setLabel(ctx, relation, pointer, statement.label);
      relation.identifying = statement.op.symbol === "--";
      applyAttrs(ctx, statement.attrs, RELATION, relation, pointer);
    }
  }
  const result: Json = { entities: entities.items };
  if (relations.length > 0) result.relations = relations;
  return result;
}

function buildTree(ast: Extract<Ast, { kind: "tree" }>, ctx: Ctx): Json {
  const nodes: Json[] = ast.body.map(() => ({}));
  const explicit = new Map<string, number>();
  ast.body.forEach((line, index) => {
    const node = nodes[index]!;
    const pointer = `/nodes/${index}`;
    mark(ctx, pointer, line.range);
    applyAttrs(ctx, line.attrs, TREE_NODE, node, pointer);
    node.label = line.label.value;
    mark(ctx, `${pointer}/label`, line.label.range);
    if (typeof node.id !== "string") return;
    const first = explicit.get(node.id);
    if (first === undefined) {
      explicit.set(node.id, index);
    } else {
      ctx.sink.report(
        "E_DUPLICATE",
        ctx.marks.get(`${pointer}/id`) ?? line.label.range,
        `Node "${node.id}" is already declared at line ${ctx.sink.lineOf(ast.body[first]!.range.start)}`,
      );
    }
  });
  const used = new Set(explicit.keys());
  ast.body.forEach((line, index) => {
    const node = nodes[index]!;
    const pointer = `/nodes/${index}`;
    if (node.id === undefined) {
      const base = slug(line.label.value);
      let candidate = base;
      for (let suffix = 2; used.has(candidate); suffix++) candidate = `${base}-${suffix}`;
      used.add(candidate);
      node.id = candidate;
      mark(ctx, `${pointer}/id`, line.label.range);
    }
    if (line.parent >= 0) {
      node.parent = nodes[line.parent]!.id;
      mark(ctx, `${pointer}/parent`, line.label.range);
    }
  });
  return { nodes };
}

export function build(ast: Ast, ctx: Ctx): Json {
  const result: Json = { version: 1, kind: ast.kind };
  const { header } = ast;
  mark(ctx, "", header.range);
  mark(ctx, "/kind", header.kindRange);
  if (header.title) {
    result.title = header.title.value;
    mark(ctx, "/title", header.title.range);
  }
  const attrs = header.attrs.filter((attr) => {
    if (attr.key !== "version") return true;
    ctx.sink.report("E_ATTR", attr.keyRange, "version is implied (1) in the text syntax");
    return false;
  });
  applyAttrs(ctx, attrs, HEADERS[ast.kind], result, "");
  switch (ast.kind) {
    case "graph":
      return Object.assign(result, buildGraph(ast, ctx));
    case "sequence":
      return Object.assign(result, buildSequence(ast, ctx));
    case "state":
      return Object.assign(result, buildState(ast, ctx));
    case "er":
      return Object.assign(result, buildEr(ast, ctx));
    case "tree":
      return Object.assign(result, buildTree(ast, ctx));
  }
}
