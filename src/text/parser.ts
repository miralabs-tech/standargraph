import type { Cardinality } from "../format/schema";
import { STOP, type Range, type Sink } from "./errors";
import { Lexer, type Token } from "./lexer";

export type Kind = "graph" | "sequence" | "state" | "er" | "tree";
export type OpSymbol = "->" | "--" | "->>" | "-->" | "..";

export type Str = { value: string; range: Range };
export type Ident = { value: string; range: Range };
export type Value =
  | { type: "string"; value: string; range: Range }
  | { type: "number"; value: number; range: Range }
  | { type: "ident"; value: string; range: Range }
  | { type: "list"; items: Value[]; range: Range };
export type AttrNode = { key: string; keyRange: Range; value: Value; range: Range };
export type Op = { symbol: OpSymbol; range: Range };
export type Endpoint = { star: boolean; value: string; range: Range };
export type Card = { value: Cardinality; range: Range };
export type Opener = { text: "{" | "do"; range: Range };

type Common = { label?: Str; attrs: AttrNode[]; range: Range };

export type GraphStmt =
  | ({ t: "group"; id: Ident; body: GraphStmt[] } & Common)
  | ({ t: "node"; id: Ident } & Common)
  | ({ t: "chain"; ids: Ident[]; ops: Op[] } & Common);
export type SequenceStmt =
  | ({ t: "participant"; id: Ident } & Common)
  | ({ t: "message"; from: Ident; to: Ident; op: Op } & Common);
export type StateStmt =
  | ({ t: "state"; id: Ident; body?: StateStmt[] } & Common)
  | ({ t: "transition"; from: Endpoint; to: Endpoint; op: Op } & Common);
export type AttributeLine = {
  name: Ident;
  type?: Str;
  flags: { value: string; range: Range }[];
  attrs: AttrNode[];
  range: Range;
};
export type ErStmt =
  | ({ t: "entity"; id: Ident; attributes?: AttributeLine[] } & Common)
  | ({
      t: "relation";
      from: Ident;
      fromCard?: Card;
      op: Op;
      toCard?: Card;
      to: Ident;
    } & Common);
export type TreeLine = {
  label: Str;
  attrs: AttrNode[];
  parent: number;
  range: Range;
};

export type Header = {
  kindRange: Range;
  title?: Str;
  attrs: AttrNode[];
  range: Range;
};

export type Ast =
  | { kind: "graph"; header: Header; body: GraphStmt[] }
  | { kind: "sequence"; header: Header; body: SequenceStmt[] }
  | { kind: "state"; header: Header; body: StateStmt[] }
  | { kind: "er"; header: Header; body: ErStmt[] }
  | { kind: "tree"; header: Header; body: TreeLine[] };

const KINDS: readonly Kind[] = ["graph", "sequence", "state", "er", "tree"];
const FLAGS = new Set(["pk", "fk", "uk", "null"]);
const CARDINALITIES: ReadonlyMap<string, Cardinality> = new Map([
  ["1", "one"],
  ["0..1", "zero-or-one"],
  ["1..*", "one-or-more"],
  ["0..*", "zero-or-more"],
]);
const OPERATOR_TOKENS: ReadonlyMap<string, OpSymbol> = new Map([
  ["ARROW", "->"],
  ["LINE", "--"],
  ["ASYNC", "->>"],
  ["REPLY", "-->"],
  ["DOTS", ".."],
]);
const OPERATOR_WORDS: ReadonlyMap<string, OpSymbol> = new Map([
  ["to", "->"],
  ["with", "--"],
  ["async", "->>"],
  ["reply", "-->"],
  ["via", ".."],
]);
const WORD_OF: Readonly<Record<OpSymbol, string>> = {
  "->": "to",
  "--": "with",
  "->>": "async",
  "-->": "reply",
  "..": "via",
};
const OPERATOR_RULES: Readonly<Record<Kind, { noun: string; allowed: readonly OpSymbol[] }>> = {
  graph: { noun: "a graph", allowed: ["->", "--"] },
  sequence: { noun: "a sequence diagram", allowed: ["->", "->>", "-->"] },
  state: { noun: "a state machine", allowed: ["->"] },
  er: { noun: "an entity-relation diagram", allowed: ["--", ".."] },
  tree: { noun: "a tree", allowed: [] },
};

const ABORT = Symbol("abort statement");

function operatorOf(token: Token): OpSymbol | undefined {
  return token.kind === "IDENT"
    ? OPERATOR_WORDS.get(token.text)
    : OPERATOR_TOKENS.get(token.kind);
}

