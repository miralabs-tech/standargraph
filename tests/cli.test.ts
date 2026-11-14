import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
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

test("export writes the four formats", async () => {
  const dir = mkdtempSync(join(tmpdir(), "standargraph-"));
  try {
    const code = await run([
      "export",
      "examples/architecture.json",
      "--format",
      "svg,html,png,pdf",
      "--out",
      dir,
    ]);
    expect(code).toBe(0);
    for (const extension of ["svg", "html", "png", "pdf"]) {
      expect(existsSync(join(dir, `architecture.${extension}`))).toBe(true);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("export rejects an unknown format, an unknown flag and a missing file with 2", async () => {
  const dir = mkdtempSync(join(tmpdir(), "standargraph-"));
  try {
    expect(
      await run(["export", "examples/architecture.json", "--format", "gif", "--out", dir]),
    ).toBe(2);
    expect(await run(["export", "examples/architecture.json", "--nope"])).toBe(2);
    expect(await run(["export", join(dir, "missing.json")])).toBe(2);
    expect(existsSync(join(dir, "architecture.gif"))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("export reports validation errors with 1", async () => {
  const dir = mkdtempSync(join(tmpdir(), "standargraph-"));
  try {
    const file = join(dir, "bad.json");
    writeFileSync(file, JSON.stringify({ version: 2, kind: "graph", nodes: [] }));
    expect(await run(["export", file, "--out", dir])).toBe(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("export --markdown writes the SVG and prints a snippet linking it to the HTML page", async () => {
  const dir = mkdtempSync(join(tmpdir(), "standargraph-"));
  const printed: string[] = [];
  const original = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    printed.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  let code: number;
  try {
    code = await run([
      "export",
      "examples/architecture.json",
      "--format",
      "svg,html",
      "--out",
      dir,
      "--markdown",
    ]);
  } finally {
    process.stdout.write = original;
  }
  try {
    expect(code).toBe(0);
    const svg = join(dir, "architecture.svg");
    expect(existsSync(svg)).toBe(true);
    expect(statSync(svg).size).toBeGreaterThan(0);
    expect(existsSync(join(dir, "architecture.html"))).toBe(true);
    const snippet = printed.join("").split("\n").find((line) => line.startsWith("[!["));
    expect(snippet).toMatch(/^\[!\[[^\]]+\]\(architecture\.svg\)\]\(architecture\.html\)$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
