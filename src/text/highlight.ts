import { LineMap, Sink } from "./errors";
import { Lexer, normalize, type Token } from "./lexer";
import { FLAGS, KINDS, type Kind, OPERATOR_WORDS } from "./parser";

export const SEMANTIC_TOKEN_TYPES = [
  "namespace",
  "type",
  "variable",
  "property",
  "enumMember",
  "keyword",
  "comment",
  "string",
  "number",
  "operator",
] as const;

export const SEMANTIC_TOKEN_MODIFIERS = ["declaration", "defaultLibrary"] as const;

export type SemanticTokenType = (typeof SEMANTIC_TOKEN_TYPES)[number];
export type SemanticTokenModifier = (typeof SEMANTIC_TOKEN_MODIFIERS)[number];

export type HighlightToken = {
  start: number;
  end: number;
  line: number;
  column: number;
  type: SemanticTokenType;
  modifiers?: SemanticTokenModifier[];
};

const ENUM_KEYS = new Set(["shape", "pseudo", "confidence", "direction", "layout"]);
const SYMBOL_OPERATORS = new Set(["ARROW", "LINE", "ASYNC", "REPLY", "DOTS"]);

function isPunct(token: Token | undefined, text: string): boolean {
  return token !== undefined && token.kind === "PUNCT" && token.text === text;
}

function isWord(token: Token | undefined, word: string): boolean {
  return token !== undefined && token.kind === "IDENT" && token.text === word;
}

function isId(token: Token | undefined): token is Token {
  return token !== undefined && (token.kind === "IDENT" || token.kind === "QUOTED_ID");
}

function isOperator(token: Token | undefined): boolean {
  return (
    token !== undefined &&
    (SYMBOL_OPERATORS.has(token.kind) || (token.kind === "IDENT" && OPERATOR_WORDS.has(token.text)))
  );
}

function isCard(token: Token | undefined): boolean {
  return token !== undefined && (token.kind === "NUMBER" || token.kind === "CARD");
}

function offsets(source: string): number[] | undefined {
  const bom = source.charCodeAt(0) === 0xfeff;
  if (!bom && !source.includes("\r\n")) return undefined;
  const map: number[] = [];
  for (let index = bom ? 1 : 0; index < source.length; index++) {
    if (source[index] === "\r" && source[index + 1] === "\n") continue;
    map.push(index);
  }
  map.push(source.length);
  return map;
}

class Cursor {
  index = 0;

  constructor(readonly tokens: readonly Token[]) {}

  peek(offset = 0): Token | undefined {
    return this.tokens[this.index + offset];
  }

  take(): Token {
    return this.tokens[this.index++]!;
  }

  get last(): boolean {
    return this.index === this.tokens.length - 1;
  }

  get done(): boolean {
    return this.index >= this.tokens.length;
  }
}

type Block = "entity" | "other";

class Highlighter {
  private readonly text: string;
  private readonly map: number[] | undefined;
  private readonly lines: LineMap;
  private readonly lexer: Lexer;
  readonly out: HighlightToken[] = [];
  private eof = false;
  private readonly blocks: Block[] = [];

  constructor(private readonly source: string) {
    this.text = normalize(source);
    this.map = offsets(source);
    this.lines = new LineMap(this.text);
    const sink = new Sink(this.lines);
    sink.muted = 1;
    this.lexer = new Lexer(this.text, sink);
  }

  private emit(
    start: number,
    end: number,
    type: SemanticTokenType,
    modifiers?: SemanticTokenModifier[],
  ): void {
    if (end <= start) return;
    const position = this.lines.position(start);
    const token: HighlightToken = {
      start: this.map ? this.map[start]! : start,
      end: this.map ? this.map[end - 1]! + 1 : end,
      line: position.line,
      column: position.column,
      type,
    };
    if (modifiers !== undefined) token.modifiers = modifiers;
    this.out.push(token);
  }

  private mark(token: Token, type: SemanticTokenType, modifiers?: SemanticTokenModifier[]): void {
    this.emit(token.start, token.end, type, modifiers);
  }