function isPunct(token: Token, text: string): boolean {
  return token.kind === "PUNCT" && token.text === text;
}

function isWord(token: Token, word: string): boolean {
  return token.kind === "IDENT" && token.text === word;
}

function isLineEnd(token: Token): boolean {
  return token.kind === "NEWLINE" || token.kind === "EOF";
}

function joinChoices(items: readonly string[]): string {
  return items.length < 2
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

class Parser {
  private buffer: Token[] = [];
  private lastEnd = 0;
  private kind: Kind = "graph";

  constructor(
    private readonly source: string,
    private readonly lexer: Lexer,
    private readonly sink: Sink,
  ) {}

  private peek(offset = 0): Token {
    while (this.buffer.length <= offset) this.buffer.push(this.lexer.next());
    return this.buffer[offset]!;
  }

  private next(): Token {
    const token = this.peek();
    this.buffer.shift();
    if (token.kind !== "NEWLINE" && token.kind !== "EOF") this.lastEnd = token.end;
    return token;
  }

  private seek(pos: number): void {
    this.lexer.seek(pos);
    this.buffer.length = 0;
  }

  private from(start: number): Range {
    return { start, end: Math.max(start, this.lastEnd) };
  }

  private describe(token: Token): string {
    if (token.kind === "NEWLINE") return "end of line";
    if (token.kind === "EOF") return "end of file";
    return `"${token.text}"`;
  }

  private unexpected(token: Token, expected: string): never {
    if (token.kind !== "ERROR") {
      this.sink.report("E_EXPECTED", token, `${expected}, found ${this.describe(token)}`);
    }
    throw ABORT;
  }

  private fail(code: Parameters<Sink["report"]>[0], range: Range, message: string): never {
    this.sink.report(code, range, message);
    throw ABORT;
  }

  private skipNewlines(): void {
    while (this.peek().kind === "NEWLINE") this.next();
  }

  private endLine(): void {
    const token = this.peek();
    if (!isLineEnd(token)) this.unexpected(token, "Expected end of line");
    this.next();
  }

  private recover(): Opener | undefined {
    let last: Token | undefined;
    let count = 0;
    for (;;) {
      const token = this.peek();
      if (token.kind === "EOF") break;
      this.next();
      if (token.kind === "NEWLINE") break;
      last = token;
      count++;
    }
    if (last && (isPunct(last, "{") || (isWord(last, "do") && count > 1))) {
      return { text: last.text as "{" | "do", range: last };
    }
    return undefined;
  }

  private id(): Ident {
    const token = this.peek();
    if (token.kind === "IDENT" || token.kind === "QUOTED_ID") {
      this.next();
      return { value: token.value, range: token };
    }
    return this.unexpected(token, "Expected an id");
  }

  private label(): Str | undefined {
    const token = this.peek();
    if (token.kind !== "STRING") return undefined;
    this.next();
    return { value: token.value, range: token };
  }

  private value(): Value {
    const token = this.peek();
    if (token.kind === "STRING") {
      this.next();
      return { type: "string", value: token.value, range: token };
    }
    if (token.kind === "NUMBER") {
      this.next();
      return { type: "number", value: Number(token.text), range: token };
    }
    if (token.kind === "IDENT") {
      this.next();
      return { type: "ident", value: token.text, range: token };
    }
    if (isPunct(token, "[")) {
      this.next();
      const items: Value[] = [];
      for (;;) {
        if (isPunct(this.peek(), "]")) break;
        items.push(this.value());
        const separator = this.peek();
        if (isPunct(separator, ",")) this.next();
        else if (!isPunct(separator, "]")) this.unexpected(separator, 'Expected "," or "]"');
      }
      const close = this.next();
      return { type: "list", items, range: { start: token.start, end: close.end } };
    }
    return this.unexpected(token, "Expected a value");
  }

  private attrs(): AttrNode[] {
    if (!isPunct(this.peek(), "[")) return [];
    this.next();
    const attrs: AttrNode[] = [];
    for (;;) {
      const key = this.peek();
      if (isPunct(key, "]")) {
        this.next();
        return attrs;
      }
      if (key.kind !== "IDENT" && key.kind !== "QUOTED_ID") {
        this.unexpected(key, "Expected an attribute name");
      }
      this.next();
      const equals = this.peek();
      if (!isPunct(equals, "=")) this.unexpected(equals, `Expected "=" after attribute "${key.value}"`);
      this.next();
      const value = this.value();
      attrs.push({
        key: key.value,
        keyRange: key,
        value,
        range: { start: key.start, end: value.range.end },
      });
      const separator = this.peek();
      if (isPunct(separator, ",")) this.next();
      else if (!isPunct(separator, "]")) this.unexpected(separator, 'Expected "," or "]"');
    }
  }

  private operator(): Op | undefined {
    const token = this.peek();
    const symbol = operatorOf(token);
    if (symbol === undefined) return undefined;
    const rules = OPERATOR_RULES[this.kind];
    if (!rules.allowed.includes(symbol)) {
      const words = token.kind === "IDENT";
      const allowed = rules.allowed.map((item) => (words ? WORD_OF[item] : item));
      this.fail(
        "E_OPERATOR",
        token,
        `Operator "${token.text}" does not exist in ${rules.noun} (use ${joinChoices(allowed)})`,
      );
    }
    this.next();
    return { symbol, range: token };
  }

  private opener(required: boolean): Opener | undefined {
    const token = this.peek();
    const brace = isPunct(token, "{");
    if (brace || (isWord(token, "do") && isLineEnd(this.peek(1)))) {
      this.next();
      this.endLine();
      return { text: brace ? "{" : "do", range: token };
    }
    if (required) this.unexpected(token, 'Expected "{" or "do" to open a block');
    return undefined;
  }

  private body<T>(opener: Opener | undefined, statement: () => T): T[] {
    const out: T[] = [];
    for (;;) {
      this.skipNewlines();
      const token = this.peek();
      if (token.kind === "EOF") {
        if (opener) {
          this.sink.report(
            "E_BLOCK",
            opener.range,
            `Block opened at line ${this.sink.lineOf(opener.range.start)} is never closed`,
          );
        }
        return out;
      }
      const brace = isPunct(token, "}");
      const end = isWord(token, "end") && isLineEnd(this.peek(1)) && opener !== undefined;
      if (brace || end) {
        const expected = opener?.text === "do" ? "end" : "}";
        if (opener === undefined) {
          this.sink.report("E_BLOCK", token, 'Unexpected "}"');
        } else if (token.text !== expected) {
          this.sink.report(
            "E_BLOCK",
            token,
            `block opened with "${opener.text}" must close with "${expected}"`,
          );
        }
        this.next();
        try {
          this.endLine();
        } catch (error) {
          if (error !== ABORT) throw error;
          this.recover();
        }
        if (opener) return out;
        continue;
      }
      try {
        out.push(statement());
      } catch (error) {
        if (error !== ABORT) throw error;
        const nested = this.recover();
        if (nested) this.body(nested, statement);
      }
    }
  }

  private header(): Header | undefined {
    this.skipNewlines();
    const token = this.peek();
    if (token.kind === "ERROR") return undefined;
    if (!(token.kind === "IDENT" && KINDS.includes(token.text as Kind))) {
      this.sink.report(
        "E_HEADER",
        token,
        `Expected a header such as graph "Title" (kinds: ${KINDS.join(", ")})`,
      );
      return undefined;
    }
    this.next();
    this.kind = token.text as Kind;
    const header: Header = { kindRange: token, attrs: [], range: token };
    try {
      header.title = this.label();
      header.attrs = this.attrs();
      header.range = this.from(token.start);
      this.endLine();
    } catch (error) {
      if (error !== ABORT) throw error;
      header.range = this.from(token.start);
      this.recover();
    }
    return header;
  }

  private graphStatement(): GraphStmt {
    const first = this.peek();
    const start = first.start;
    if (isWord(first, "group")) {
      this.next();
      const id = this.id();
      const label = this.label();
      const attrs = this.attrs();
      const range = this.from(start);
      const opener = this.opener(true);
      return { t: "group", id, label, attrs, range, body: this.body(opener, () => this.graphStatement()) };
    }
    const ids = [this.id()];
    const ops: Op[] = [];
    for (;;) {
      const op = this.operator();
      if (!op) break;
      ops.push(op);
      ids.push(this.id());
    }
    const label = this.label();
    const attrs = this.attrs();
    const range = this.from(start);
    this.endLine();
    if (ops.length === 0) return { t: "node", id: ids[0]!, label, attrs, range };
    return { t: "chain", ids, ops, label, attrs, range };
  }

  private sequenceStatement(): SequenceStmt {
    const start = this.peek().start;
    const id = this.id();
    const op = this.operator();
    if (!op) {
      const label = this.label();
      const attrs = this.attrs();
      const range = this.from(start);
      this.endLine();
      return { t: "participant", id, label, attrs, range };
    }
    const to = this.id();
    const label = this.label();
    const attrs = this.attrs();
    const range = this.from(start);
    this.endLine();
    return { t: "message", from: id, to, op, label, attrs, range };
  }

  private stateStatement(): StateStmt {
    const first = this.peek();
    const start = first.start;
    let from: Endpoint | undefined;
    if (isPunct(first, "*")) {
      this.next();
      from = { star: true, value: "*", range: first };
    } else if (isWord(first, "initial") && operatorOf(this.peek(1)) !== undefined) {
      this.next();
      from = { star: true, value: "*", range: first };
    } else {
      const id = this.id();
      if (operatorOf(this.peek()) === undefined) {
        const label = this.label();
        const attrs = this.attrs();
        const range = this.from(start);
        const opener = this.opener(false);
        if (!opener) {
          this.endLine();
          return { t: "state", id, label, attrs, range };
        }
        return {
          t: "state",
          id,
          label,
          attrs,
          range,
          body: this.body(opener, () => this.stateStatement()),
        };
      }
      from = { star: false, ...id };
    }
    const op = this.operator();
    if (!op) this.unexpected(this.peek(), 'Expected "->"');
    const target = this.peek();
    let to: Endpoint;
    if (isPunct(target, "*") || isWord(target, "final")) {
      this.next();
      to = { star: true, value: "*", range: target };
    } else {
      to = { star: false, ...this.id() };
    }
    const label = this.label();
    const attrs = this.attrs();
    const range = this.from(start);
    this.endLine();
    return { t: "transition", from, to, op: op!, label, attrs, range };
  }

  private card(): Card | undefined {
    const token = this.peek();
    if (token.kind !== "NUMBER" && token.kind !== "CARD") return undefined;
    const value = CARDINALITIES.get(token.text);
    if (value === undefined) {
      this.fail(
        "E_VALUE",
        token,
        `Cardinality must be 1, 0..1, 1..* or 0..*; found "${token.text}"`,
      );
    }
    this.next();
    return { value, range: token };
  }

  private typeExpression(): Str {
    const first = this.next();
    let text = first.text;
    if (isPunct(this.peek(), "(")) {
      this.next();
      text += "(";
      for (;;) {
        const arg = this.peek();
        if (arg.kind !== "NUMBER" && arg.kind !== "IDENT") this.unexpected(arg, "Expected a type argument");
        this.next();
        text += arg.text;
        const separator = this.peek();
        if (isPunct(separator, ",")) {
          this.next();
          text += ",";
        } else if (isPunct(separator, ")")) {
          this.next();
          text += ")";
          break;
        } else {
          this.unexpected(separator, 'Expected "," or ")"');
        }
      }
    }
    if (isPunct(this.peek(), "[") && isPunct(this.peek(1), "]")) {
      this.next();
      this.next();
      text += "[]";
    }
    return { value: text, range: { start: first.start, end: this.lastEnd } };
  }

  private attributeLine(): AttributeLine {
    const start = this.peek().start;
    const name = this.id();
    let type: Str | undefined;
    const token = this.peek();
    if (token.kind === "STRING") {
      this.next();
      type = { value: token.value, range: token };
    } else if (token.kind === "IDENT" && !FLAGS.has(token.text)) {
      type = this.typeExpression();
    }
    const flags: { value: string; range: Range }[] = [];
    for (;;) {
      const flag = this.peek();
      if (flag.kind !== "IDENT" || !FLAGS.has(flag.text)) break;
      this.next();
      flags.push({ value: flag.text, range: flag });
    }
    const attrs = this.attrs();
    const range = this.from(start);
    this.endLine();
    return { name, type, flags, attrs, range };
  }

  private erStatement(): ErStmt {
    const start = this.peek().start;
    const id = this.id();
    const next = this.peek();
    if (next.kind === "NUMBER" || next.kind === "CARD" || operatorOf(next) !== undefined) {
      const fromCard = this.card();
      const op = this.operator();
      if (!op) this.unexpected(this.peek(), 'Expected "--" or ".."');
      const toCard = this.card();
      const to = this.id();
      const label = this.label();
      const attrs = this.attrs();
      const range = this.from(start);
      this.endLine();
      return { t: "relation", from: id, fromCard, op: op!, toCard, to, label, attrs, range };
    }
    const label = this.label();
    const attrs = this.attrs();
    const range = this.from(start);
    const opener = this.opener(false);
    if (!opener) {
      this.endLine();
      return { t: "entity", id, label, attrs, range };
    }
    return {
      t: "entity",
      id,
      label,
      attrs,
      range,
      attributes: this.body(opener, () => this.attributeLine()),
    };
  }

  private treeBody(): TreeLine[] {
    const source = this.source;
    const lines: TreeLine[] = [];
    const levels: { width: number; parent: number; index: number }[] = [];
    let indentChar: string | undefined;
    let firstRoot = 0;
    let pos = this.lexer.pos;
    while (pos < source.length) {
      let end = source.indexOf("\n", pos);
      if (end < 0) end = source.length;
      const nextLine = end + 1;
      let text = pos;
      while (text < end && (source[text] === " " || source[text] === "\t")) text++;
      if (text >= end || source[text] === "#") {
        pos = nextLine;
        continue;
      }
      const indent = { start: pos, end: text };
      const width = text - pos;
      const indentation = source.slice(pos, text);
      if (
        (indentation.includes(" ") && indentation.includes("\t")) ||
        (width > 0 && indentChar !== undefined && indentation[0] !== indentChar)
      ) {
        this.sink.report("E_INDENT", indent, "Tabs and spaces are mixed in indentation");
        pos = nextLine;
        continue;
      }

      if (width > 0) indentChar ??= indentation[0];
      let parent = -1;
      let keep = levels.length;
      if (levels.length === 0) {
        if (width !== 0) {
          this.sink.report("E_INDENT", indent, "The first line of a tree must not be indented");
          pos = nextLine;
          continue;
        }
        firstRoot = text;
      } else if (width === 0) {
        this.sink.report(
          "E_ROOT",
          { start: text, end: end },
          `A tree has one root; this line starts a second one (first root at line ${this.sink.lineOf(firstRoot)})`,
        );
        pos = nextLine;
        continue;
      } else if (width > levels[levels.length - 1]!.width) {
        parent = levels[levels.length - 1]!.index;
      } else {
        const level = levels.findIndex((item) => item.width === width);
        if (level < 0) {
          this.sink.report(
            "E_INDENT",
            indent,
            `Indentation of ${width} does not match an open level (${levels.map((item) => item.width).join(", ")})`,
          );
          pos = nextLine;
          continue;
        }
        parent = levels[level]!.parent;
        keep = level;
      }

      let label: Str | undefined;
      let attrs: AttrNode[] = [];
      if (source[text] === '"') {
        this.seek(text);
        try {
          const token = this.next();
          if (token.kind !== "STRING") throw ABORT;
          label = { value: token.value, range: token };
          attrs = this.attrs();
          this.endLine();
        } catch (error) {
          if (error !== ABORT) throw error;
          this.recover();
        }
      } else {
        let rest = text;
        while (rest < end && source[rest] !== "[" && source[rest] !== "#") rest++;
        const bare = source.slice(text, rest).trimEnd();
        if (bare === "") {
          this.sink.report("E_EXPECTED", { start: rest, end: rest + 1 }, 'Expected a label, found "["');
          pos = nextLine;
          continue;
        }
        const quote = bare.indexOf('"');
        if (quote >= 0) {
          this.sink.report(
            "E_TOKEN",
            { start: text + quote, end: text + quote + 1 },
            'Bare text cannot contain """; write the whole label as a string',
          );
          pos = nextLine;
          continue;
        }
        label = { value: bare, range: { start: text, end: text + bare.length } };
        this.seek(rest);
        try {
          attrs = this.attrs();
          this.endLine();
        } catch (error) {
          if (error !== ABORT) throw error;
          this.recover();
        }
      }
      pos = this.lexer.pos;
      if (!label) continue;

      levels.length = keep;
      levels.push({ width, parent, index: lines.length });
      lines.push({ label, attrs, parent, range: { start: text, end: Math.max(label.range.end, this.lastEnd) } });
    }
    return lines;
  }

  document(): Ast | undefined {
    const header = this.header();
    if (!header) return undefined;
    const kind = this.kind;
    switch (kind) {
      case "graph":
        return { kind, header, body: this.body(undefined, () => this.graphStatement()) };
      case "sequence":
        return { kind, header, body: this.body(undefined, () => this.sequenceStatement()) };
      case "state":
        return { kind, header, body: this.body(undefined, () => this.stateStatement()) };
      case "er":
        return { kind, header, body: this.body(undefined, () => this.erStatement()) };
      case "tree":
        return { kind, header, body: this.treeBody() };
    }
  }
}

export function parseSyntax(source: string, sink: Sink): Ast | undefined {
  const lexer = new Lexer(source, sink);
  const parser = new Parser(source, lexer, sink);
  try {
    return parser.document();
  } catch (error) {
    if (error === STOP) return undefined;
    throw error;
  }
}
