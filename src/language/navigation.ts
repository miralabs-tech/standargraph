import { IDENT } from "../text/lexer";
import type { Range as Span } from "../text/errors";
import { analyze, occurrenceAt, type Analysis, type Occurrence } from "./analysis";
import type { Position, Range } from "./format";
import type { Location, TextEdit, WorkspaceEdit } from "./types";

const BARE = new RegExp(`^(?:${IDENT.source})$`, "u");

function at(analysis: Analysis, position: Position): Occurrence | undefined {
  return occurrenceAt(analysis, analysis.conv.offset(position));
}

function toRange(analysis: Analysis, span: Span): Range {
  return { start: analysis.conv.position(span.start), end: analysis.conv.position(span.end) };
}

export function definition(source: string, position: Position): Location | undefined {
  const analysis = analyze(source);
  const found = at(analysis, position);
  if (!found) return undefined;
  return { range: toRange(analysis, found.item.definition) };
}

export function references(source: string, position: Position, includeDeclaration = true): Location[] {
  const analysis = analyze(source);
  const found = at(analysis, position);
  if (!found) return [];
  return analysis.occurrences
    .filter(
      (occurrence) =>
        occurrence.item === found.item &&
        (includeDeclaration || occurrence.range.start !== found.item.definition.start),
    )
    .map((occurrence) => ({ range: toRange(analysis, occurrence.range) }));
}

export function prepareRename(
  source: string,
  position: Position,
): { range: Range; placeholder: string } | undefined {
  const analysis = analyze(source);
  const found = at(analysis, position);
  if (!found) return undefined;
  return { range: toRange(analysis, found.range), placeholder: found.item.id };
}

export function rename(source: string, position: Position, newName: string): WorkspaceEdit | undefined {
  const analysis = analyze(source);
  const found = at(analysis, position);
  if (!found || !BARE.test(newName)) return undefined;
  if (analysis.items.some((item) => item !== found.item && item.id === newName)) return undefined;
  const changes: TextEdit[] = analysis.occurrences
    .filter((occurrence) => occurrence.item === found.item)
    .map((occurrence) => ({ range: toRange(analysis, occurrence.range), newText: newName }));
  return { changes };
}
