import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { complete } from "../src/language/index";
import type { CompletionItem } from "../src/language/index";

const examples = join(import.meta.dir, "..", "examples");

function end(source: string): { line: number; character: number } {
  const lines = source.split("\n");
  return { line: lines.length - 1, character: lines[lines.length - 1]!.length };
}

function at(source: string): CompletionItem[] {
  return complete(source, end(source));
}

function labels(items: CompletionItem[], kind?: CompletionItem["kind"]): string[] {
  return items.filter((item) => kind === undefined || item.kind === kind).map((item) => item.label);
}

describe("header line", () => {
  test("an empty file offers the five kinds", () => {
    const items = at("");
    expect(labels(items)).toEqual(["er", "graph", "sequence", "state", "tree"]);
    expect(items.every((item) => item.kind === "keyword" && item.documentation !== undefined)).toBe(true);
  });

  test("a partial word filters the kinds", () => {
    expect(labels(at("gr"))).toEqual(["graph"]);
  });

  test("a comment line before the header does not hide it", () => {
    expect(labels(at("# note\n"))).toEqual(["er", "graph", "sequence", "state", "tree"]);
  });

  test("header attribute keys follow the kind", () => {
    expect(labels(at('graph "T" ['))).toContain("direction");
    expect(labels(at('tree "T" ['))).toContain("layout");
    expect(labels(at('sequence "T" ['))).not.toContain("direction");
    expect(labels(at('tree "T" [layout='))).toEqual(["mindmap", "tree"]);
    expect(labels(at('graph "T" [direction='))).toEqual(["down", "left", "right", "up"]);
  });
});

describe("references and operators", () => {
  test("after an operator the ids of the document are offered as references", () => {
    const items = at('graph "T"\na -> b\nc -> ');
    expect(items.map((item) => [item.label, item.kind])).toEqual([
      ["a", "reference"],
      ["b", "reference"],
      ["c", "reference"],
    ]);
  });

  test("the reference detail is the label", () => {
    const items = at('graph "T"\na "Alpha"\nb -> ');
    expect(items.find((item) => item.label === "a")?.detail).toBe("Alpha");
  });

  test("an id being typed is not proposed to itself", () => {
    expect(labels(at('graph "T"\na -> b\nab'), "reference")).toEqual([]);
    expect(labels(at('graph "T"\na -> b\na -> a'), "reference")).toEqual(["a"]);
  });

  test("after one id the operators of the kind are offered", () => {
    const items = at('graph "T"\na ');
    expect(labels(items, "operator")).toEqual(["--", "->", "to", "with"]);
    expect(labels(items)).not.toContain("->>");
  });

  test("a sequence offers its own operators and participants", () => {
    const head = 'sequence "T"\na -> b\n';
    expect(labels(at(`${head}x ->`))).toEqual(["a", "b", "x"]);
    const operators = labels(at(`${head}a `), "operator");
    expect(operators).toContain("->>");
    expect(operators).toContain("-->");
    expect(operators).toContain("async");
    expect(operators).toContain("reply");
  });

  test("a word operator is followed by references", () => {
    expect(labels(at('graph "T"\na\nb to '), "reference")).toEqual(["a", "b"]);
  });

  test("a partial operator filters the operators", () => {
    expect(labels(at('sequence "T"\na -'))).toEqual(["-->", "->", "->>"]);
  });

  test("a state machine offers states and its keywords", () => {
    const head = 'state "T"\nidle\nbusy -> idle\n';
    expect(labels(at(`${head}idle -> `))).toEqual(["final", "busy", "idle"]);
    expect(labels(at(`${head}idle `))).toEqual(["->", "to"]);
  });

  test("statement start offers group and the known ids in a graph", () => {
    const items = at('graph "T"\na -> b\n');
    expect(labels(items)).toEqual(["group", "a", "b"]);
    expect(labels(at('graph "T"\na -> b\ngr'))).toEqual(["group"]);
  });

  test("an id that needs quoting carries an insertText", () => {
    const items = at('graph "T"\n`a b` -> c\nx -> ');
    expect(items.find((item) => item.label === "a b")?.insertText).toBe("`a b`");
    expect(items.find((item) => item.label === "c")?.insertText).toBeUndefined();
  });

  test("a tree has no statement completions", () => {
    expect(at('tree "T"\nroot\n  ')).toEqual([]);
  });
});

