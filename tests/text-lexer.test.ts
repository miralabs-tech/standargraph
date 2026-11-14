import { describe, expect, test } from "bun:test";
import { parse } from "../src/text";
import { tokenize } from "../src/text/lexer";

function lex(source: string): string[] {
  const { tokens, errors } = tokenize(source);
  expect(errors).toEqual([]);
  return tokens.map((token) =>
    token.kind === "NEWLINE" ? "NL" : `${token.kind}(${token.value})`,
  );
}

function lexErrors(source: string) {
  return tokenize(source).errors;
}

describe("glued operators", () => {
  test("spaced and glued arrows", () => {
    const expected = ["IDENT(settings-view)", "ARROW(->)", "IDENT(use-settings)"];
    expect(lex("settings-view -> use-settings")).toEqual(expected);
    expect(lex("settings-view->use-settings")).toEqual(expected);
  });

  test("every operator between two ids", () => {
    expect(lex("a->b")).toEqual(["IDENT(a)", "ARROW(->)", "IDENT(b)"]);
    expect(lex("a-->b")).toEqual(["IDENT(a)", "REPLY(-->)", "IDENT(b)"]);
    expect(lex("a->>b")).toEqual(["IDENT(a)", "ASYNC(->>)", "IDENT(b)"]);
    expect(lex("a--b")).toEqual(["IDENT(a)", "LINE(--)", "IDENT(b)"]);
    expect(lex("a-b--c")).toEqual(["IDENT(a-b)", "LINE(--)", "IDENT(c)"]);
  });

  test("dots, cardinalities and numbers", () => {
    expect(lex("x.y..z")).toEqual(["IDENT(x.y)", "DOTS(..)", "IDENT(z)"]);
    expect(lex("customer 1..0..* order")).toEqual([
      "IDENT(customer)",
      "NUMBER(1)",
      "DOTS(..)",
      "CARD(0..*)",
      "IDENT(order)",
    ]);
    expect(lex("1..*")).toEqual(["CARD(1..*)"]);
    expect(lex("0..1 0..*")).toEqual(["CARD(0..1)", "CARD(0..*)"]);
    expect(lex("x=-5")).toEqual(["IDENT(x)", "PUNCT(=)", "NUMBER(-5)"]);
    expect(lex("coverage=0.5")).toEqual(["IDENT(coverage)", "PUNCT(=)", "NUMBER(0.5)"]);
  });

  test("paths stay one identifier", () => {
    expect(lex("src/api.ts")).toEqual(["IDENT(src/api.ts)"]);
  });

  test("punctuation", () => {
    expect(lex("{ } [ ] ( ) = , *")).toEqual(
      ["{", "}", "[", "]", "(", ")", "=", ",", "*"].map((text) => `PUNCT(${text})`),
    );
  });
});

describe("strings", () => {
  test("unterminated string", () => {
    const errors = lexErrors('"unterminated');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: "E_STRING", line: 1, column: 1, message: "Unterminated string" });
  });

  test("raw line break inside a string", () => {
    const errors = lexErrors('"a\nb"');
    expect(errors.map((error) => error.code)).toEqual(["E_STRING", "E_STRING"]);
    expect(errors[0]?.line).toBe(1);
  });

  test("unknown escape", () => {
    const errors = lexErrors('"bad \\q"');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      code: "E_ESCAPE",
      column: 6,
      endColumn: 8,
      message: 'Unknown escape "\\q" in string',
    });
  });

  test("valid escapes", () => {
    expect(lex('"a\\nb"')).toEqual(["STRING(a\nb)"]);
    expect(lex('"\\u{e9}"')).toEqual(["STRING(\u00e9)"]);
    expect(lex('"\\u{1F600}"')).toEqual(["STRING(\u{1F600})"]);
    expect(lex('"q\\"t\\\\\\t"')).toEqual(['STRING(q"t\\\t)']);
  });

  test("invalid unicode escapes", () => {
    expect(lexErrors('"\\u{}"')[0]?.code).toBe("E_ESCAPE");
    expect(lexErrors('"\\u{110000}"')[0]?.code).toBe("E_ESCAPE");
    expect(lexErrors('"\\u{d800}"')[0]?.code).toBe("E_ESCAPE");
    expect(lexErrors('"\\u{1234567}"')[0]?.code).toBe("E_ESCAPE");
  });

  test("a hash inside a string is not a comment", () => {
    expect(lex('"label # not a comment"')).toEqual(["STRING(label # not a comment)"]);
  });

  test("a trailing comment is dropped", () => {
    expect(lex("a -> b # trailing comment")).toEqual(["IDENT(a)", "ARROW(->)", "IDENT(b)"]);
  });

  test("quoted ids", () => {
    expect(lex("`id with \\` tick`")).toEqual(["QUOTED_ID(id with ` tick)"]);
    expect(lex("`a\\\\b`")).toEqual(["QUOTED_ID(a\\b)"]);
    expect(lexErrors("`a\\nb`")[0]).toMatchObject({ code: "E_ESCAPE" });
    expect(lexErrors("`open")[0]).toMatchObject({ code: "E_STRING", message: "Unterminated quoted id" });
  });
});

describe("structure", () => {
  test("a list over three lines emits no newline inside the brackets", () => {
    expect(lex('a [\n  type="x",\n  shape=box\n]\nb')).toEqual([
      "IDENT(a)",
      "PUNCT([)",
      "IDENT(type)",
      "PUNCT(=)",
      'STRING(x)',
      "PUNCT(,)",
      "IDENT(shape)",
      "PUNCT(=)",
      "IDENT(box)",
      "PUNCT(])",
      "NL",
      "IDENT(b)",
    ]);
  });

  test("an unclosed bracket at the end of the file", () => {
    const errors = lexErrors('a [type="x"\nb');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: "E_EXPECTED", line: 1, column: 3 });
    expect(errors[0]?.message).toContain("line 1");
  });

  test("CRLF files lex like LF files", () => {
    expect(lex("a -> b\r\nc -> d\r\n")).toEqual(lex("a -> b\nc -> d\n"));
  });

  test("a leading BOM is ignored", () => {
    expect(lex("\uFEFFgraph")).toEqual(["IDENT(graph)"]);
    expect(tokenize("\uFEFFgraph").tokens[0]?.start).toBe(0);
  });

  test("unicode identifiers", () => {
    expect(lex("café -> naïve")).toEqual(["IDENT(café)", "ARROW(->)", "IDENT(naïve)"]);
  });

  test("a stray character is an E_TOKEN with its range", () => {
    const errors = lexErrors("a % b");
    expect(errors).toEqual([
      { line: 1, column: 3, endLine: 1, endColumn: 4, code: "E_TOKEN", message: 'Unexpected character "%"' },
    ]);
  });

  test("columns count UTF-16 units", () => {
    const errors = lexErrors("\u{1D49C} %");
    expect(errors[0]).toMatchObject({ column: 4 });
  });
});

describe("empty inputs", () => {
  test("an empty file and a comment-only file have no tokens", () => {
    expect(lex("")).toEqual([]);
    expect(lex("# only\n# comments\n")).toEqual(["NL", "NL"]);
  });
});
