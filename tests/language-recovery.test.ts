import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTree } from "../src/text/syntax";

function hasIncomplete(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasIncomplete);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return record.incomplete === true || Object.values(record).some(hasIncomplete);
  }
  return false;
}

describe("parseTree", () => {
  test("keeps valid statements and a broken edge as incomplete", () => {
    const source = ["graph", "a -> b", "b -> c", "a -> ", "c -> d", "d"].join("\n");
    const { ast, errors } = parseTree(source);
    expect(ast.kind).toBe("graph");
    if (ast.kind !== "graph") return;
    expect(ast.body).toHaveLength(5);
    const broken = ast.body.filter((stmt) => "incomplete" in stmt && stmt.incomplete);
    expect(broken).toHaveLength(1);
    const edge = broken[0]!;
    expect(edge.t).toBe("chain");
    if (edge.t === "chain") expect(edge.ids[0]!.value).toBe("a");
    expect(ast.body.filter((stmt) => !("incomplete" in stmt))).toHaveLength(4);
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  test("returns an Ast with an absent header when the header is missing", () => {
    const { ast, errors } = parseTree("a -> b\n");
    expect(ast.kind).toBe("graph");
    expect(ast.header.missing).toBe(true);
    expect(errors.some((error) => error.code === "E_HEADER")).toBe(true);
  });

  test("keeps a group and its valid inner statements around a broken line", () => {
    const source = ['graph "G"', 'group x "X" {', "  a -> b", "  b -> ", "  c", "}", "x2"].join("\n");
    const { ast, errors } = parseTree(source);
    if (ast.kind !== "graph") throw new Error("expected a graph");
    const group = ast.body[0]!;
    expect(group.t).toBe("group");
    if (group.t !== "group") return;
    expect(group.incomplete).toBeUndefined();
    expect(group.body.map((stmt) => stmt.t)).toEqual(["chain", "chain", "node"]);
    expect(group.body[1]!.incomplete).toBe(true);
    expect(ast.body).toHaveLength(2);
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  test("keeps the other declarations of a state file", () => {
    const source = ["state", "* -> idle", "idle -> ", "idle -> busy", "busy -> *"].join("\n");
    const { ast, errors } = parseTree(source);
    if (ast.kind !== "state") throw new Error("expected a state machine");
    expect(ast.body.map((stmt) => stmt.t)).toEqual(["transition", "state", "transition", "transition"]);
    expect(ast.body[1]!.incomplete).toBe(true);
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  test("keeps the other declarations of an er file", () => {
    const source = [
      "er",
      "user {",
      "  id int pk",
      "  name text [a = 1] junk",
      "  mail text",
      "}",
      "order",
      "user 1 -- 0..* order",
    ].join("\n");
    const { ast, errors } = parseTree(source);
    if (ast.kind !== "er") throw new Error("expected an er diagram");
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(ast.body.some((stmt) => stmt.t === "relation" && !stmt.incomplete)).toBe(true);
    expect(ast.body.some((stmt) => stmt.t === "entity" && stmt.id.value === "order")).toBe(true);
  });

  test("keeps the valid lines of a tree around a broken one", () => {
    const source = ["tree", "root", "  a", '  b [x = 1] junk', "  c"].join("\n");
    const { ast, errors } = parseTree(source);
    if (ast.kind !== "tree") throw new Error("expected a tree");
    expect(ast.body.map((line) => line.label.value)).toEqual(["root", "a", "b", "c"]);
    expect(ast.body[2]!.incomplete).toBe(true);
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  test("returns an Ast and caps the errors on 60 broken lines", () => {
    const source = ["graph", ...Array.from({ length: 60 }, () => "a -> ")].join("\n");
    const { ast, errors } = parseTree(source);
    expect(ast.kind).toBe("graph");
    expect(errors).toHaveLength(51);
    expect(errors[50]!.message).toBe("Too many errors");
    if (ast.kind === "graph") expect(ast.body.length).toBeGreaterThan(0);
  });

  test("reports no error and no incomplete node on every example", () => {
    const directory = join(import.meta.dir, "..", "examples");
    for (const name of readdirSync(directory).filter((file) => file.endsWith(".sg"))) {
      const { ast, errors } = parseTree(readFileSync(join(directory, name), "utf8"));
      expect(errors).toEqual([]);
      expect(hasIncomplete(ast)).toBe(false);
    }
  });

  test("ranges slice the statement text out of the normalized text", () => {
    const { ast, text } = parseTree('graph\r\nfoo -> bar "link"\r\nbar\r\n');
    if (ast.kind !== "graph") throw new Error("expected a graph");
    const range = ast.body[0]!.range;
    expect(text.slice(range.start, range.end)).toBe('foo -> bar "link"');
  });
});
