import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  definition,
  documentSymbols,
  foldingRanges,
  hover,
  prepareRename,
  references,
  rename,
} from "../src/language/index";
import type { DocumentSymbol, Range, TextEdit } from "../src/language/index";
import { parse } from "../src/text";

const root = join(import.meta.dir, "..", "examples");
const example = (name: string): string => readFileSync(join(root, name), "utf8");

function slice(source: string, range: Range): string {
  const lines = source.split("\r\n").flatMap((chunk) => chunk.split("\n"));
  expect(range.start.line).toBe(range.end.line);
  return lines[range.start.line]!.slice(range.start.character, range.end.character);
}

function apply(source: string, edits: TextEdit[]): string {
  const starts = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  const offset = (position: { line: number; character: number }): number =>
    starts[position.line]! + position.character;
  return [...edits]
    .sort((a, b) => offset(b.range.start) - offset(a.range.start))
    .reduce(
      (text, edit) => text.slice(0, offset(edit.range.start)) + edit.newText + text.slice(offset(edit.range.end)),
      source,
    );
}

function find(symbols: DocumentSymbol[], name: string): DocumentSymbol | undefined {
  for (const symbol of symbols) {
    if (symbol.name === name) return symbol;
    const inner = find(symbol.children ?? [], name);
    if (inner) return inner;
  }
  return undefined;
}

describe("positions", () => {
  const body = ['graph "Ünï"', 'b "😀 label"', "`😀 x` -> b", "b -> c"];

  test("BOM, CRLF and an astral character map to the right characters of the original text", () => {
    const source = `﻿${body.join("\r\n")}\r\n`;
    const use = { line: 2, character: 10 };
    const found = definition(source, use);
    expect(found).toBeDefined();
    expect(found!.range.start.line).toBe(1);
    expect(slice(source, found!.range)).toBe("b");

    const quoted = references(source, { line: 2, character: 1 });
    expect(quoted).toHaveLength(1);
    expect(slice(source, quoted[0]!.range)).toBe("`😀 x`");
    expect(quoted[0]!.range.end.character - quoted[0]!.range.start.character).toBe(6);

    const refs = references(source, use);
    expect(refs.map((location) => location.range.start.line)).toEqual([1, 2, 3]);
    for (const location of refs) expect(slice(source, location.range)).toBe("b");
  });

  test("the first line shifts by the BOM and nothing else does", () => {
    const withBom = `﻿${body.join("\n")}\n`;
    const without = `${body.join("\n")}\n`;
    const a = hover(withBom, { line: 0, character: 1 });
    const b = hover(without, { line: 0, character: 0 });
    expect(a!.contents).toBe(b!.contents);
    expect(a!.range.start).toEqual({ line: 0, character: 1 });
    expect(a!.range.end).toEqual({ line: 0, character: 6 });
    expect(b!.range.start).toEqual({ line: 0, character: 0 });
    expect(references(withBom, { line: 3, character: 0 })[0]!.range.start.line).toBe(1);
  });

  test("out-of-range positions are clamped", () => {
    const source = example("architecture.sg");
    expect(() => definition(source, { line: 9999, character: 9999 })).not.toThrow();
    expect(definition(source, { line: -3, character: -3 })).toBeUndefined();
  });
});

describe("graph", () => {
  const source = example("architecture.sg");
  const use = { line: 18, character: 20 };

  test("definition of a use points at the declaration", () => {
    const found = definition(source, use);
    expect(found!.range.start).toEqual({ line: 5, character: 2 });
    expect(slice(source, found!.range)).toBe("useSettings");
  });

  test("references list the declaration and every use", () => {
    const all = references(source, use);
    expect(all.map((location) => location.range.start.line)).toEqual([5, 18, 19]);
    const uses = references(source, use, false);
    expect(uses.map((location) => location.range.start.line)).toEqual([18, 19]);
    for (const location of all) expect(slice(source, location.range)).toBe("useSettings");
  });

  test("rename edits every occurrence and the result still parses with the same edges", () => {
    const edit = rename(source, use, "useConfig");
    expect(edit!.changes).toHaveLength(3);
    const renamed = apply(source, edit!.changes);
    const before = parse(source);
    const after = parse(renamed);
    expect(after.ok).toBe(true);
    if (before.ok && after.ok) {
      expect(after.document).toMatchObject({ kind: "graph" });
      const edges = (document: object): number => (document as { edges: unknown[] }).edges.length;
      expect(edges(after.document)).toBe(edges(before.document));
      expect(renamed).toContain('useConfig "useSettings"');
    }
    expect(prepareRename(source, use)).toEqual({
      range: { start: { line: 18, character: 19 }, end: { line: 18, character: 30 } },
      placeholder: "useSettings",
    });
  });

  test("rename is refused for an invalid name and for a collision", () => {
    expect(rename(source, use, "has space")).toBeUndefined();
    expect(rename(source, use, "")).toBeUndefined();
    expect(rename(source, use, "PatchSettings")).toBeUndefined();
  });

  test("a quoted id is replaced including its quotes", () => {
    const quoted = 'graph "Q"\n`my node` "My node"\n`my node` -> other\n';
    const edit = rename(quoted, { line: 2, character: 2 }, "renamed");
    expect(apply(quoted, edit!.changes)).toBe('graph "Q"\nrenamed "My node"\nrenamed -> other\n');
  });

  test("an id used only in chains is defined at its first occurrence", () => {
    const implicit = 'graph "I"\nx -> y\ny -> z\n';
    const found = definition(implicit, { line: 2, character: 0 });
    expect(found!.range.start).toEqual({ line: 1, character: 5 });
    expect(references(implicit, { line: 2, character: 0 }, false)).toHaveLength(1);
  });

  test("nothing is found away from an id", () => {
    expect(definition(source, { line: 1, character: 0 })).toBeUndefined();
    expect(references(source, { line: 1, character: 0 })).toEqual([]);
    expect(prepareRename(source, { line: 5, character: 20 })).toBeUndefined();
    expect(rename(source, { line: 1, character: 0 }, "x")).toBeUndefined();
  });
});

