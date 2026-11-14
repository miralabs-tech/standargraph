import { LineMap, STOP, Sink, type TextError } from "./errors";

export type TokenKind =
  | "NEWLINE"
  | "STRING"
  | "QUOTED_ID"
  | "REPLY"
  | "ASYNC"
  | "ARROW"
  | "LINE"
  | "CARD"
  | "DOTS"
  | "PUNCT"
  | "NUMBER"
  | "IDENT"
  | "ERROR"
  | "EOF";

export type Token = {
  kind: TokenKind;
  text: string;
  value: string;
  start: number;
  end: number;
};

const OPERATORS: readonly (readonly [string, TokenKind])[] = [
  ["-->", "REPLY"],
  ["->>", "ASYNC"],
  ["->", "ARROW"],
  ["--", "LINE"],
];
const CARD = /0\.\.1|1\.\.\*|0\.\.\*/y;
const NUMBER = /-?[0-9]+(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?/y;
const IDENT = /[\p{L}_][\p{L}\p{N}_]*(?:[./-][\p{L}\p{N}_]+)*/uy;
const UNICODE_ESCAPE = /^\{([0-9a-fA-F]{1,6})\}/;
const SIMPLE_ESCAPES: Readonly<Record<string, string>> = { n: "\n", t: "\t" };
const PUNCTUATION = "{}[]()=,*";

export function normalize(source: string): string {
  return source.replace(/^﻿/, "").replace(/\r\n/g, "\n");
}

export class Lexer {
  pos = 0;
  private depth = 0;
  private openAt = 0;

  constructor(
    private readonly source: string,
    private readonly sink: Sink,
  ) {}

  seek(pos: number): void {
    this.pos = pos;
    this.depth = 0;
  }

  next(): Token {
    const source = this.source;
    let char: string | undefined;
    for (;;) {
      char = source[this.pos];
      while (char === " " || char === "\t") char = source[++this.pos];
      if (char === "#") {
        while (char !== undefined && char !== "\n") char = source[++this.pos];
      }
      if (char === "\n") {
        const start = this.pos++;
        if (this.depth > 0) continue;
        return this.token("NEWLINE", start, this.pos);
      }
      break;
    }

    if (char === undefined) {
      if (this.depth === 0) return this.token("EOF", this.pos, this.pos);
      const at = this.openAt;
      this.depth = 0;
      this.sink.report(
        "E_EXPECTED",
        { start: at, end: at + 1 },
        `Expected "]" before the end of the file: the "[" opened at line ${this.sink.lineOf(at)} is never closed`,
      );
      return this.token("ERROR", at, at + 1);
    }

    const start = this.pos;
    if (char === '"') return this.quoted(start, '"', "STRING");
    if (char === "`") return this.quoted(start, "`", "QUOTED_ID");

    for (const [text, kind] of OPERATORS) {
      if (source.startsWith(text, start)) return this.advance(kind, start, text.length);
    }
    CARD.lastIndex = start;
    const card = CARD.exec(source);
    if (card) return this.advance("CARD", start, card[0].length);
    if (source.startsWith("..", start)) return this.advance("DOTS", start, 2);
    if (PUNCTUATION.includes(char)) {
      if (char === "[") {
        if (this.depth === 0) this.openAt = start;
        this.depth++;
      } else if (char === "]" && this.depth > 0) {
        this.depth--;
      }
      return this.advance("PUNCT", start, 1);
    }
    NUMBER.lastIndex = start;
    const number = NUMBER.exec(source);
    if (number) return this.advance("NUMBER", start, number[0].length);
    IDENT.lastIndex = start;
    const ident = IDENT.exec(source);
    if (ident) return this.advance("IDENT", start, ident[0].length);

    const unexpected = String.fromCodePoint(source.codePointAt(start)!);
    const end = start + unexpected.length;
    this.sink.report("E_TOKEN", { start, end }, `Unexpected character "${unexpected}"`);
    this.pos = end;
    return this.token("ERROR", start, end);
  }

  private token(kind: TokenKind, start: number, end: number, value?: string): Token {
    const text = this.source.slice(start, end);
    return { kind, text, value: value ?? text, start, end };
  }

  private advance(kind: TokenKind, start: number, length: number): Token {
    this.pos = start + length;
    return this.token(kind, start, this.pos);
  }

  private quoted(start: number, quote: string, kind: "STRING" | "QUOTED_ID"): Token {
    const source = this.source;
    const what = kind === "STRING" ? "string" : "quoted id";
    let index = start + 1;
    let value = "";
    let bad = false;
    for (;;) {
      const char = source[index];
      if (char === undefined || char === "\n") {
        this.sink.report("E_STRING", { start, end: index }, `Unterminated ${what}`);
        this.pos = index;
        return this.token("ERROR", start, index);
      }
      if (char === quote) {
        index++;
        break;
      }
      if (char !== "\\") {
        value += char;
        index++;
        continue;
      }
      const escape = source[index + 1];
      if (escape === undefined || escape === "\n") {
        index++;
        continue;
      }
      if (escape === quote || escape === "\\") {
        value += escape;
        index += 2;
        continue;
      }
      if (kind === "STRING" && Object.hasOwn(SIMPLE_ESCAPES, escape)) {
        value += SIMPLE_ESCAPES[escape];
        index += 2;
        continue;
      }
      if (kind === "STRING" && escape === "u") {
        const match = UNICODE_ESCAPE.exec(source.slice(index + 2, index + 10));
        const code = match ? Number.parseInt(match[1]!, 16) : -1;
        if (match && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)) {
          value += String.fromCodePoint(code);
          index += 2 + match[0].length;
          continue;
        }
        const length = match ? 2 + match[0].length : 2;
        this.sink.report(
          "E_ESCAPE",
          { start: index, end: index + length },
          `Invalid unicode escape in string: expected \\u{ followed by 1 to 6 hexadecimal digits of a code point, then }`,
        );
        bad = true;
        index += length;
        continue;
      }
      const unknown = String.fromCodePoint(source.codePointAt(index + 1)!);
      this.sink.report(
        "E_ESCAPE",
        { start: index, end: index + 1 + unknown.length },
        `Unknown escape "\\${unknown}" in ${what}`,
      );
      bad = true;
      index += 1 + unknown.length;
    }
    this.pos = index;
    return bad ? this.token("ERROR", start, index) : this.token(kind, start, index, value);
  }
}

export function tokenize(source: string): { tokens: Token[]; errors: TextError[] } {
  const text = normalize(source);
  const sink = new Sink(new LineMap(text));
  const lexer = new Lexer(text, sink);
  const tokens: Token[] = [];
  try {
    for (;;) {
      const token = lexer.next();
      if (token.kind === "EOF") break;
      tokens.push(token);
    }
  } catch (error) {
    if (error !== STOP) throw error;
  }
  return { tokens, errors: sink.sorted() };
}

