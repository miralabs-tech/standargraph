import { LineMap, Sink } from "../text/errors";
import { IDENT, Lexer, type Token } from "../text/lexer";
import {
  CARDINALITIES,
  FLAGS,
  KINDS,
  OPERATOR_RULES,
  OPERATOR_WORDS,
  operatorOf,
  type Kind,
} from "../text/parser";
import { analyze, type Analysis, type ItemKind } from "./analysis";
import {
  attributeDoc,
  attributeKeys,
  attributeValues,
  CARDINALITY_DOCS,
  DATA_NAMESPACE_DOC,
  FLAG_DOCS,
  KEYWORD_DOCS,
  KIND_DOCS,
  OPERATOR_DOCS,
  type AttrContext,
} from "./docs";
import type { Position } from "./format";
import type { CompletionItem, CompletionItemKind } from "./types";

const ORDER: readonly CompletionItemKind[] = ["keyword", "operator", "property", "value", "reference"];
const NAMESPACE: Readonly<Record<Kind, ItemKind | undefined>> = {
  graph: "node",
  sequence: "participant",
  state: "state",
  er: "entity",
  tree: undefined,
};
const UNSUGGESTED = new Set(["id", "x", "y", "coverage", "actions"]);

type Span = { start: number; end: number };
type Bracket = { state: "key" | "value" | "closed"; key: string; openStart: number };

function lineState(text: string): "code" | "string" | "comment" {
  let quote = "";
  let comment = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (comment) {
      if (char === "\n") comment = false;
    } else if (quote !== "") {
      if (char === "\\") index++;
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "`") {
      quote = char;
    } else if (char === "#") {
      comment = true;
    }
  }
  if (comment) return "comment";
  return quote === "" ? "code" : "string";
}

function bracketScan(text: string, offset: number): { open: number; end: number } | undefined {
  const stack: { char: string; at: number }[] = [];
  let quote = "";
  let comment = false;
  let index = 0;
  const step = (limit: number, stopWhenFlat: boolean): boolean => {
    for (; index < limit; index++) {
      const char = text[index]!;
      if (comment) {
        if (char === "\n") comment = false;
      } else if (quote !== "") {
        if (char === "\\") index++;
        else if (char === quote) quote = "";
      } else if (char === '"' || char === "`") {
        quote = char;
      } else if (char === "#") {
        comment = true;
      } else if (char === "[" || char === "(") {
        stack.push({ char, at: index });
      } else if (char === "]" || char === ")") {
        if (stack[stack.length - 1]?.char === (char === "]" ? "[" : "(")) stack.pop();
        if (stopWhenFlat && !stack.some((entry) => entry.char === "[")) return true;
      }
    }
    return false;
  };
  step(offset, false);
  const outer = stack.find((entry) => entry.char === "[");
  if (outer === undefined) return undefined;
  const closed = step(text.length, true);
  const found = text.indexOf("\n", closed ? index : offset);
  return { open: outer.at, end: found < 0 ? text.length : found };
}

function lexLine(text: string): Token[] {
  const sink = new Sink(new LineMap(text));
  sink.muted = 1;
  const lexer = new Lexer(text, sink);
  const tokens: Token[] = [];
  for (;;) {
    const token = lexer.next();
    if (token.kind === "EOF") break;
    if (token.kind === "NEWLINE") continue;
    if (token.kind === "ERROR" && token.text === "[") continue;
    tokens.push(token);
  }
  return tokens;
}

function isPunct(token: Token | undefined, text: string): boolean {
  return token !== undefined && token.kind === "PUNCT" && token.text === text;
}

function isIdLike(token: Token | undefined): boolean {
  return token !== undefined && (token.kind === "IDENT" || token.kind === "QUOTED_ID");
}

function isCard(token: Token | undefined): boolean {
  return token !== undefined && (token.kind === "CARD" || token.kind === "NUMBER");
}

function operatorAt(tokens: Token[], index: number): boolean {
  const token = tokens[index];
  if (token === undefined || operatorOf(token) === undefined) return false;
  return token.kind !== "IDENT" || index > 0;
}