describe("sequence, state and er", () => {
  test("sequence participants", () => {
    const source = example("protocol.sg");
    const found = definition(source, { line: 7, character: 2 });
    expect(found!.range.start).toEqual({ line: 2, character: 0 });
    expect(references(source, { line: 7, character: 2 })).toHaveLength(6);
  });

  test("states: a nested state resolves from outside and star endpoints are ignored", () => {
    const source = example("order-state.sg");
    const found = definition(source, { line: 17, character: 2 });
    expect(found!.range.start).toEqual({ line: 9, character: 2 });
    expect(slice(source, found!.range)).toBe("shipped");
    expect(references(source, { line: 17, character: 2 })).toHaveLength(3);
    expect(definition(source, { line: 2, character: 0 })).toBeUndefined();
    expect(prepareRename(source, { line: 2, character: 0 })).toBeUndefined();
    expect(references(source, { line: 3, character: 1 })).toHaveLength(4);
    const check = references(source, { line: 18, character: 1 });
    expect(check).toHaveLength(4);
    for (const location of check) expect(slice(source, location.range)).toBe("check");
  });

  test("entities", () => {
    const source = example("shop-er.sg");
    const found = definition(source, { line: 23, character: 2 });
    expect(found!.range.start).toEqual({ line: 2, character: 0 });
    expect(references(source, { line: 23, character: 2 })).toHaveLength(2);
    const edit = rename(source, { line: 23, character: 2 }, "client");
    expect(edit!.changes).toHaveLength(2);
    expect(parse(apply(source, edit!.changes)).ok).toBe(true);
  });

  test("tree lines carry no ids", () => {
    const source = example("repo-tree.sg");
    expect(definition(source, { line: 3, character: 4 })).toBeUndefined();
    expect(prepareRename(source, { line: 3, character: 4 })).toBeUndefined();
  });
});

describe("documentSymbols", () => {
  test("architecture groups with their children", () => {
    const [root] = documentSymbols(example("architecture.sg"));
    expect(root!.name).toBe("Settings page flow");
    expect(root!.kind).toBe("module");
    const groups = root!.children!;
    expect(groups.map((group) => group.name)).toEqual(["frontend", "backend", "storage"]);
    expect(groups.every((group) => group.kind === "namespace")).toBe(true);
    expect(groups.map((group) => group.children!.length)).toEqual([3, 3, 2]);
    expect(groups[0]!.detail).toBe("Frontend");
    expect(groups[0]!.range.start.line).toBe(2);
    expect(groups[0]!.range.end.line).toBe(6);
  });

  test("entities have attribute children", () => {
    const [root] = documentSymbols(example("shop-er.sg"));
    const customer = root!.children!.find((symbol) => symbol.name === "customer")!;
    expect(customer.kind).toBe("struct");
    expect(customer.children!.map((field) => field.name)).toEqual(["id", "email", "name"]);
    expect(customer.children!.every((field) => field.kind === "field")).toBe(true);
    expect(customer.children![1]!.detail).toBe("varchar(255)");
  });

  test("tree lines nest by parent", () => {
    const [root] = documentSymbols(example("repo-tree.sg"));
    const top = root!.children!;
    expect(top.map((symbol) => symbol.name)).toEqual(["standargraph"]);
    expect(top[0]!.children!.map((symbol) => symbol.name)).toEqual(["src", "tests", "examples", "README.md"]);
    expect(find(top, "src")!.children!.map((symbol) => symbol.name)).toEqual(["format", "layout", "svg", "html"]);
    expect(find(top, "browser")).toBeDefined();
  });

  test("states nest and participants are listed", () => {
    const [state] = documentSymbols(example("order-state.sg"));
    const fulfilment = state!.children!.find((symbol) => symbol.name === "fulfilment")!;
    expect(fulfilment.children!.map((symbol) => symbol.name)).toEqual(["picking", "shipped"]);
    const [sequence] = documentSymbols(example("protocol.sg"));
    expect(sequence!.children!.map((symbol) => symbol.name)).toEqual(["browser", "app", "auth", "api"]);
  });
});

