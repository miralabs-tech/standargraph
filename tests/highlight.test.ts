import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { highlight, SEMANTIC_TOKEN_MODIFIERS, SEMANTIC_TOKEN_TYPES } from "../src/text";

const EXAMPLES = resolve(import.meta.dir, "..", "examples");

function show(source: string): string[] {
  return highlight(source).map((token) => {
    const modifiers = token.modifiers === undefined ? "" : `+${token.modifiers.join("+")}`;
    return `${token.type}${modifiers} ${source.slice(token.start, token.end)}`;
  });
}

describe("highlight() legend", () => {
  test("types and modifiers follow the LSP legend order", () => {
    expect([...SEMANTIC_TOKEN_TYPES]).toEqual([
      "namespace",
      "type",
      "variable",
      "property",
      "enumMember",
      "keyword",
      "comment",
      "string",
      "number",
      "operator",
    ]);
    expect([...SEMANTIC_TOKEN_MODIFIERS]).toEqual(["declaration", "defaultLibrary"]);
  });
});

describe("highlight() on each kind", () => {
  test("a graph with symbols, a group, a label and attributes", () => {
    const source = [
      'graph "Flow" [direction=down]',
      "",
      'group backend "Backend" {',
      '  api "API" [type="service", coverage=0.5, data.ok=true, shape=pill]',
      "}",
      'api -> db "reads"',
      "a -- b",
      "",
    ].join("\n");
    expect(show(source)).toEqual([
      "keyword+defaultLibrary graph",
      'string "Flow"',
      "property direction",
      "operator =",
      "enumMember down",
      "keyword group",
      "namespace+declaration backend",
      'string "Backend"',
      "variable+declaration api",
      'string "API"',
      "property type",
      "operator =",
      'string "service"',
      "property coverage",
      "operator =",
      "number 0.5",
      "property data.ok",
      "operator =",
      "keyword true",
      "property shape",
      "operator =",
      "enumMember pill",
      "variable api",
      "operator ->",
      "variable db",
      'string "reads"',
      "variable a",
      "operator --",
      "variable b",
    ]);
  });

  test("the word forms are operators in operator position only", () => {
    expect(show("graph\n\na to b\nb with c\n")).toEqual([
      "keyword+defaultLibrary graph",
      "variable a",
      "operator to",
      "variable b",
      "variable b",
      "operator with",
      "variable c",
    ]);
    expect(show("sequence\n\na async b\nb reply a\n")).toEqual([
      "keyword+defaultLibrary sequence",
      "variable a",
      "operator async",
      "variable b",
      "variable b",
      "operator reply",
      "variable a",
    ]);
  });

  test("a backtick id named like a word is an id, and a bare word after an operator is an id", () => {
    expect(show("graph\n\n`to` -> x\na to to\nto\n")).toEqual([
      "keyword+defaultLibrary graph",
      "variable `to`",
      "operator ->",
      "variable x",
      "variable a",
      "operator to",
      "variable to",
      "variable+declaration to",
    ]);
  });

  test("a sequence diagram with participants and messages", () => {
    expect(show('sequence "S"\n\nbrowser "Browser" [type="client"]\nbrowser ->> app "go"\napp --> browser\n')).toEqual([
      "keyword+defaultLibrary sequence",
      'string "S"',
      "variable+declaration browser",
      'string "Browser"',
      "property type",
      "operator =",
      'string "client"',
      "variable browser",
      "operator ->>",
      "variable app",
      'string "go"',
      "variable app",
      "operator -->",
      "variable browser",
    ]);
  });

  test("a state machine with star, initial, final and a do/end composite", () => {
    const source = ["state", "", "* -> a", "initial to b", "c to final", "d -> *", 'e "E" do', "  f", "end", ""].join("\n");
    expect(show(source)).toEqual([
      "keyword+defaultLibrary state",
      "operator *",
      "operator ->",
      "variable a",
      "operator initial",
      "operator to",
      "variable b",
      "variable c",
      "operator to",
      "operator final",
      "variable d",
      "operator ->",
      "operator *",
      "variable+declaration e",
      'string "E"',
      "keyword do",
      "variable+declaration f",
      "keyword end",
    ]);
  });

  test("an ER diagram with flags, types, type arguments and cardinalities", () => {
    const source = [
      "er",
      "",
      "order {",
      "  id uuid pk fk",
      "  price decimal(10,2) null",
      '  note "text" [note="n"]',
      "}",
      "customer 1 -- 0..* order",
      "a 0..1 with 1..* b",
      "x 1 .. 1 y",
      "",
    ].join("\n");
    expect(show(source)).toEqual([
      "keyword+defaultLibrary er",
      "variable+declaration order",
      "variable+declaration id",
      "type uuid",
      "keyword pk",
      "keyword fk",
      "variable+declaration price",
      "type decimal",
      "number 10",
      "number 2",
      "keyword null",
      "variable+declaration note",
      'string "text"',
      "property note",
      "operator =",
      'string "n"',
      "variable customer",
      "number 1",
      "operator --",
      "number 0..*",
      "variable order",
      "variable a",
      "number 0..1",
      "operator with",
      "number 1..*",
      "variable b",
      "variable x",
      "number 1",
      "operator ..",
      "number 1",
      "variable y",
    ]);
  });

  test("a tree with bare and quoted labels, attributes and a comment", () => {
    const source = ['tree "T" [layout=mindmap]', "", "root [shape=pill] # top", "  child", '  "Quoted [x]" [id="q"]', "    leaf, bare", ""].join("\n");
    expect(show(source)).toEqual([
      "keyword+defaultLibrary tree",
      'string "T"',
      "property layout",
      "operator =",
      "enumMember mindmap",
      "string root",
      "property shape",
      "operator =",
      "enumMember pill",
      "comment # top",
      "string child",
      'string "Quoted [x]"',
      "property id",
      "operator =",
      'string "q"',
      "string leaf, bare",
    ]);
  });
});

