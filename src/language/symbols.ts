import type { Range as Span } from "../text/errors";
import type { ErStmt, GraphStmt, StateStmt, Str } from "../text/parser";
import { analyze, type Analysis } from "./analysis";
import type { Range } from "./format";
import type { DocumentSymbol, FoldingRange, SymbolKind } from "./types";

type Sym = {
  name: string;
  detail?: string;
  kind: SymbolKind;
  range: Span;
  selection: Span;
  children: Sym[];
};

function detailOf(id: string, label: Str | undefined): string | undefined {
  return label !== undefined && label.value !== id ? label.value : undefined;
}

function symbols(analysis: Analysis): Sym[] {
  const { ast } = analysis;

  const make = (
    kind: SymbolKind,
    id: { value: string; range: Span },
    label: Str | undefined,
    range: Span,
    children: Sym[],
    blocked: boolean,
  ): Sym => {
    const block = blocked ? analysis.block(range.end) : undefined;
    return {
      name: id.value,
      detail: detailOf(id.value, label),
      kind,
      range: block ? { start: range.start, end: Math.max(range.end, block.end) } : range,
      selection: id.range,
      children,
    };
  };

  const graph = (statements: GraphStmt[]): Sym[] =>
    statements.flatMap((statement) => {
      if (statement.t === "group") {
        return [make("namespace", statement.id, statement.label, statement.range, graph(statement.body), true)];
      }
      if (statement.t === "node") return [make("object", statement.id, statement.label, statement.range, [], false)];
      return [];
    });

  const state = (statements: StateStmt[]): Sym[] =>
    statements.flatMap((statement) =>
      statement.t === "state"
        ? [
            make(
              "event",
              statement.id,
              statement.label,
              statement.range,
              statement.body ? state(statement.body) : [],
              statement.body !== undefined,
            ),
          ]
        : [],
    );

  const er = (statements: ErStmt[]): Sym[] =>
    statements.flatMap((statement) => {
      if (statement.t !== "entity") return [];
      const fields: Sym[] = (statement.attributes ?? []).map((line) => ({
        name: line.name.value,
        detail: line.type?.value,
        kind: "field",
        range: line.range,
        selection: line.name.range,
        children: [],
      }));
      return [make("struct", statement.id, statement.label, statement.range, fields, statement.attributes !== undefined)];
    });

  switch (ast.kind) {
    case "graph":
      return graph(ast.body);
    case "sequence":
      return ast.body.flatMap((statement) =>
        statement.t === "participant"
          ? [make("class", statement.id, statement.label, statement.range, [], false)]
          : [],
      );
    case "state":
      return state(ast.body);
    case "er":
      return er(ast.body);
    case "tree": {
      const nodes: Sym[] = ast.body.map((line) => ({
        name: line.label.value,
        kind: "object",
        range: line.range,
        selection: line.label.range,
        children: [],
      }));
      const roots: Sym[] = [];
      for (let index = nodes.length - 1; index >= 0; index--) {
        const parent = ast.body[index]!.parent;
        if (parent < 0) continue;
        const target = nodes[parent]!;
        target.range = { start: target.range.start, end: Math.max(target.range.end, nodes[index]!.range.end) };
      }
      ast.body.forEach((line, index) => {
        if (line.parent < 0) roots.push(nodes[index]!);
        else nodes[line.parent]!.children.push(nodes[index]!);
      });
      return roots;
    }
  }
}

function end(items: Sym[], from: number): number {
  return items.reduce((value, item) => Math.max(value, item.range.end), from);
}

export function documentSymbols(source: string): DocumentSymbol[] {
  const analysis = analyze(source);
  const { ast, conv } = analysis;
  const range = (span: Span): Range => ({ start: conv.position(span.start), end: conv.position(span.end) });
  const convert = (item: Sym): DocumentSymbol => {
    const symbol: DocumentSymbol = {
      name: item.name,
      kind: item.kind,
      range: range(item.range),
      selectionRange: range(item.selection),
    };
    if (item.detail !== undefined) symbol.detail = item.detail;
    if (item.children.length > 0) symbol.children = item.children.map(convert);
    return symbol;
  };
  const children = symbols(analysis);
  if (ast.header.missing) return children.map(convert);
  const title = ast.header.title;
  return [
    convert({
      name: title?.value ?? ast.kind,
      detail: title ? ast.kind : undefined,
      kind: "module",
      range: { start: ast.header.range.start, end: end(children, ast.header.range.end) },
      selection: ast.header.kindRange,
      children,
    }),
  ];
}

export function foldingRanges(source: string): FoldingRange[] {
  const analysis = analyze(source);
  const { ast, conv } = analysis;
  const result: FoldingRange[] = [];

  const region = (from: number): void => {
    const block = analysis.block(from);
    if (!block) return;
    const startLine = conv.position(block.open).line;
    const endLine =
      block.close !== undefined ? conv.position(block.close).line - 1 : conv.position(block.end).line;
    if (endLine > startLine) result.push({ startLine, endLine, kind: "region" });
  };

  const graph = (statements: GraphStmt[]): void => {
    for (const statement of statements) {
      if (statement.t !== "group") continue;
      region(statement.range.end);
      graph(statement.body);
    }
  };
  const state = (statements: StateStmt[]): void => {
    for (const statement of statements) {
      if (statement.t !== "state" || statement.body === undefined) continue;
      region(statement.range.end);
      state(statement.body);
    }
  };

  switch (ast.kind) {
    case "graph":
      graph(ast.body);
      break;
    case "state":
      state(ast.body);
      break;
    case "er":
      for (const statement of ast.body) {
        if (statement.t === "entity" && statement.attributes !== undefined) region(statement.range.end);
      }
      break;
    case "tree": {
      const levels: number[] = [];
      for (const line of ast.body) levels.push(line.parent < 0 ? 0 : levels[line.parent]! + 1);
      ast.body.forEach((line, index) => {
        let last = index;
        while (last + 1 < ast.body.length && levels[last + 1]! > levels[index]!) last++;
        if (last === index) return;
        const startLine = conv.position(line.range.start).line;
        const endLine = conv.position(ast.body[last]!.range.end).line;
        if (endLine > startLine) result.push({ startLine, endLine, kind: "region" });
      });
      break;
    }
    case "sequence":
      break;
  }

  const lines = conv.text.split("\n");
  let run: number | undefined;
  const close = (endLine: number): void => {
    if (run !== undefined && endLine > run) result.push({ startLine: run, endLine, kind: "comment" });
    run = undefined;
  };
  lines.forEach((text, line) => {
    if (text.trimStart().startsWith("#")) run ??= line;
    else close(line - 1);
  });
  close(lines.length - 1);

  return result.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
}