  private comments(from: number, to: number): void {
    const gap = this.text.slice(from, Math.max(from, to));
    for (const match of gap.matchAll(/#[^\n]*/g)) {
      this.emit(from + match.index, from + match.index + match[0].length, "comment");
    }
  }

  private line(): Token[] {
    const tokens: Token[] = [];
    for (;;) {
      const from = this.lexer.pos;
      const token = this.lexer.next();
      if (token.kind === "ERROR" && token.start < from) {
        this.comments(from, this.text.length);
        this.eof = true;
        return tokens;
      }
      this.comments(from, token.start);
      if (token.kind === "EOF") {
        this.eof = true;
        return tokens;
      }
      if (token.kind === "NEWLINE") return tokens;
      tokens.push(token);
    }
  }

  private quotedError(token: Token): void {
    if (token.kind === "ERROR" && token.text.startsWith('"')) this.mark(token, "string");
  }

  private label(cursor: Cursor): void {
    const token = cursor.peek();
    if (token === undefined) return;
    if (token.kind === "STRING") {
      cursor.take();
      this.mark(token, "string");
    } else if (token.kind === "ERROR" && token.text.startsWith('"')) {
      cursor.take();
      this.quotedError(token);
    }
  }

  private attrs(cursor: Cursor): void {
    if (!isPunct(cursor.peek(), "[")) return;
    cursor.take();
    let depth = 1;
    let key = "";
    while (!cursor.done) {
      const token = cursor.take();
      if (token.kind === "PUNCT") {
        if (token.text === "[") depth++;
        else if (token.text === "]" && --depth === 0) return;
        else if (token.text === "=") this.mark(token, "operator");
        continue;
      }
      if ((token.kind === "IDENT" || token.kind === "QUOTED_ID") && isPunct(cursor.peek(), "=")) {
        key = token.text;
        this.mark(token, "property");
      } else if (token.kind === "STRING") {
        this.mark(token, "string");
      } else if (token.kind === "NUMBER") {
        this.mark(token, "number");
      } else if (token.kind === "IDENT") {
        if (ENUM_KEYS.has(key)) this.mark(token, "enumMember");
        else if (token.text === "true" || token.text === "false") this.mark(token, "keyword");
        else this.mark(token, "string");
      } else {
        this.quotedError(token);
      }
    }
  }

  private rest(cursor: Cursor): void {
    while (!cursor.done) {
      const token = cursor.peek()!;
      if (isPunct(token, "[")) {
        this.attrs(cursor);
        continue;
      }
      cursor.take();
      if (token.kind === "STRING") this.mark(token, "string");
      else if (token.kind === "NUMBER" || token.kind === "CARD") this.mark(token, "number");
      else if (isOperator(token) || isPunct(token, "*")) this.mark(token, "operator");
      else if (isId(token)) this.mark(token, "variable");
      else this.quotedError(token);
    }
  }

  private opener(cursor: Cursor, block: Block): void {
    const token = cursor.peek();
    if (isPunct(token, "{")) {
      cursor.take();
      this.blocks.push(block);
    } else if (isWord(token, "do") && cursor.last) {
      this.mark(cursor.take(), "keyword");
      this.blocks.push(block);
    }
  }

  private card(cursor: Cursor): void {
    if (isCard(cursor.peek())) this.mark(cursor.take(), "number");
  }

  private header(tokens: readonly Token[]): Kind {
    const cursor = new Cursor(tokens);
    const kind = cursor.take();
    this.mark(kind, "keyword", ["defaultLibrary"]);
    this.label(cursor);
    this.attrs(cursor);
    this.rest(cursor);
    return kind.text as Kind;
  }

  private attributeLine(cursor: Cursor): void {
    const name = cursor.peek();
    if (isId(name)) {
      cursor.take();
      this.mark(name, "variable", ["declaration"]);
    }
    const type = cursor.peek();
    if (type !== undefined && type.kind === "STRING") {
      cursor.take();
      this.mark(type, "string");
    } else if (type !== undefined && type.kind === "IDENT" && !FLAGS.has(type.text)) {
      cursor.take();
      this.mark(type, "type");
      if (isPunct(cursor.peek(), "(")) {
        cursor.take();
        while (!cursor.done && !isPunct(cursor.peek(), ")") && !isPunct(cursor.peek(), "[")) {
          const arg = cursor.take();
          if (arg.kind === "NUMBER") this.mark(arg, "number");
          else if (arg.kind === "IDENT") this.mark(arg, "type");
        }
        if (isPunct(cursor.peek(), ")")) cursor.take();
      }
      if (isPunct(cursor.peek(), "[") && isPunct(cursor.peek(1), "]")) {
        cursor.take();
        cursor.take();
      }
    }
    for (;;) {
      const flag = cursor.peek();
      if (flag === undefined || flag.kind !== "IDENT" || !FLAGS.has(flag.text)) break;
      cursor.take();
      this.mark(flag, "keyword");
    }
    this.attrs(cursor);
    this.rest(cursor);
  }

  private statement(kind: Kind, tokens: readonly Token[]): void {
    const cursor = new Cursor(tokens);
    const first = cursor.peek();
    if (first === undefined) return;
    if (this.blocks.length > 0 && isWord(first, "end") && tokens.length === 1) {
      cursor.take();
      this.mark(first, "keyword");
      this.blocks.pop();
      return;
    }
    if (isPunct(first, "}")) {
      this.blocks.pop();
      cursor.take();
      this.rest(cursor);
      return;
    }
    if (this.blocks[this.blocks.length - 1] === "entity") {
      this.attributeLine(cursor);
      return;
    }
    if (kind === "graph" && isWord(first, "group")) {
      cursor.take();
      this.mark(first, "keyword");
      const id = cursor.peek();
      if (isId(id)) {
        cursor.take();
        this.mark(id, "namespace", ["declaration"]);
      }
      this.label(cursor);
      this.attrs(cursor);
      this.opener(cursor, "other");
      this.rest(cursor);
      return;
    }

    if (kind === "state" && (isPunct(first, "*") || (isWord(first, "initial") && isOperator(cursor.peek(1))))) {
      cursor.take();
      this.mark(first, "operator");
    } else if (isId(first)) {
      cursor.take();
      const next = cursor.peek();
      const relation = isOperator(next) || (kind === "er" && isCard(next));
      if (!relation) {
        this.mark(first, "variable", ["declaration"]);
        this.label(cursor);
        this.attrs(cursor);
        if (kind === "state") this.opener(cursor, "other");
        else if (kind === "er") this.opener(cursor, "entity");
        this.rest(cursor);
        return;
      }
      this.mark(first, "variable");
    } else {
      this.rest(cursor);
      return;
    }

    for (;;) {
      if (kind === "er") this.card(cursor);
      const operator = cursor.peek();
      if (!isOperator(operator)) break;
      cursor.take();
      this.mark(operator!, "operator");
      if (kind === "er") this.card(cursor);
      const target = cursor.peek();
      if (kind === "state" && (isPunct(target, "*") || isWord(target, "final"))) {
        cursor.take();
        this.mark(target!, "operator");
      } else if (isId(target)) {
        cursor.take();
        this.mark(target, "variable");
      } else {
        break;
      }
    }
    this.label(cursor);
    this.attrs(cursor);
    this.rest(cursor);
  }

  private tree(): void {
    const text = this.text;
    let pos = this.lexer.pos;
    while (pos < text.length) {
      let end = text.indexOf("\n", pos);
      if (end < 0) end = text.length;
      let start = pos;
      while (start < end && (text[start] === " " || text[start] === "\t")) start++;
      if (start >= end) {
        pos = end + 1;
        continue;
      }
      if (text[start] === "#") {
        this.emit(start, end, "comment");
        pos = end + 1;
        continue;
      }
      let rest = start;
      if (text[start] === '"') {
        this.lexer.seek(start);
      } else {
        while (rest < end && text[rest] !== "[" && text[rest] !== "#") rest++;
        const bare = text.slice(start, rest).trimEnd();
        this.emit(start, start + bare.length, "string");
        this.lexer.seek(rest);
      }
      const cursor = new Cursor(this.line());
      if (text[start] === '"') this.label(cursor);
      this.attrs(cursor);
      this.rest(cursor);
      pos = Math.max(this.lexer.pos, end + 1);
      if (this.eof) break;
    }
  }

  run(): void {
    let tokens = this.line();
    while (tokens.length === 0) {
      if (this.eof) return;
      tokens = this.line();
    }
    const first = tokens[0]!;
    if (!(first.kind === "IDENT" && (KINDS as readonly string[]).includes(first.text))) return;
    const kind = this.header(tokens);
    if (this.eof) return;
    if (kind === "tree") {
      this.tree();
      return;
    }
    while (!this.eof) this.statement(kind, this.line());
  }
}

export function highlight(source: string): HighlightToken[] {
  const highlighter = new Highlighter(source);
  try {
    highlighter.run();
  } catch {}
  const sorted = highlighter.out.sort((a, b) => a.start - b.start || a.end - b.end);
  const result: HighlightToken[] = [];
  let end = 0;
  for (const token of sorted) {
    if (token.start < end) continue;
    result.push(token);
    end = token.end;
  }
  return result;
}