describe("highlight() lexical forms", () => {
  test("comments, also before the header and after a statement", () => {
    expect(show("# first\n\ngraph # kind\n\na -> b # tail\n")).toEqual([
      "comment # first",
      "keyword+defaultLibrary graph",
      "comment # kind",
      "variable a",
      "operator ->",
      "variable b",
      "comment # tail",
    ]);
  });

  test("strings keep a # and their escapes in one token", () => {
    expect(show('graph\n\na "x # not \\"a\\" comment \\u{e9}\\n"\n')).toEqual([
      "keyword+defaultLibrary graph",
      "variable+declaration a",
      'string "x # not \\"a\\" comment \\u{e9}\\n"',
    ]);
  });

  test("attribute values: enums, bare strings, booleans, lists, negative numbers and quoted keys", () => {
    expect(show('graph\n\na [confidence=inferred, type=page, data.x=false, y=-5, actions=["a", "b"], `data.k v`=1]\n')).toEqual([
      "keyword+defaultLibrary graph",
      "variable+declaration a",
      "property confidence",
      "operator =",
      "enumMember inferred",
      "property type",
      "operator =",
      "string page",
      "property data.x",
      "operator =",
      "keyword false",
      "property y",
      "operator =",
      "number -5",
      "property actions",
      "operator =",
      'string "a"',
      'string "b"',
      "property `data.k v`",
      "operator =",
      "number 1",
    ]);
  });

  test("an attribute list over several lines", () => {
    expect(show('graph\n\na [\n  x=1, # c\n  y="z"\n]\n')).toEqual([
      "keyword+defaultLibrary graph",
      "variable+declaration a",
      "property x",
      "operator =",
      "number 1",
      "comment # c",
      "property y",
      "operator =",
      'string "z"',
    ]);
  });
});

