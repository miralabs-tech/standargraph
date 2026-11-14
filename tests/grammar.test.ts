import { beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createOnigScanner, createOnigString, loadWASM } from "vscode-oniguruma";
import { type IGrammar, parseRawGrammar, Registry, type StateStack } from "vscode-textmate";
import { highlight, loadSource, print, type SemanticTokenType } from "../src/text";

const root = resolve(import.meta.dir, "..");
const GRAMMAR = join(root, "grammars", "standargraph.tmLanguage.json");
const EXAMPLES = join(root, "examples");

const CATEGORIES: readonly (readonly [string, SemanticTokenType])[] = [
  ["comment", "comment"],
  ["string", "string"],
  ["constant.character.escape", "string"],
  ["constant.numeric", "number"],
  ["constant.language.boolean", "keyword"],
  ["constant.other.enum", "enumMember"],
  ["keyword.operator", "operator"],
  ["keyword.control", "keyword"],
  ["keyword.other.kind", "keyword"],
  ["storage.type.group", "keyword"],
  ["storage.modifier", "keyword"],
  ["variable.parameter.attribute", "property"],
  ["variable.other", "variable"],
  ["entity.name.tag", "variable"],
  ["entity.name.namespace", "namespace"],
  ["entity.name.type", "type"],
];

const ALLOWED_EXCEPTIONS: readonly string[] = [];

function categoryOf(scopes: readonly string[]): SemanticTokenType | undefined {
  for (let index = scopes.length - 1; index >= 0; index--) {
    const scope = scopes[index]!;
    let found: { length: number; type: SemanticTokenType } | undefined;
    for (const [prefix, type] of CATEGORIES) {
      if ((scope === prefix || scope.startsWith(`${prefix}.`)) && (found === undefined || prefix.length > found.length)) {
        found = { length: prefix.length, type };
      }
    }
    if (found) return found.type;
  }
  return undefined;
}

let grammar: IGrammar;

beforeAll(async () => {
  const wasm = readFileSync(join(root, "node_modules", "vscode-oniguruma", "release", "onig.wasm"));
  await loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer);
  const registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    loadGrammar: async (scope) =>
      scope === "source.standargraph"
        ? parseRawGrammar(readFileSync(GRAMMAR, "utf8"), GRAMMAR)
        : null,
  });
  const loaded = await registry.loadGrammar("source.standargraph");
  if (loaded === null) throw new Error("The grammar did not load");
  grammar = loaded;
});

function scopesPerOffset(source: string): string[][] {
  const result: string[][] = new Array(source.length);
  let stack: StateStack | null = null;
  let offset = 0;
  for (const line of source.split("\n")) {
    const tokenized = grammar.tokenizeLine(line, stack);
    for (const token of tokenized.tokens) {
      for (let index = token.startIndex; index < Math.min(token.endIndex, line.length); index++) {
        result[offset + index] = token.scopes;
      }
    }
    stack = tokenized.ruleStack;
    offset += line.length + 1;
  }
  return result;
}

function disagreements(name: string, source: string): string[] {
  const scopes = scopesPerOffset(source);
  const problems: string[] = [];
  for (const token of highlight(source)) {
    for (let index = token.start; index < token.end; index++) {
      if (/\s/.test(source[index]!)) continue;
      const category = categoryOf(scopes[index] ?? []);
      if (category !== token.type) {
        const text = source.slice(token.start, token.end);
        const key = `${token.type}:${category ?? "none"}:${text}`;
        if (ALLOWED_EXCEPTIONS.includes(key)) break;
        problems.push(
          `${name} ${token.line}:${token.column} ${JSON.stringify(text)} highlight=${token.type} grammar=${category ?? "none"} scopes=${(scopes[index] ?? []).slice(1).join(" ")}`,
        );
        break;
      }
    }
  }
  return problems;
}

const names = readdirSync(EXAMPLES)
  .filter((file) => file.endsWith(".sg"))
  .map((file) => file.slice(0, -3))
  .sort();

describe("the TextMate grammar agrees with highlight()", () => {
  test("the grammar file is valid JSON for the standargraph scope", () => {
    const parsed = JSON.parse(readFileSync(GRAMMAR, "utf8"));
    expect(parsed.scopeName).toBe("source.standargraph");
    expect(parsed.fileTypes).toEqual(["sg"]);
  });

  for (const name of names) {
    const source = readFileSync(join(EXAMPLES, `${name}.sg`), "utf8");
    test(`${name}.sg as written`, () => {
      expect(disagreements(name, source)).toEqual([]);
    });
    for (const style of ["symbols", "words"] as const) {
      test(`${name}.sg printed with the ${style} style`, () => {
        const loaded = loadSource(source);
        if (!loaded.ok) throw new Error(`Example ${name} is invalid`);
        expect(disagreements(`${name}/${style}`, print(loaded.document, { style }))).toEqual([]);
      });
    }
  }

  test("language-configuration.json is valid and its word pattern matches an id as the lexer does", () => {
    const configuration = JSON.parse(readFileSync(join(root, "language-configuration.json"), "utf8"));
    expect(configuration.comments.lineComment).toBe("#");
    expect(configuration.brackets).toEqual([["{", "}"], ["[", "]"], ["(", ")"]]);
    const word = new RegExp(configuration.wordPattern, "u");
    for (const id of ["a", "settings-view", "src/api.ts", "café", "x.y"]) {
      expect(word.exec(id)?.[0]).toBe(id);
    }
    expect(word.exec("a->b")?.[0]).toBe("a");
    const increase = new RegExp(configuration.indentationRules.increaseIndentPattern);
    const decrease = new RegExp(configuration.indentationRules.decreaseIndentPattern);
    expect(increase.test("group g {")).toBe(true);
    expect(increase.test("order do # entity")).toBe(true);
    expect(increase.test("a -> b")).toBe(false);
    expect(decrease.test("}")).toBe(true);
    expect(decrease.test("  end")).toBe(true);
    expect(decrease.test("endpoint")).toBe(false);
  });

  test("word forms, do/end blocks, backtick ids and comments", () => {
    const sources = [
      ['graph "G" # c\n\ngroup `a b` "Box" do\n  x to y "link"\n  `to` with x\nend\n', "graph"],
      ["state\n\ninitial to a\na to final\nb \"B\" do\n  initial to c\nend\n", "state"],
      ['sequence\n\na async b "ping"\nb reply a\n', "sequence"],
      ['er\n\ncustomer 1 with 0..* order\norder do\n  id uuid pk\n  total decimal(10,2) null\nend\n', "er"],
    ] as const;
    for (const [source, kind] of sources) expect(disagreements(kind, source)).toEqual([]);
  });
});
