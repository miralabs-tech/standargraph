import { describe, expect, test } from "bun:test";
import { codeActions, diagnostics } from "../src/language/index";
import type { CodeAction, Range, TextEdit } from "../src/language/index";
import { parse } from "../src/text";

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

const whole = (line: number): Range => ({ start: { line, character: 0 }, end: { line, character: 1000 } });

function pick(actions: CodeAction[], title: string): CodeAction {
  const found = actions.find((action) => action.title === title);
  expect(found).toBeDefined();
  return found!;
}

function errorCodes(source: string): string[] {
  const result = parse(source);
  return result.ok ? [] : result.errors.map((error) => error.code);
}

describe("codeActions", () => {
  test("closes an unterminated string", () => {
    const source = 'graph\napi "Api\nweb\napi -> web\n';
    expect(errorCodes(source)).toContain("E_STRING");
    const action = pick(codeActions(source, whole(1)), "Close the string");
    expect(action.kind).toBe("quickfix");
    expect(action.diagnostic.code).toBe("E_STRING");
    const fixed = apply(source, action.edit.changes);
    expect(fixed).toBe('graph\napi "Api"\nweb\napi -> web\n');
    expect(errorCodes(fixed)).not.toContain("E_STRING");
  });

  test("removes a duplicate declaration", () => {
    const source = 'graph\napi "Api"\nweb\napi "Again"\napi -> web\n';
    expect(errorCodes(source)).toContain("E_DUPLICATE");
    const action = pick(codeActions(source, whole(3)), "Remove the duplicate declaration");
    const fixed = apply(source, action.edit.changes);
    expect(fixed).toBe('graph\napi "Api"\nweb\napi -> web\n');
    expect(parse(fixed).ok).toBe(true);
  });

  test("removes a duplicate on the last line without a trailing newline", () => {
    const source = "graph\napi\nweb\napi -> web\napi";
    const action = pick(codeActions(source, whole(4)), "Remove the duplicate declaration");
    const fixed = apply(source, action.edit.changes);
    expect(fixed).toBe("graph\napi\nweb\napi -> web");
    expect(parse(fixed).ok).toBe(true);
  });

  test("removes a duplicate in CRLF text", () => {
    const source = "graph\r\napi\r\nweb\r\napi\r\napi -> web\r\n";
    const action = pick(codeActions(source, whole(3)), "Remove the duplicate declaration");
    const fixed = apply(source, action.edit.changes);
    expect(fixed).toBe("graph\r\napi\r\nweb\r\napi -> web\r\n");
    expect(parse(fixed).ok).toBe(true);
  });

  test("replaces a mistyped id on every mention", () => {
    const source = "graph\napi\nweb\nweb -> apj\napj -> web\n";
    expect(diagnostics(source)).toHaveLength(2);
    const action = pick(codeActions(source, whole(3)), 'Replace with "api"');
    const fixed = apply(source, action.edit.changes);
    expect(fixed).toBe("graph\napi\nweb\nweb -> api\napi -> web\n");
    expect(diagnostics(fixed)).toEqual([]);
  });

  test("declares a mistyped id before its first mention with the same indentation", () => {
    const source = "graph\napi\nweb\ngroup g {\n  web -> apj\n}\n";
    const range: Range = { start: { line: 4, character: 9 }, end: { line: 4, character: 9 } };
    const action = pick(codeActions(source, range), 'Declare "apj"');
    const fixed = apply(source, action.edit.changes);
    expect(fixed).toBe("graph\napi\nweb\ngroup g {\n  apj\n  web -> apj\n}\n");
    expect(diagnostics(fixed)).toEqual([]);
    const result = parse(fixed);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = JSON.stringify(result.document);
      expect(ids).toContain('"apj"');
    }
  });

  test("replaces an id with a more mentioned id that is never declared", () => {
    const source = "graph\na -> serveur\nc -> serveur\nb -> servuer\n";
    const action = pick(codeActions(source, whole(3)), 'Replace with "serveur"');
    const fixed = apply(source, action.edit.changes);
    expect(fixed).toBe("graph\na -> serveur\nc -> serveur\nb -> serveur\n");
    expect(diagnostics(fixed)).toEqual([]);
    expect(codeActions(source, whole(1))).toEqual([]);
  });

  test("offers nothing outside every diagnostic", () => {
    const source = "graph\napi\nweb\nweb -> apj\n";
    expect(codeActions(source, whole(1))).toEqual([]);
    expect(codeActions("graph\napi\nweb\napi -> web\n", whole(1))).toEqual([]);
  });
});
