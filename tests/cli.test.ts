import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli";

test("--version returns 0", () => {
  expect(run(["--version"])).toBe(0);
});

test("unknown command returns 1", () => {
  expect(run(["nope"])).toBe(1);
});

test("validate accepts a valid example", () => {
  expect(run(["validate", "examples/architecture.json"])).toBe(0);
});

test("validate rejects an invalid document with 1", () => {
  const dir = mkdtempSync(join(tmpdir(), "standargraph-"));
  try {
    const file = join(dir, "bad.json");
    writeFileSync(file, JSON.stringify({ version: 2, kind: "graph", nodes: [] }));
    expect(run(["validate", file])).toBe(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validate returns 2 on unreadable or non-JSON input", () => {
  const dir = mkdtempSync(join(tmpdir(), "standargraph-"));
  try {
    const file = join(dir, "broken.json");
    writeFileSync(file, "{ not json");
    expect(run(["validate", file])).toBe(2);
    expect(run(["validate", join(dir, "missing.json")])).toBe(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
