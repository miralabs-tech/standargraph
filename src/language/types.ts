import type { Position, Range, TextEdit } from "./format";

export type { Position, Range, TextEdit };

export type SymbolKind = "class" | "object" | "field" | "event" | "namespace" | "struct" | "module";

export type DocumentSymbol = {
  name: string;
  detail?: string;
  kind: SymbolKind;
  range: Range;
  selectionRange: Range;
  children?: DocumentSymbol[];
};

export type FoldingRange = {
  startLine: number;
  endLine: number;
  kind?: "comment" | "region";
};

export type Location = { range: Range };

export type WorkspaceEdit = { changes: TextEdit[] };

export type Hover = { contents: string; range: Range };

export type CompletionItemKind = "keyword" | "operator" | "property" | "value" | "reference";

export type CompletionItem = {
  label: string;
  kind: CompletionItemKind;
  detail?: string;
  documentation?: string;
  insertText?: string;
};

export type Diagnostic = {
  range: Range;
  severity: "error" | "hint";
  code: string;
  message: string;
};