describe("attribute brackets", () => {
  test("closed values after a key", () => {
    expect(labels(at('graph "T"\na [shape='))).toHaveLength(11);
    expect(labels(at('graph "T"\na [shape=di'))).toEqual(["diamond"]);
    expect(labels(at('state "T"\nx [pseudo='))).toEqual(["choice", "final", "fork", "history", "initial", "join"]);
    expect(at('state "T"\nx [pseudo=').every((item) => item.kind === "value")).toBe(true);
    expect(labels(at('graph "T"\na [source="s", confidence='))).toEqual(["confirmed", "inferred", "unknown"]);
    expect(labels(at('graph "T"\na [data.ok='))).toEqual(["false", "true"]);
  });

  test("key position offers the keys of the item, without the ones already set", () => {
    const keys = labels(at('graph "T"\na ['));
    expect(keys).toContain("shape");
    expect(keys).toContain("type");
    expect(keys).toContain("source");
    const items = at('graph "T"\na [');
    expect(items.every((item) => item.kind === "property")).toBe(true);
    expect(items.find((item) => item.label === "shape")?.insertText).toBe("shape=");
    expect(labels(at('graph "T"\na [shape=box, '))).not.toContain("shape");
    expect(labels(at('graph "T"\na [shape=box, ')).length).toBe(keys.length - 1);
    expect(labels(at('graph "T"\na [shape=box, ty'))).toEqual(["type"]);
  });

  test("keys set after the cursor in the same bracket are excluded", () => {
    const source = 'graph "T"\na [, shape=box]';
    const items = complete(source, { line: 1, character: 3 });
    expect(labels(items)).not.toContain("shape");
    expect(labels(items)).toContain("type");
  });

  test("the context follows the statement", () => {
    expect(labels(at('graph "T"\na -> b ['))).toEqual(expect.arrayContaining(["id", "type"]));
    expect(labels(at('graph "T"\na -> b ['))).not.toContain("shape");
    expect(labels(at('graph "T"\ngroup g "G" ['))).not.toContain("type");
    expect(labels(at('sequence "T"\na -> b ['))).not.toContain("type");
    expect(labels(at('state "T"\na -> b ['))).toEqual(expect.arrayContaining(["guard", "action"]));
    expect(labels(at('er "T"\na 1 -- 0..* b ['))).toEqual(expect.arrayContaining(["id", "type"]));
  });

  test("open values propose the values already used for the key", () => {
    const items = at('graph "T"\na [type="page"]\nc [type=page]\nd [type="page"]\nb [type=');
    expect(labels(items)).toEqual(['"page"', "page"]);
    expect(items.every((item) => item.kind === "value")).toBe(true);
  });

  test("ids and numbers are not suggested", () => {
    expect(at('graph "T"\na [id="x"]\nb [id=')).toEqual([]);
    expect(at('graph "T"\na [x=1, y=2]\nb [x=')).toEqual([]);
  });

  test("a finished bracket or a nested list offers nothing", () => {
    expect(at('graph "T"\na [shape=box] ')).toEqual([]);
    expect(at('state "T"\na [actions=["x", ')).toEqual([]);
  });

  test("tree lines offer the tree node keys", () => {
    const source = `${readFileSync(join(examples, "repo-tree.sg"), "utf8").replace(/\r\n/g, "\n")}  extra [`;
    const items = at(source);
    expect(labels(items)).toEqual(expect.arrayContaining(["id", "type", "shape", "description", "link"]));
    expect(labels(at(`${source}shape=`))).toContain("pill");
    expect(labels(at(`${source}type=`))).toEqual(['"file"', '"folder"']);
  });
});

describe("entity-relation diagrams", () => {
  const head = 'er "T"\ncustomer "Customer"\norder\n';

  test("cardinalities and operators after an entity", () => {
    const items = at(`${head}customer `);
    expect(labels(items, "operator")).toEqual(["--", "..", "via", "with"]);
    expect(labels(items, "value")).toEqual(["0..*", "0..1", "1", "1..*"]);
  });

  test("after an operator the entities and cardinalities are offered", () => {
    const items = at(`${head}customer 1 -- `);
    expect(labels(items, "reference")).toEqual(["customer", "order"]);
    expect(labels(items, "value")).toEqual(["0..*", "0..1", "1", "1..*"]);
    expect(labels(at(`${head}customer 1 -- 0..* `), "reference")).toEqual(["customer", "order"]);
  });

  test("the key flags follow a name and a type in an attribute block", () => {
    const block = `${head}order {\n  id uuid `;
    expect(labels(at(block))).toEqual(["fk", "null", "pk", "uk"]);
    expect(labels(at(`${block}pk `))).toEqual(["fk", "null", "uk"]);
    expect(labels(at(`${block}p`))).toEqual(["pk"]);
    expect(at(`${head}order {\n  id `)).toEqual([]);
    expect(at(`${head}order {\n  `)).toEqual([]);
    expect(labels(at(`${head}order {\n  id uuid [`))).toEqual(["note"]);
  });

  test("a closed block goes back to entity statements", () => {
    expect(labels(at(`${head}order {\n  id uuid pk\n}\n`))).toEqual(["customer", "order"]);
  });
});

describe("strings and comments", () => {
  test("inside a string nothing is offered", () => {
    expect(at('graph "T"\na "lab')).toEqual([]);
    expect(at('graph "T"\na [type="pa')).toEqual([]);
    expect(at('graph "T"\n`a ')).toEqual([]);
    expect(at('graph "T')).toEqual([]);
  });

  test("inside a comment nothing is offered", () => {
    expect(at('graph "T"\na # note')).toEqual([]);
    expect(at('graph "T"\n#')).toEqual([]);
    expect(at('graph "T"\na [shape=box] # x ->')).toEqual([]);
  });

  test("a hash inside a string does not start a comment", () => {
    expect(labels(at('graph "T"\na "#1" '), "operator")).toEqual([]);
    expect(labels(at('graph "T"\na [type="#x", '))).toContain("shape");
  });
});

describe("positions", () => {
  test("a CRLF and BOM source gives the same result as its LF equivalent", () => {
    const lf = 'graph "T"\nα -> b\nc [shape=box, ';
    const crlf = `﻿${lf.replace(/\n/g, "\r\n")}`;
    const position = { line: 2, character: 14 };
    const plain = complete(lf, position);
    expect(plain.length).toBeGreaterThan(0);
    expect(complete(crlf, position)).toEqual(plain);
    const second = { line: 1, character: 5 };
    expect(complete(crlf, second)).toEqual(complete(lf, second));
    expect(labels(complete(lf, second), "reference")).toEqual(["b", "c", "α"]);
  });

  test("the first line of a BOM source accounts for the BOM", () => {
    expect(labels(complete("﻿gr", { line: 0, character: 3 }))).toEqual(["graph"]);
  });

  test("a position past the end is clamped", () => {
    expect(labels(complete("gr", { line: 9, character: 99 }))).toEqual(["graph"]);
  });
});
