import { LineMap, Sink, STOP, type Range as Span } from "../text/errors";
import { Lexer, type Token } from "../text/lexer";
import type { Ast } from "../text/parser";
import { parseTree } from "../text/syntax";

export type Position = { line: number; character: number };
export type Range = { start: Position; end: Position };
export type TextEdit = { range: Range; newText: string };
export type FormatOptions = { indent?: number };

const DEFAULT_INDENT = 2;
const NO_SPACE_BEFORE = new Set(["]", ")", ",", "=", "("]);
const NO_SPACE_AFTER = new Set(["[", "(", "="]);

function isPunct(token: Token | undefined, text: string): boolean {
  return token !== undefined && token.kind === "PUNCT" && token.text === text;
}

function needsSpace(previous: Token, token: Token, next: Token | undefined): boolean {
  if (token.kind === "PUNCT") {
    if (NO_SPACE_BEFORE.has(token.text)) return false;
    if (
      token.text === "[" &&
      isPunct(next, "]") &&
      (previous.kind === "IDENT" || isPunct(previous, ")"))
    ) {
      return false;
    }
  }
  return !(previous.kind === "PUNCT" && NO_SPACE_AFTER.has(previous.text));
}

function join(tokens: Token[]): string {
  let out = "";
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (index > 0 && needsSpace(tokens[index - 1]!, token, tokens[index + 1])) out += " ";
    out += token.text;
  }
  return out;
}

function openers(ast: Ast): Set<number> {
  const ends = new Set<number>();
  const visit = (statements: readonly unknown[]): void => {
    for (const statement of statements) {
      const node = statement as {
        range: Span;
        body?: unknown[];
        attributes?: unknown[];
      };
      if (node.body !== undefined) {
        ends.add(node.range.end);
        visit(node.body);
      } else if (node.attributes !== undefined) {
        ends.add(node.range.end);
      }
    }
  };
  if (ast.kind !== "tree") visit(ast.body);
  return ends;
}

function treeLevels(ast: Ast): number[] {
  const levels: number[] = [];
  if (ast.kind !== "tree") return levels;
  for (const line of ast.body) levels.push(line.parent < 0 ? 0 : levels[line.parent]! + 1);
  return levels;
}

