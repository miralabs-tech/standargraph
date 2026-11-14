import type { Document } from "../format/schema";
import { frontMatter, noteLosses, Warnings } from "./common";
import { erLines } from "./er";
import { graphLines, treeFlowLines } from "./graph";
import { mindmapLines } from "./mindmap";
import { sequenceLines } from "./sequence";
import { stateLines } from "./state";

export type MermaidResult = { text: string; warnings: string[] };

const MAX_EDGES = 500;
const MAX_TEXT_SIZE = 50000;

function body(doc: Document, warnings: Warnings): string[] {
  switch (doc.kind) {
    case "graph":
      return graphLines(doc, warnings);
    case "sequence":
      return sequenceLines(doc, warnings);
    case "state":
      return stateLines(doc, warnings);
    case "er":
      return erLines(doc, warnings);
    case "tree":
      return doc.layout === "mindmap"
        ? mindmapLines(doc, warnings)
        : treeFlowLines(doc, warnings);
  }
}

function edgeCount(doc: Document): number {
  switch (doc.kind) {
    case "graph":
      return doc.edges?.length ?? 0;
    case "sequence":
      return doc.messages.length;
    case "state":
      return doc.transitions?.length ?? 0;
    case "er":
      return doc.relations?.length ?? 0;
    case "tree":
      return Math.max(doc.nodes.length - 1, 0);
  }
}

export function toMermaid(doc: Document): MermaidResult {
  const warnings = new Warnings();
  noteLosses(warnings, doc);
  const lines = [...frontMatter(doc.title), ...body(doc, warnings)];
  const text = `${lines.join("\n")}\n`;
  if (edgeCount(doc) > MAX_EDGES) {
    warnings.add("More than 500 edges: Mermaid's default maxEdges may refuse to render");
  }
  if (text.length > MAX_TEXT_SIZE) {
    warnings.add("Mermaid's default maxTextSize (50000) is exceeded");
  }
  return { text, warnings: warnings.list };
}
