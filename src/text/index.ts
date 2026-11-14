import { validate } from "../format/validate";
import type { Document } from "../format/schema";
import { build, type Marks } from "./build";
import { LineMap, STOP, Sink, type Range, type TextError } from "./errors";
import { normalize } from "./lexer";
import { parseSyntax } from "./parser";

export { canonicalize } from "./canonical";
export type { TextError, TextErrorCode } from "./errors";
export { print, type PrintOptions, type PrintStyle } from "./print";

export type ParseResult =
  | { ok: true; document: Document }
  | { ok: false; errors: TextError[] };

function rangeOf(marks: Marks, path: string): Range {
  let pointer = path;
  for (;;) {
    const range = marks.get(pointer);
    if (range) return range;
    if (pointer === "") return { start: 0, end: 0 };
    pointer = pointer.slice(0, pointer.lastIndexOf("/"));
  }
}

export function parse(source: string): ParseResult {
  const text = normalize(source);
  const sink = new Sink(new LineMap(text));
  try {
    const ast = parseSyntax(text, sink);
    if (ast && sink.errors.length === 0) {
      const marks: Marks = new Map();
      const document = build(ast, { sink, marks });
      if (sink.errors.length === 0) {
        const result = validate(document);
        if (result.ok) return { ok: true, document: result.document };
        for (const error of result.errors) {
          sink.report("E_VALIDATE", rangeOf(marks, error.path), error.message);
        }
      }
    }
  } catch (error) {
    if (error !== STOP) throw error;
  }
  return { ok: false, errors: sink.sorted() };
}