function quoteId(id: string): string {
  IDENT.lastIndex = 0;
  const match = IDENT.exec(id);
  if (match && match[0].length === id.length) return id;
  return `\`${id.replace(/\\/g, "\\\\").replace(/`/g, "\\`")}\``;
}

function quoteString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t")}"`;
}

function blockDepth(lines: string[]): number {
  let depth = 0;
  for (const line of lines) {
    const tokens = lexLine(line);
    const first = tokens[0];
    const last = tokens[tokens.length - 1];
    if (first === undefined || last === undefined) continue;
    if (isPunct(first, "}") || (tokens.length === 1 && first.kind === "IDENT" && first.text === "end")) {
      depth = Math.max(0, depth - 1);
    } else if (isPunct(last, "{") || (last.kind === "IDENT" && last.text === "do" && tokens.length > 1)) {
      depth++;
    }
  }
  return depth;
}

function operatorItems(kind: Kind): CompletionItem[] {
  const items: CompletionItem[] = [];
  for (const symbol of OPERATOR_RULES[kind].allowed) {
    const documentation = OPERATOR_DOCS[symbol];
    items.push({ label: symbol, kind: "operator", documentation });
    for (const [word, target] of OPERATOR_WORDS) {
      if (target === symbol) items.push({ label: word, kind: "operator", documentation });
    }
  }
  return items;
}

function cardinalityItems(): CompletionItem[] {
  return [...CARDINALITIES.keys()].map((label) => ({
    label,
    kind: "value" as const,
    documentation: CARDINALITY_DOCS[label],
  }));
}

function keyword(label: string): CompletionItem {
  return { label, kind: "keyword", documentation: KEYWORD_DOCS[label] };
}

function references(analysis: Analysis, kind: Kind, typing: Span): CompletionItem[] {
  const namespace = NAMESPACE[kind];
  if (namespace === undefined) return [];
  const items: CompletionItem[] = [];
  for (const item of analysis.items) {
    if (item.kind !== namespace) continue;
    const elsewhere = analysis.occurrences.some(
      (occurrence) =>
        occurrence.item === item && (occurrence.range.end <= typing.start || occurrence.range.start >= typing.end),
    );
    if (!elsewhere) continue;
    const entry: CompletionItem = { label: item.id, kind: "reference" };
    if (item.label !== undefined) entry.detail = item.label;
    const text = quoteId(item.id);
    if (text !== item.id) entry.insertText = text;
    items.push(entry);
  }
  return items;
}

function usedDataKeys(analysis: Analysis): string[] {
  const keys = new Set<string>();
  for (const site of analysis.sites) {
    if (site.context === "attribute") continue;
    for (const attr of site.attrs) {
      if (attr.key.startsWith("data.") && attr.key.length > 5) keys.add(attr.key);
    }
  }
  return [...keys];
}

function existingValues(analysis: Analysis, key: string): CompletionItem[] {
  const items: CompletionItem[] = [];
  for (const site of analysis.sites) {
    for (const attr of site.attrs) {
      if (attr.key !== key) continue;
      const { value } = attr;
      if (value.type === "string") items.push({ label: quoteString(value.value), kind: "value" });
      else if (value.type === "ident" || value.type === "number") {
        items.push({ label: String(value.value), kind: "value" });
      }
    }
  }
  return items;
}

function attrContext(kind: Kind, head: Token[], depth: number): AttrContext {
  const hasOperator = head.some((_, index) => operatorAt(head, index));
  switch (kind) {
    case "graph":
      if (head[0]?.kind === "IDENT" && head[0].text === "group") return "group";
      return hasOperator ? "edge" : "node";
    case "sequence":
      return hasOperator ? "message" : "participant";
    case "state":
      return hasOperator ? "transition" : "state";
    case "er":
      if (depth > 0) return "attribute";
      return hasOperator || head.some(isCard) ? "relation" : "entity";
    case "tree":
      return "treeNode";
  }
}

function openBracket(tokens: Token[]): number | undefined {
  const stack: number[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (isPunct(token, "[")) stack.push(index);
    else if (isPunct(token, "]")) stack.pop();
  }
  if (stack.length === 0) return undefined;
  return stack.length === 1 ? stack[0] : -1;
}

function bracketState(tokens: Token[], from: number): Bracket {
  let state: "key" | "eq" | "value" | "after" | "bad" = "key";
  let key = "";
  for (let index = from + 1; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (state === "key") {
      if (isIdLike(token)) {
        key = token.value;
        state = "eq";
      } else if (!isPunct(token, ",")) {
        state = "bad";
      }
    } else if (state === "eq") {
      state = isPunct(token, "=") ? "value" : "bad";
    } else if (state === "value") {
      state = token.kind === "STRING" || token.kind === "NUMBER" || token.kind === "IDENT" ? "after" : "bad";
    } else if (state === "after") {
      state = isPunct(token, ",") ? "key" : "bad";
    }
  }
  const openStart = tokens[from]!.start;
  if (state === "key" || state === "value") return { state, key, openStart };
  return { state: "closed", key, openStart };
}

function presentKeys(line: string, openStart: number, typingStart: number): Set<string> {
  const tokens = lexLine(line);
  const keys = new Set<string>();
  let depth = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token.start < openStart) continue;
    if (isPunct(token, "[")) {
      depth++;
    } else if (isPunct(token, "]")) {
      depth--;
      if (depth <= 0) break;
    } else if (depth === 1 && isIdLike(token) && token.start !== typingStart && isPunct(tokens[index + 1], "=")) {
      keys.add(token.value);
    }
  }
  return keys;
}

function sorted(items: CompletionItem[], word: string): CompletionItem[] {
  const seen = new Set<string>();
  return items
    .filter((item) => {
      if (!item.label.startsWith(word)) return false;
      const id = `${item.kind}:${item.label}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort((a, b) => {
      const byKind = ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind);
      if (byKind !== 0) return byKind;
      return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
    });
}

