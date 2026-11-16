import { parse } from "../text";
import type { Range as Span } from "../text/errors";
import { analyze, type Item } from "./analysis";
import type { Diagnostic } from "./types";

export type Finding = {
  diagnostic: Diagnostic;
  span: Span;
  suggestion?: { item: Item; target: Item; mentions: Span[] };
};

function distance(a: string, b: string, max: number): number {
  const left = Array.from(a);
  const right = Array.from(b);
  if (Math.abs(left.length - right.length) > max) return max + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row++) {
    const current = [row];
    let low = row;
    for (let column = 1; column <= right.length; column++) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      const value = Math.min(previous[column]! + 1, current[column - 1]! + 1, previous[column - 1]! + cost);
      current.push(value);
      if (value < low) low = value;
    }
    if (low > max) return max + 1;
    previous = current;
  }
  return previous[right.length]!;
}

function closest(item: Item, candidates: Item[]): Item | undefined {
  const limit = Math.min(2, Math.floor(item.id.length / 3));
  if (limit < 1) return undefined;
  let best: Item | undefined;
  let bestDistance = limit + 1;
  for (const candidate of candidates) {
    if (candidate.kind !== item.kind || !candidate.declared) continue;
    const value = distance(item.id, candidate.id, limit);
    if (value < bestDistance) {
      best = candidate;
      bestDistance = value;
    }
  }
  return best;
}

export function collect(source: string): Finding[] {
  const analysis = analyze(source);
  const { conv } = analysis;
  const text = conv.text;
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10) starts.push(index + 1);
  }
  const at = (line: number, column: number): number =>
    Math.min((starts[line - 1] ?? text.length) + column - 1, text.length);
  const range = (span: Span) => ({ start: conv.position(span.start), end: conv.position(span.end) });

  const findings: Finding[] = [];
  const result = parse(source);
  if (!result.ok) {
    for (const error of result.errors) {
      const span = { start: at(error.line, error.column), end: at(error.endLine, error.endColumn) };
      findings.push({
        diagnostic: { range: range(span), severity: "error", code: error.code, message: error.message },
        span,
      });
    }
  }

  for (const item of analysis.items) {
    if (item.declared) continue;
    const target = closest(item, analysis.items);
    if (!target) continue;
    const mentions = analysis.occurrences.filter((occurrence) => occurrence.item === item).map((o) => o.range);
    for (const span of mentions) {
      findings.push({
        diagnostic: {
          range: range(span),
          severity: "hint",
          code: "H_SIMILAR_ID",
          message: `"${item.id}" is never declared; did you mean "${target.id}"?`,
        },
        span,
        suggestion: { item, target, mentions },
      });
    }
  }
  const errors = findings.filter((finding) => finding.diagnostic.severity === "error");
  const hints = findings
    .filter((finding) => finding.diagnostic.severity === "hint")
    .sort((a, b) => a.span.start - b.span.start);
  return [...errors, ...hints];
}

export function diagnostics(source: string): Diagnostic[] {
  return collect(source).map((finding) => finding.diagnostic);
}
