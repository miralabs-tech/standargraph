import { LineMap, STOP, Sink, type Range as Span } from "../text/errors";
import { Lexer, type Token } from "../text/lexer";
import type { Ast, AttrNode, ErStmt, GraphStmt, Ident, SequenceStmt, StateStmt, Str } from "../text/parser";
import { parseTree } from "../text/syntax";
import type { AttrContext } from "./docs";
import { converter, type Converter } from "./positions";

export type ItemKind = "node" | "group" | "participant" | "state" | "entity";

export type Item = {
  kind: ItemKind;
  id: string;
  label?: string;
  attrs: AttrNode[];
  declared: boolean;
  definition: Span;
  incoming: number;
  outgoing: number;
};

export type Occurrence = { range: Span; item: Item };
export type AttrSite = { context: AttrContext; attrs: AttrNode[] };
export type Block = { open: number; end: number; close?: number };

export type Analysis = {
  ast: Ast;
  conv: Converter;
  items: Item[];
  occurrences: Occurrence[];
  sites: AttrSite[];
  block(from: number): Block | undefined;
};

type Mention = { range: Span; label?: Str; attrs: AttrNode[] };

function isPunct(token: Token | undefined, text: string): boolean {
  return token !== undefined && token.kind === "PUNCT" && token.text === text;
}

function opensBlock(line: Token[], alone: boolean): boolean {
  const last = line[line.length - 1];
  if (last === undefined) return false;
  if (isPunct(last, "{")) return true;
  return last.kind === "IDENT" && last.text === "do" && (alone || line.length > 1);
}

function scanBlock(text: string, lines: LineMap, from: number): Block | undefined {
  const lexer = new Lexer(text, new Sink(lines));
  lexer.seek(from);
  let depth = 0;
  let open = from;
  let end = from;
  let first = true;
  let line: Token[] = [];
  try {
    for (;;) {
      const token = lexer.next();
      if (token.kind !== "NEWLINE" && token.kind !== "EOF") {
        line.push(token);
        end = token.end;
        continue;
      }
      if (first) {
        first = false;
        if (!opensBlock(line, true)) return undefined;
        depth = 1;
        open = line[line.length - 1]!.start;
      } else if (line.length > 0) {
        const head = line[0]!;
        const closes = isPunct(head, "}") || (line.length === 1 && head.kind === "IDENT" && head.text === "end");
        if (closes) {
          depth--;
          if (depth === 0) return { open, end: head.end, close: head.start };
        } else if (opensBlock(line, false)) {
          depth++;
        }
      }
      line = [];
      if (token.kind === "EOF") return { open, end };
    }
  } catch (error) {
    if (error !== STOP) throw error;
    return first ? undefined : { open, end };
  }
}

function build(source: string): Analysis {
  const { ast, text } = parseTree(source);
  const conv = converter(source);
  const lines = new LineMap(text);
  const registry = new Map<string, Item>();
  const occurrences: Occurrence[] = [];
  const sites: AttrSite[] = [];

  const touch = (kind: ItemKind, ident: Ident, mention?: Mention): Item => {
    const key = `${kind}:${ident.value}`;
    let item = registry.get(key);
    if (!item) {
      item = {
        kind,
        id: ident.value,
        attrs: [],
        declared: false,
        definition: ident.range,
        incoming: 0,
        outgoing: 0,
      };
      registry.set(key, item);
    }
    occurrences.push({ range: ident.range, item });
    if (mention && !item.declared) {
      item.declared = true;
      item.definition = ident.range;
      item.label = mention.label?.value;
      item.attrs = mention.attrs;
    }
    return item;
  };

  const connect = (from: Item | undefined, to: Item | undefined): void => {
    if (from) from.outgoing++;
    if (to) to.incoming++;
  };

  const graph = (statements: GraphStmt[]): void => {
    for (const statement of statements) {
      if (statement.t === "group") {
        touch("group", statement.id, statement);
        sites.push({ context: "group", attrs: statement.attrs });
        graph(statement.body);
      } else if (statement.t === "node") {
        touch("node", statement.id, statement);
        sites.push({ context: "node", attrs: statement.attrs });
      } else {
        const items = statement.ids.map((id) => touch("node", id));
        for (let index = 0; index < statement.ops.length; index++) connect(items[index], items[index + 1]);
        sites.push({ context: "edge", attrs: statement.attrs });
      }
    }
  };

  const sequence = (statements: SequenceStmt[]): void => {
    for (const statement of statements) {
      if (statement.t === "participant") {
        touch("participant", statement.id, statement);
        sites.push({ context: "participant", attrs: statement.attrs });
      } else {
        connect(touch("participant", statement.from), touch("participant", statement.to));
        sites.push({ context: "message", attrs: statement.attrs });
      }
    }
  };

  const state = (statements: StateStmt[]): void => {
    for (const statement of statements) {
      if (statement.t === "state") {
        touch("state", statement.id, statement);
        sites.push({ context: "state", attrs: statement.attrs });
        if (statement.body) state(statement.body);
      } else {
        const from = statement.from.star ? undefined : touch("state", statement.from);
        const to = statement.to.star ? undefined : touch("state", statement.to);
        connect(from, to);
        sites.push({ context: "transition", attrs: statement.attrs });
      }
    }
  };

  const er = (statements: ErStmt[]): void => {
    for (const statement of statements) {
      if (statement.t === "entity") {
        touch("entity", statement.id, statement);
        sites.push({ context: "entity", attrs: statement.attrs });
        for (const line of statement.attributes ?? []) sites.push({ context: "attribute", attrs: line.attrs });
      } else {
        connect(touch("entity", statement.from), touch("entity", statement.to));
        sites.push({ context: "relation", attrs: statement.attrs });
      }
    }
  };

  sites.push({ context: "header", attrs: ast.header.attrs });
  switch (ast.kind) {
    case "graph":
      graph(ast.body);
      break;
    case "sequence":
      sequence(ast.body);
      break;
    case "state":
      state(ast.body);
      break;
    case "er":
      er(ast.body);
      break;
    case "tree":
      for (const line of ast.body) sites.push({ context: "treeNode", attrs: line.attrs });
      break;
  }

  const seen = new Set<number>();
  const unique = occurrences.filter((occurrence) => {
    if (seen.has(occurrence.range.start)) return false;
    seen.add(occurrence.range.start);
    return true;
  });
  unique.sort((a, b) => a.range.start - b.range.start);
  const placed = new Set<Item>();
  for (const occurrence of unique) {
    const { item } = occurrence;
    if (placed.has(item)) continue;
    placed.add(item);
    if (!item.declared) item.definition = occurrence.range;
  }

  return {
    ast,
    conv,
    items: [...registry.values()],
    occurrences: unique,
    sites,
    block: (from) => scanBlock(text, lines, from),
  };
}

let last: { source: string; value: Analysis } | undefined;

export function analyze(source: string): Analysis {
  if (last !== undefined && last.source === source) return last.value;
  const value = build(source);
  last = { source, value };
  return value;
}

export function occurrenceAt(analysis: Analysis, offset: number): Occurrence | undefined {
  let touching: Occurrence | undefined;
  for (const occurrence of analysis.occurrences) {
    if (offset >= occurrence.range.start && offset < occurrence.range.end) return occurrence;
    if (offset === occurrence.range.end) touching ??= occurrence;
  }
  return touching;
}
