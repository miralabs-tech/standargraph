import { describe, expect, test } from "bun:test";
import { diagnostics } from "../src/language/index";

describe("diagnostics", () => {
  test("parse errors become LSP ranges in UTF-16", () => {
    const emoji = diagnostics('graph\n`😀 x` "oops\n');
    const unterminated = emoji.find((diagnostic) => diagnostic.code === "E_STRING");
    expect(unterminated).toBeDefined();
    expect(unterminated!.severity).toBe("error");
    expect(unterminated!.range.start).toEqual({ line: 1, character: 7 });
    expect(unterminated!.range.end).toEqual({ line: 1, character: 12 });

    const accented = diagnostics('graph\nÜnï "😀 label"\nweb "open\n');
    const error = accented.find((diagnostic) => diagnostic.code === "E_STRING")!;
    expect(error.range.start).toEqual({ line: 2, character: 4 });
    expect(error.range.end).toEqual({ line: 2, character: 9 });
  });

  test("a BOM shifts only the first line", () => {
    const found = diagnostics('﻿graph "x\n');
    const error = found.find((diagnostic) => diagnostic.code === "E_STRING")!;
    expect(error.range.start).toEqual({ line: 0, character: 7 });
  });

  test("a clean document has no diagnostic", () => {
    expect(diagnostics("graph\napi\nweb\napi -> web\n")).toEqual([]);
  });

  test("an id close to a declared id gets a hint", () => {
    const found = diagnostics("graph\napi\nweb\nweb -> apj\n");
    expect(found).toHaveLength(1);
    expect(found[0]).toEqual({
      range: { start: { line: 3, character: 7 }, end: { line: 3, character: 10 } },
      severity: "hint",
      code: "H_SIMILAR_ID",
      message: '"apj" is never declared; did you mean "api"?',
    });
  });

  test("short ids get no hint", () => {
    expect(diagnostics("graph\nui\ndb -> ui\n")).toEqual([]);
  });

  test("an id with no near declared id gets no hint", () => {
    expect(diagnostics("graph\napi\nweb\nweb -> database\n")).toEqual([]);
  });

  test("an id close to a more mentioned id gets a hint, in one direction only", () => {
    const found = diagnostics("graph\na -> serveur\nc -> serveur\nb -> servuer\n");
    expect(found).toHaveLength(1);
    expect(found[0]!.range.start).toEqual({ line: 3, character: 5 });
    expect(found[0]!.message).toBe('"servuer" is never declared; did you mean "serveur"?');
  });

  test("on equal mentions the first mentioned id is the target", () => {
    const found = diagnostics("graph\nb -> servuer\na -> serveur\n");
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toBe('"serveur" is never declared; did you mean "servuer"?');
  });

  test("a more mentioned typo still points at the declared id", () => {
    const found = diagnostics("graph\nserveur\nb -> servuer\nc -> servuer\n");
    expect(found.map((diagnostic) => diagnostic.message)).toEqual([
      '"servuer" is never declared; did you mean "serveur"?',
      '"servuer" is never declared; did you mean "serveur"?',
    ]);
  });

  test("ids of another kind are not targets", () => {
    expect(diagnostics("graph\ngroup serveur {\n  a\n}\nb -> servuer\n")).toEqual([]);
  });

  test("every mention gets a hint", () => {
    const found = diagnostics("graph\napi\nweb\nweb -> apj\napj -> web\nweb -> apj\n");
    expect(found.map((diagnostic) => diagnostic.range.start.line)).toEqual([3, 4, 5]);
    for (const diagnostic of found) expect(diagnostic.code).toBe("H_SIMILAR_ID");
  });
});
