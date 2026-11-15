import { LineMap, Sink, type TextError } from "./errors";
import { normalize } from "./lexer";
import { parseSyntaxPartial, type Ast } from "./parser";

export type SyntaxResult = { ast: Ast; errors: TextError[]; text: string };

export function parseTree(source: string): SyntaxResult {
  const text = normalize(source);
  const sink = new Sink(new LineMap(text));
  const ast = parseSyntaxPartial(text, sink);
  return { ast, errors: sink.sorted(), text };
}