describe("foldingRanges", () => {
  test("groups fold", () => {
    const ranges = foldingRanges(example("architecture.sg"));
    expect(ranges.filter((range) => range.kind === "region")).toEqual([
      { startLine: 2, endLine: 5, kind: "region" },
      { startLine: 7, endLine: 10, kind: "region" },
      { startLine: 12, endLine: 14, kind: "region" },
    ]);
  });

  test("entity blocks, state bodies and tree subtrees fold", () => {
    expect(foldingRanges(example("shop-er.sg")).map((range) => range.startLine)).toEqual([2, 7, 13, 18]);
    expect(foldingRanges(example("order-state.sg"))).toEqual([{ startLine: 6, endLine: 10, kind: "region" }]);
    expect(foldingRanges(example("repo-tree.sg")).map((range) => range.startLine)).toEqual([2, 3, 8]);
  });

  test("consecutive full-line comments fold and a single one does not", () => {
    const source = ['graph "C"', "# one", "# two", "a -> b", "# alone", "b -> c"].join("\n");
    expect(foldingRanges(source)).toEqual([{ startLine: 1, endLine: 2, kind: "comment" }]);
  });

  test("a do ... end block folds", () => {
    const source = ['graph "D"', "group g do", "  a", "  b", "end"].join("\n");
    expect(foldingRanges(source)).toEqual([{ startLine: 1, endLine: 3, kind: "region" }]);
  });
});

describe("hover", () => {
  const source = example("architecture.sg");

  test("on an id", () => {
    const result = hover(source, { line: 18, character: 20 });
    expect(result!.contents).toContain("**node** `useSettings`");
    expect(result!.contents).toContain("Label: useSettings");
    expect(result!.contents).toContain("Type: `hook`");
    expect(result!.contents).toContain("1 incoming, 1 outgoing");
    expect(result!.range.start).toEqual({ line: 18, character: 19 });
  });

  test("on an attribute key", () => {
    const result = hover(source, { line: 5, character: 30 });
    expect(result!.contents).toContain("Free-form type");
    expect(result!.range.start).toEqual({ line: 5, character: 29 });
    expect(result!.range.end).toEqual({ line: 5, character: 33 });
  });

  test("on the header kind", () => {
    expect(hover(source, { line: 0, character: 2 })!.contents).toContain("Graph diagram");
  });

  test("on whitespace, an unknown key or a value", () => {
    expect(hover(source, { line: 1, character: 0 })).toBeUndefined();
    expect(hover(source, { line: 5, character: 36 })).toBeUndefined();
    expect(hover('graph "H"\na [bogus=1]\n', { line: 1, character: 4 })).toBeUndefined();
  });
});

describe("documents with syntax errors", () => {
  const source = ['graph "G"', "a -> b", "b -> ", "c -> d", "d"].join("\n");

  test("definition and references work for the valid parts and the incomplete edge", () => {
    expect(definition(source, { line: 2, character: 0 })!.range.start).toEqual({ line: 1, character: 5 });
    expect(references(source, { line: 1, character: 5 })).toHaveLength(2);
    expect(definition(source, { line: 3, character: 5 })!.range.start).toEqual({ line: 4, character: 0 });
    expect(rename(source, { line: 2, character: 0 }, "bb")!.changes).toHaveLength(2);
  });

  test("symbols still list the valid nodes", () => {
    const [root] = documentSymbols(source);
    expect(root!.children!.map((symbol) => symbol.name)).toEqual(["d"]);
  });

  test("a missing header gives a flat symbol list and no kind hover", () => {
    const headless = "a\nb -> c\n";
    expect(documentSymbols(headless).map((symbol) => symbol.name)).toEqual(["a"]);
    expect(hover(headless, { line: 0, character: 0 })!.contents).toContain("**node** `a`");
    expect(foldingRanges(headless)).toEqual([]);
  });

  test("an unclosed block still folds", () => {
    const open = ['graph "U"', "group g {", "  a", "  b"].join("\n");
    expect(foldingRanges(open)).toEqual([{ startLine: 1, endLine: 3, kind: "region" }]);
    expect(find(documentSymbols(open), "g")!.children!.map((symbol) => symbol.name)).toEqual(["a", "b"]);
  });
});

describe("package entry", () => {
  test("exposes exactly the language service functions", async () => {
    const entry = await import("../src/language/index");
    expect(Object.keys(entry).sort()).toEqual([
      "definition",
      "documentSymbols",
      "foldingRanges",
      "format",
      "formatText",
      "hover",
      "prepareRename",
      "references",
      "rename",
    ]);
  });
});