function bracketItems(
  analysis: Analysis,
  bracket: Bracket,
  context: AttrContext,
  kind: Kind,
  line: string,
  typingStart: number,
  word: string,
): CompletionItem[] {
  if (bracket.state === "closed") return [];
  if (bracket.state === "key") {
    const present = presentKeys(line, bracket.openStart, typingStart);
    const items: CompletionItem[] = attributeKeys(context, kind)
      .filter((key) => !present.has(key))
      .map((key) => ({
        label: key,
        kind: "property" as const,
        documentation: attributeDoc(context, key, kind),
        insertText: `${key}=`,
      }));
    if (context !== "attribute") {
      if (word.startsWith("data.")) {
        for (const key of usedDataKeys(analysis)) {
          if (present.has(key)) continue;
          items.push({
            label: key,
            kind: "property",
            documentation: attributeDoc(context, key, kind),
            insertText: `${key}=`,
          });
        }
      } else {
        items.push({ label: "data.", kind: "property", documentation: DATA_NAMESPACE_DOC, insertText: "data." });
      }
    }
    return items;
  }
  const closed = attributeValues(context, bracket.key, kind);
  if (closed !== undefined) {
    const items: CompletionItem[] = closed.map((label) => ({ label, kind: "value" as const }));
    if (bracket.key.startsWith("data.")) items.push(...existingValues(analysis, bracket.key));
    return items;
  }
  if (UNSUGGESTED.has(bracket.key) || context === "attribute") return [];
  return existingValues(analysis, bracket.key);
}