describe("highlight() error tolerance", () => {
  const broken = [
    "",
    "   \n\n",
    "%%%",
    "{ \"json\": true }",
    "not a header\ngraph\na -> b",
    'graph\n\na "unterminated',
    'graph\n\na "bad \\q escape" -> b',
    "graph\n\na [x=1",
    "graph\n\na -> -> b ] } ) ((",
    "graph\n\n`open",
    "state\n\n* -> \ninitial\n",
    "er\n\nx {\n  ??? !!!\n",
    "tree\n\n\t\n  \"x\n[\n",
    "﻿graph\r\n\r\na -> b\r\n",
    "\u0000\u0001\ud800 graph",
  ];

  test("never throws and returns sorted, non-overlapping tokens inside the source", () => {
    for (const source of broken) {
      const tokens = highlight(source);
      let end = 0;
      for (const token of tokens) {
        expect(token.start).toBeGreaterThanOrEqual(end);
        expect(token.end).toBeGreaterThan(token.start);
        expect(token.end).toBeLessThanOrEqual(source.length);
        end = token.end;
      }
    }
  });

  test("the text after an invalid header is plain", () => {
    expect(highlight("")).toEqual([]);
    expect(show("%%%\ngraph\na -> b")).toEqual([]);
    expect(show('{ "kind": "graph" }')).toEqual([]);
    expect(show("# only\nnot a header -> x")).toEqual(["comment # only"]);
  });

  test("an unterminated string is a string up to the end of the line", () => {
    expect(show('graph\n\na "oops\nb')).toEqual([
      "keyword+defaultLibrary graph",
      "variable+declaration a",
      'string "oops',
      "variable+declaration b",
    ]);
  });

  test("the valid prefix is colored when a later line is broken", () => {
    expect(show("graph\n\na -> b\n@@@\nc -> d\n")).toEqual([
      "keyword+defaultLibrary graph",
      "variable a",
      "operator ->",
      "variable b",
      "variable c",
      "operator ->",
      "variable d",
    ]);
  });
});

describe("highlight() positions", () => {
  test("line and column are 1-based and match the offsets", () => {
    const source = 'graph "T"\n\n  a -> b\n';
    const lines = source.split("\n");
    for (const token of highlight(source)) {
      expect(lines[token.line - 1]!.slice(token.column - 1, token.column - 1 + (token.end - token.start))).toBe(
        source.slice(token.start, token.end),
      );
    }
  });

  test("offsets point into the original source with a BOM and CRLF line endings", () => {
    const source = '﻿graph "T"\r\n\r\na -> b "x"\r\n# end\r\n';
    const tokens = highlight(source);
    expect(tokens.map((token) => source.slice(token.start, token.end))).toEqual(["graph", '"T"', "a", "->", "b", '"x"', "# end"]);
    expect(tokens.map((token) => [token.line, token.column])).toEqual([
      [1, 1],
      [1, 7],
      [3, 1],
      [3, 3],
      [3, 6],
      [3, 8],
      [4, 1],
    ]);
  });

  test("a non-ASCII id keeps its UTF-16 offsets", () => {
    const source = "graph\n\ncafé -> naïve\n";
    expect(highlight(source).map((token) => source.slice(token.start, token.end))).toEqual(["graph", "café", "->", "naïve"]);
  });
});

describe("highlight() on the examples", () => {
  const PLAIN = new Set(["{", "}", "[", "]", "(", ")", ","]);
  const names = readdirSync(EXAMPLES)
    .filter((file) => file.endsWith(".sg"))
    .sort();

  for (const name of names) {
    test(`${name} is sorted, without overlap, and every character is covered but punctuation`, () => {
      const source = readFileSync(join(EXAMPLES, name), "utf8");
      const tokens = highlight(source);
      expect(tokens.length).toBeGreaterThan(0);
      const covered = new Uint8Array(source.length);
      let end = 0;
      for (const token of tokens) {
        expect(token.start).toBeGreaterThanOrEqual(end);
        expect(token.end).toBeGreaterThan(token.start);
        covered.fill(1, token.start, token.end);
        end = token.end;
      }
      const missing: string[] = [];
      for (let index = 0; index < source.length; index++) {
        const char = source[index]!;
        if (covered[index] === 1 || /\s/.test(char) || PLAIN.has(char)) continue;
        missing.push(`${index}:${char}`);
      }
      expect(missing).toEqual([]);
    });
  }
});