function layout(text: string, ast: Ast, unit: number): string[] | undefined {
  const sink = new Sink(new LineMap(text));
  const comments: Span[] = [];
  const lexer = new Lexer(text, sink, comments);
  const openerEnds = openers(ast);
  const levels = treeLevels(ast);
  const lines: string[] = [];
  let cursor = 0;
  let depth = 0;

  const indentOf = (level: number): string => " ".repeat(unit * level);
  const take = (from: number, to: number): Span[] => {
    while (cursor < comments.length && comments[cursor]!.start < from) cursor++;
    const taken: Span[] = [];
    while (cursor < comments.length && comments[cursor]!.start < to) taken.push(comments[cursor++]!);
    return taken;
  };
  const commentText = (comment: Span): string => text.slice(comment.start, comment.end).trimEnd();
  const render = (tokens: Token[], found: Span[]): string => {
    const last = tokens[tokens.length - 1];
    let body = "";
    let trailing: Span | undefined;
    let inner = false;
    for (const comment of found) {
      if (last !== undefined && comment.start < last.end) inner = true;
      else trailing ??= comment;
    }
    if (last !== undefined) {
      body = inner
        ? text
            .slice(tokens[0]!.start, last.end)
            .split("\n")
            .map((line) => line.trimEnd())
            .join("\n")
        : join(tokens);
    }
    if (trailing === undefined) return body;
    return body === "" ? commentText(trailing) : `${body} ${commentText(trailing)}`;
  };

  let group: Token[] = [];
  let lineStart = 0;
  let headerDone = false;
  let resume = 0;
  for (;;) {
    const token = lexer.next();
    if (token.kind !== "NEWLINE" && token.kind !== "EOF") {
      group.push(token);
      continue;
    }
    const found = take(lineStart, token.start);
    if (group.length === 0) {
      lines.push(found.length > 0 ? indentOf(depth) + commentText(found[0]!) : "");
    } else {
      const first = group[0]!;
      const closes =
        depth > 0 &&
        (isPunct(first, "}") || (group.length === 1 && first.kind === "IDENT" && first.text === "end"));
      if (closes) depth--;
      lines.push(indentOf(depth) + render(group, found));
      let previousEnd = -1;
      for (const item of group) {
        if (openerEnds.has(previousEnd)) depth++;
        previousEnd = item.end;
      }
      headerDone = true;
    }
    group = [];
    lineStart = token.end;
    resume = token.end;
    if (token.kind === "EOF") break;
    if (ast.kind === "tree" && headerDone) break;
  }

  if (ast.kind === "tree") {
    let position = resume;
    let next = 0;
    while (position < text.length) {
      let end = text.indexOf("\n", position);
      if (end < 0) end = text.length;
      let start = position;
      while (start < end && (text[start] === " " || text[start] === "\t")) start++;
      if (start >= end) {
        lines.push("");
      } else if (text[start] === "#") {
        const level = next < levels.length ? levels[next]! : 0;
        lines.push(indentOf(level) + text.slice(start, end).trimEnd());
      } else {
        const node = ast.body[next];
        if (node === undefined || node.range.start !== start) return undefined;
        const level = levels[next]!;
        next++;
        const labelEnd = node.label.range.end;
        lexer.seek(labelEnd);
        const tokens: Token[] = [];
        let terminator = lexer.next();
        while (terminator.kind !== "NEWLINE" && terminator.kind !== "EOF") {
          tokens.push(terminator);
          terminator = lexer.next();
        }
        const found = take(labelEnd, terminator.start);
        const rest = render(tokens, found);
        const label = text.slice(start, labelEnd);
        lines.push(indentOf(level) + label + (rest === "" ? "" : ` ${rest}`));
        position = terminator.end;
        continue;
      }
      position = end + 1;
    }
  }

  if (sink.errors.length > 0) return undefined;
  return lines;
}

function tidy(lines: string[]): string[] {
  let first = 0;
  while (first < lines.length && lines[first] === "") first++;
  let last = lines.length;
  while (last > first && lines[last - 1] === "") last--;
  const kept: string[] = [];
  for (let index = first; index < last; index++) {
    const line = lines[index]!;
    if (line === "" && kept[kept.length - 1] === "") continue;
    kept.push(line);
  }
  return kept;
}

export function formatText(source: string, options: FormatOptions = {}): string | undefined {
  const { ast, errors, text } = parseTree(source);
  if (errors.some((error) => error.code !== "E_VALIDATE")) return undefined;
  let lines: string[] | undefined;
  try {
    lines = layout(text, ast, options.indent ?? DEFAULT_INDENT);
  } catch (error) {
    if (error !== STOP) throw error;
    return undefined;
  }
  if (lines === undefined) return undefined;
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const bom = source.charCodeAt(0) === 0xfeff ? String.fromCharCode(0xfeff) : "";
  const body = `${tidy(lines).join("\n")}\n`;
  return bom + (eol === "\n" ? body : body.replaceAll("\n", eol));
}

function endOf(source: string): Position {
  let line = 0;
  let lineStart = 0;
  for (let index = 0; index < source.length; index++) {
    if (source.charCodeAt(index) === 10) {
      line++;
      lineStart = index + 1;
    }
  }
  return { line, character: source.length - lineStart };
}

export function format(source: string, options: FormatOptions = {}): TextEdit[] {
  const formatted = formatText(source, options);
  if (formatted === undefined || formatted === source) return [];
  return [{ range: { start: { line: 0, character: 0 }, end: endOf(source) }, newText: formatted }];
}