function statementItems(
  analysis: Analysis,
  kind: Kind,
  before: Token[],
  depth: number,
  typing: Span,
): CompletionItem[] {
  if (kind === "tree") return [];
  const count = before.length;
  const last = before[count - 1];

  if (kind === "er" && depth > 0) {
    if (count < 2) return [];
    if (isPunct(last, "]") && !isPunct(before[count - 2], "[")) return [];
    const present = new Set(before.slice(1).map((token) => token.text));
    return [...FLAGS]
      .filter((flag) => !present.has(flag))
      .map((flag) => ({ label: flag, kind: "keyword" as const, documentation: FLAG_DOCS[flag] }));
  }

  if (count === 0) {
    const items = references(analysis, kind, typing);
    if (kind === "graph") items.push(keyword("group"));
    if (kind === "state") items.push(keyword("initial"));
    return items;
  }

  const beforeLast = before[count - 2];
  if (operatorAt(before, count - 1) && (isIdLike(beforeLast) || isCard(beforeLast) || isPunct(beforeLast, "*"))) {
    const items = references(analysis, kind, typing);
    if (kind === "er") items.push(...cardinalityItems());
    if (kind === "state") items.push(keyword("final"));
    return items;
  }

  if (kind === "er" && count >= 3 && isCard(last) && operatorAt(before, count - 2)) {
    return references(analysis, kind, typing);
  }

  if (kind === "graph" && count >= 3 && isIdLike(last) && operatorAt(before, count - 2)) {
    return operatorItems(kind);
  }

  if (count === 1 && (isIdLike(last) || isPunct(last, "*"))) {
    const items = operatorItems(kind);
    if (kind === "er") items.push(...cardinalityItems());
    return items;
  }

  if (kind === "er" && count === 2 && isIdLike(before[0]) && isCard(last)) return operatorItems(kind);
  return [];
}

export function complete(source: string, position: Position): CompletionItem[] {
  const analysis = analyze(source);
  const { conv, ast } = analysis;
  const text = conv.text;
  const offset = conv.offset(position);
  const scan = bracketScan(text, offset);
  const lineStart =
    scan !== undefined
      ? text.lastIndexOf("\n", scan.open) + 1
      : offset === 0
        ? 0
        : text.lastIndexOf("\n", offset - 1) + 1;
  const lineEndAt = scan !== undefined ? scan.end : text.indexOf("\n", offset);
  const line = text.slice(lineStart, lineEndAt < 0 ? text.length : lineEndAt);
  const prefix = text.slice(lineStart, offset);
  if (lineState(prefix) !== "code") return [];

  const before = lexLine(prefix);
  const tail = before[before.length - 1];
  let word = "";
  let wordStart = prefix.length;
  const stem = before[before.length - 2];
  if (
    tail !== undefined &&
    tail.end === prefix.length &&
    tail.kind === "ERROR" &&
    tail.text === "." &&
    stem !== undefined &&
    stem.kind === "IDENT" &&
    stem.end === tail.start
  ) {
    word = `${stem.text}.`;
    wordStart = stem.start;
    before.pop();
    before.pop();
  } else if (tail !== undefined && tail.end === prefix.length) {
    const partialOperator = tail.kind === "ERROR" && /^[-.>]+$/.test(tail.text);
    if (tail.kind === "IDENT" || partialOperator) {
      word = tail.text;
      wordStart = tail.start;
      before.pop();
    }
  }
  const open = openBracket(before);
  if (open === -1) return [];

  const isFirst = text.slice(0, lineStart).split("\n").every((earlier) => lexLine(earlier).length === 0);
  if (isFirst) {
    if (before.length === 0) {
      const kinds = KINDS.map((label) => ({ label, kind: "keyword" as const, documentation: KIND_DOCS[label] }));
      return sorted(kinds, word);
    }
    const named = before[0]!;
    if (open === undefined || named.kind !== "IDENT" || !(KINDS as readonly string[]).includes(named.text)) return [];
    const items = bracketItems(analysis, bracketState(before, open), "header", named.text as Kind, line, wordStart, word);
    return sorted(items, word);
  }

  const kind: Kind = ast.kind;
  const depth = blockDepth(text.slice(0, lineStart).split("\n"));
  if (open !== undefined) {
    const context = attrContext(kind, before.slice(0, open), depth);
    return sorted(bracketItems(analysis, bracketState(before, open), context, kind, line, wordStart, word), word);
  }
  const typing = { start: lineStart + wordStart, end: offset };
  return sorted(statementItems(analysis, kind, before, depth, typing), word);
}
