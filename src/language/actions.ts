import { IDENT } from "../text/lexer";
import { parse } from "../text";
import type { Range as Span } from "../text/errors";
import { analyze } from "./analysis";
import { collect, type Finding } from "./diagnostics";
import type { Position, Range } from "./format";
import type { CodeAction } from "./types";

const BARE = new RegExp(`^(?:${IDENT.source})$`, "u");
const RESERVED = new Set(["to", "with", "async", "reply", "via", "initial", "final", "do", "end", "group"]);

type Change = Span & { newText: string };

function idText(id: string): string {
  if (BARE.test(id) && !RESERVED.has(id)) return id;
  return `\`${id.replace(/[\`]/g, "\$&")}\``;
}

function errorCount(text: string): number {
  const result = parse(text);
  return result.ok ? 0 : result.errors.length;
}

function apply(text: string, changes: Change[]): string {
  let result = text;
  for (const change of [...changes].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, change.start) + change.newText + result.slice(change.end);
  }
  return result;
}

function before(a: Position, b: Position): boolean {
  return a.line < b.line || (a.line === b.line && a.character < b.character);
}

function touches(inner: Range, outer: Range): boolean {
  return !before(outer.end, inner.start) && !before(inner.end, outer.start);
}

function lineStart(text: string, offset: number): number {
  return text.lastIndexOf("\n", offset - 1) + 1;
}

function removeLine(text: string, offset: number): Span {
  const start = lineStart(text, offset);
  const newline = text.indexOf("\n", offset);
  if (newline >= 0) return { start, end: newline + 1 };
  return { start: start > 0 ? start - 1 : start, end: text.length };
}

export function codeActions(source: string, range: Range): CodeAction[] {
  const analysis = analyze(source);
  const text = analysis.conv.text;
  const baseline = errorCount(text);
  const actions: CodeAction[] = [];

  const offer = (finding: Finding, title: string, changes: Change[]): void => {
    if (errorCount(apply(text, changes)) > baseline) return;
    actions.push({
      title,
      kind: "quickfix",
      diagnostic: finding.diagnostic,
      edit: {
        changes: changes.map((change) => ({
          range: { start: analysis.conv.position(change.start), end: analysis.conv.position(change.end) },
          newText: change.newText,
        })),
      },
    });
  };

  for (const finding of collect(source)) {
    if (!touches(finding.diagnostic.range, range)) continue;
    const { code } = finding.diagnostic;
    const { span } = finding;
    if (code === "E_STRING") {
      const quote = text[span.start];
      if (quote === undefined) continue;
      offer(finding, "Close the string", [{ start: span.end, end: span.end, newText: quote }]);
    } else if (code === "E_DUPLICATE") {
      offer(finding, "Remove the duplicate declaration", [{ ...removeLine(text, span.start), newText: "" }]);
    } else if (code === "H_SIMILAR_ID" && finding.suggestion) {
      const { target, mentions, item } = finding.suggestion;
      offer(
        finding,
        `Replace with "${target.id}"`,
        mentions.map((mention) => ({ ...mention, newText: idText(target.id) })),
      );
      const first = mentions[0]!.start;
      const start = lineStart(text, first);
      const indent = /^[ \t]*/.exec(text.slice(start, first))![0];
      offer(finding, `Declare "${item.id}"`, [{ start, end: start, newText: `${indent}${idText(item.id)}\n` }]);
    }
  }
  return actions;
}
