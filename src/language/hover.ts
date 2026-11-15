import type { AttrNode, Value } from "../text/parser";
import { analyze, occurrenceAt } from "./analysis";
import { attributeDoc, KIND_DOCS } from "./docs";
import type { Position } from "./format";
import type { Hover } from "./types";

function show(value: Value): string {
  if (value.type === "list") return `[${value.items.map(show).join(", ")}]`;
  return String(value.value);
}

function within(offset: number, range: { start: number; end: number }): boolean {
  return offset >= range.start && offset <= range.end;
}

export function hover(source: string, position: Position): Hover | undefined {
  const analysis = analyze(source);
  const { conv, ast } = analysis;
  const offset = conv.offset(position);
  const toRange = (span: { start: number; end: number }) => ({
    start: conv.position(span.start),
    end: conv.position(span.end),
  });

  for (const site of analysis.sites) {
    const attr = site.attrs.find((item: AttrNode) => within(offset, item.keyRange));
    if (!attr) continue;
    const doc = attributeDoc(site.context, attr.key, ast.kind);
    return doc === undefined ? undefined : { contents: doc, range: toRange(attr.keyRange) };
  }

  const found = occurrenceAt(analysis, offset);
  if (found) {
    const { item } = found;
    const type = item.attrs.find((attr) => attr.key === "type");
    const others = item.attrs.filter((attr) => attr !== type);
    const parts = [`**${item.kind}** \`${item.id}\``, `Label: ${item.label ?? item.id}`];
    if (type) parts.push(`Type: \`${show(type.value)}\``);
    if (others.length > 0) {
      parts.push(others.map((attr) => `- ${attr.key}: ${show(attr.value)}`).join("\n"));
    }
    parts.push(`Connections: ${item.incoming} incoming, ${item.outgoing} outgoing`);
    return { contents: parts.join("\n\n"), range: toRange(found.range) };
  }

  if (!ast.header.missing && within(offset, ast.header.kindRange)) {
    return { contents: KIND_DOCS[ast.kind], range: toRange(ast.header.kindRange) };
  }
  return undefined;
}
