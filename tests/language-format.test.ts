import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { format, formatText } from "../src/language/format";
import { parse } from "../src/text";
import { LineMap, Sink, type Range } from "../src/text/errors";
import { Lexer, normalize, type Token } from "../src/text/lexer";

const root = join(import.meta.dir, "..", "examples");
const examples = readdirSync(root)
  .filter((name) => name.endsWith(".sg"))
  .map((name) => ({ name, source: readFileSync(join(root, name), "utf8") }));

function lexAll(source: string, record: boolean): { tokens: Token[]; comments: Range[] } {
  const text = normalize(source);
  const comments: Range[] = [];
  const lexer = new Lexer(text, new Sink(new LineMap(text)), record ? comments : undefined);
  const tokens: Token[] = [];
  for (;;) {
    const token = lexer.next();
    tokens.push(token);
    if (token.kind === "EOF") break;
  }
  return { tokens, comments };
}

function commentTexts(source: string): string[] {
  const text = normalize(source);
  return lexAll(source, true)
    .comments.map((range) => text.slice(range.start, range.end).trim())
    .sort();
}

function documentOf(source: string) {
  const result = parse(source);
  expect(result.ok).toBe(true);
  return result.ok ? result.document : undefined;
}

describe("examples", () => {
  for (const { name, source } of examples) {
    test(`${name} is idempotent`, () => {
      const once = formatText(source);
      expect(once).toBeDefined();
      expect(formatText(once!)).toBe(once!);
    });

    test(`${name} keeps the same document`, () => {
      const formatted = formatText(source)!;
      expect(documentOf(formatted)).toEqual(documentOf(source)!);
    });

    test(`${name} keeps every comment`, () => {
      expect(commentTexts(formatText(source)!)).toEqual(commentTexts(source));
    });

    test(`${name} lexes identically with comments recorded`, () => {
      const plain = lexAll(source, false);
      const recorded = lexAll(source, true);
      expect(recorded.tokens).toEqual(plain.tokens);
      expect(plain.comments).toEqual([]);
    });
  }
});

describe("graph", () => {
  test("messy input formats to the exact expected text", () => {
    const messy = [
      'graph   "Messy"   [direction=down]',
      "",
      "",
      "",
      '      a   "Alpha"[ type = "x" ,description="y" ]   # first   ',
      "group g \"G\" {",
      "        # inside",
      '   b->c "edge"#glued',
      '      d "Dee" [',
      '  type="x",   # kept',
      '   description = "y"]',
      "  }   ",
      "",
      "",
    ].join("\r\n");
    const expected = [
      'graph "Messy" [direction=down]',
      "",
      'a "Alpha" [type="x", description="y"] # first',
      'group g "G" {',
      "  # inside",
      '  b -> c "edge" #glued',
      '  d "Dee" [',
      '  type="x",   # kept',
      '   description = "y"]',
      "}",
      "",
    ].join("\r\n");
    expect(formatText(messy)).toBe(expected);
    expect(documentOf(expected)).toEqual(documentOf(messy)!);
  });

  test("a multi-line attribute list without comment is joined", () => {
    const source = 'graph "T"\na [type="x",\n   description="y"]\n';
    expect(formatText(source)).toBe('graph "T"\na [type="x", description="y"]\n');
  });

  test("the indent option sets the width", () => {
    const source = 'graph "T"\ngroup g {\nb\n}\n';
    expect(formatText(source, { indent: 4 })).toBe('graph "T"\ngroup g {\n    b\n}\n');
  });

  test("do ... end blocks are indented", () => {
    const source = 'graph "T"\ngroup g do\na\nend\nb\n';
    expect(formatText(source)).toBe('graph "T"\ngroup g do\n  a\nend\nb\n');
  });

  test("a BOM is kept and LF stays LF", () => {
    const bom = String.fromCharCode(0xfeff);
    const formatted = formatText(`${bom}graph "T"\n\n\na\n`)!;
    expect(formatted).toBe(`${bom}graph "T"\n\na\n`);
  });
});

describe("tree", () => {
  test("nested lines keep their structure", () => {
    const source = [
      'tree "T" [layout=mindmap]',
      "# top",
      "",
      "Root [shape=pill]",
      "    Child one   [id=\"c1\" ,type=\"folder\"]",
      "        Grandchild # note",
      "      # odd comment",
      "        \"Quoted one\"",
      "    Child two",
      "",
      "",
    ].join("\n");
    const expected = [
      'tree "T" [layout=mindmap]',
      "# top",
      "",
      "Root [shape=pill]",
      '  Child one [id="c1", type="folder"]',
      "    Grandchild # note",
      "    # odd comment",
      '    "Quoted one"',
      "  Child two",
      "",
    ].join("\n");
    const formatted = formatText(source)!;
    expect(formatted).toBe(expected);
    expect(documentOf(formatted)).toEqual(documentOf(source)!);
    expect(formatText(formatted)).toBe(formatted);
  });

  test("bare labels with punctuation stay verbatim", () => {
    const source = "tree\nRoot\n  state, er,   tree (x)\n";
    expect(formatText(source)).toBe("tree\nRoot\n  state, er,   tree (x)\n");
  });
});

describe("refusals", () => {
  test("a syntax error gives no edit", () => {
    const source = 'graph "T"\na ->\n';
    expect(formatText(source)).toBeUndefined();
    expect(format(source)).toEqual([]);
  });

  test("an unterminated string gives no edit", () => {
    expect(format('graph "T\n')).toEqual([]);
  });

  test("a formatted source gives no edit", () => {
    expect(format('graph "T"\na\n')).toEqual([]);
  });
});

describe("edit range", () => {
  test("ends at the original end position with CRLF and non-ASCII text", () => {
    const source = 'graph "Été 🎉"\r\n\r\n\r\na  "Été 🎉"   [type="x"]  ';
    const edits = format(source);
    expect(edits).toHaveLength(1);
    expect(edits[0]!.range.start).toEqual({ line: 0, character: 0 });
    expect(edits[0]!.range.end).toEqual({ line: 3, character: 'a  "Été 🎉"   [type="x"]  '.length });
    expect(edits[0]!.range.end.character).toBe(26);
    expect(edits[0]!.newText).toBe('graph "Été 🎉"\r\n\r\na "Été 🎉" [type="x"]\r\n');
  });
});
