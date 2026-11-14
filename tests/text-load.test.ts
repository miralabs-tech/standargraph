import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { exportDocument } from "../src/export";
import { formatLoadErrors } from "../src/shared/errors";
import { loadSource, sniff } from "../src/text";

const JSON_SOURCE = readFileSync("examples/architecture.json", "utf8");
const TEXT_SOURCE = readFileSync("examples/architecture.sg", "utf8");

describe("sniff", () => {
  test("a leading brace means JSON, whatever precedes it", () => {
    expect(sniff(JSON_SOURCE)).toBe("json");
    expect(sniff("﻿  \n\n{}")).toBe("json");
    expect(sniff("# note\n\n  # another\n{ }")).toBe("json");
  });

  test("everything else is text", () => {
    expect(sniff(TEXT_SOURCE)).toBe("text");
    expect(sniff('graph "T"\n')).toBe("text");
    expect(sniff("")).toBe("text");
    expect(sniff("# only a comment")).toBe("text");
    expect(sniff("[1]")).toBe("text");
  });
});

describe("loadSource", () => {
  test("loads JSON and text to the same graph", () => {
    const json = loadSource(JSON_SOURCE);
    const text = loadSource(TEXT_SOURCE);
    expect(json.ok && json.format).toBe("json");
    expect(text.ok && text.format).toBe("text");
    if (!json.ok || !text.ok) throw new Error("expected both to load");
    expect(json.document.kind).toBe(text.document.kind);
  });

  test("accepts a BOM before JSON", () => {
    expect(loadSource(`﻿${JSON_SOURCE}`).ok).toBe(true);
  });

  test("reports invalid JSON without a path", () => {
    const loaded = loadSource("{ nope");
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.format).toBe("json");
    expect(loaded.errors).toHaveLength(1);
    expect(loaded.errors[0]!.message).toStartWith("Invalid JSON: ");
    expect(loaded.errors[0]!.path).toBeUndefined();
  });

  test("keeps the path of JSON validation errors", () => {
    const loaded = loadSource(JSON.stringify({ version: 2, kind: "graph", nodes: [] }));
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.errors.every((error) => error.path !== undefined)).toBe(true);
  });

  test("reports text errors with line, column and code", () => {
    const loaded = loadSource('graph\n\na -> b\nc %\n');
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.format).toBe("text");
    const [error] = loaded.errors;
    expect(error).toMatchObject({ line: 4, column: 3, code: "E_TOKEN" });
    expect(formatLoadErrors(loaded.errors, "f.sg")).toBe(
      `f.sg:4:3: ${error!.message} [E_TOKEN]`,
    );
    expect(formatLoadErrors(loaded.errors)).toBe(`4:3: ${error!.message} [E_TOKEN]`);
  });
});

describe("exportDocument with a string", () => {
  test("renders text and JSON sources the same way", async () => {
    const fromText = await exportDocument(TEXT_SOURCE, { formats: ["svg"] });
    const fromJson = await exportDocument(JSON_SOURCE, { formats: ["svg"] });
    expect(fromText.svg).toContain("<svg");
    expect(fromText.svg).toBe(fromJson.svg);
  });

  test("throws Invalid document with one line per error", async () => {
    await expect(exportDocument('graph\n\na %\n')).rejects.toThrow(/^Invalid document:\n\d+:\d+: .*\[E_TOKEN\]/s);
    await expect(exportDocument("{ nope")).rejects.toThrow(/^Invalid document:\nInvalid JSON: /);
  });
});
