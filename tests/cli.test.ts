import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli";
import { validate } from "../src/format";
import { layout } from "../src/layout";
import { canonicalize, loadSource, sniff } from "../src/text";

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

test("export, layout and convert write next to a bare file name from its own folder", async () => {
  const dir = mkdtempSync(join(tmpdir(), "standargraph-"));
  const previous = process.cwd();
  try {
    writeFileSync(join(dir, "map.json"), readFileSync("examples/architecture.json"));
    process.chdir(dir);
    expect(await run(["export", "map.json", "--format", "svg"])).toBe(0);
    expect(await run(["layout", "map.json"])).toBe(0);
    expect(run(["convert", "map.json"])).toBe(0);
    expect(existsSync(join(dir, "map.svg"))).toBe(true);
    expect(existsSync(join(dir, "map.positioned.json"))).toBe(true);
    expect(existsSync(join(dir, "map.sg"))).toBe(true);
  } finally {
    process.chdir(previous);
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

test("layout writes the document with a position on every node, and the result skips ELK", async () => {
  const dir = mkdtempSync(join(tmpdir(), "standargraph-"));
  const target = join(dir, "architecture.positioned.json");
  try {
    expect(await run(["layout", "examples/architecture.json", "--out", target])).toBe(0);
    const positioned = JSON.parse(readFileSync(target, "utf8"));
    expect(validate(positioned).ok).toBe(true);
    expect(positioned.nodes.every((node: { position?: unknown }) => node.position !== undefined)).toBe(true);
    const original = await layout(JSON.parse(readFileSync("examples/architecture.json", "utf8")));
    const again = await layout(positioned);
    if (original.kind !== "graph" || again.kind !== "graph") throw new Error("expected graph scenes");
    for (const node of original.nodes) {
      const same = again.nodes.find((item) => item.id === node.id)!;
      expect([same.x, same.y]).toEqual([node.x, node.y]);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("layout refuses a sequence document and an unknown option", async () => {
  expect(await run(["layout", "examples/protocol.json", "--out", join(tmpdir(), "never.json")])).toBe(1);
  expect(await run(["layout", "examples/architecture.json", "--nope"])).toBe(2);
});

function capture(): { stderr: string[]; restore: () => void } {
  const stderr: string[] = [];
  const original = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stderr.write;
  return {
    stderr,
    restore: () => {
      process.stderr.write = original;
    },
  };
}

test("validate accepts a text example and reports text errors as file:line:col with the code", () => {
  expect(run(["validate", "examples/architecture.sg"])).toBe(0);
  const dir = mkdtempSync(join(tmpdir(), "standargraph-"));
  const seen = capture();
  try {
    const file = join(dir, "bad.sg");
    writeFileSync(file, "graph\n\na %\n");
    expect(run(["validate", file])).toBe(1);
    seen.restore();
    expect(seen.stderr.join("")).toContain(`${file}:3:3: Unexpected character "%" [E_TOKEN]`);
  } finally {
    seen.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("export reads a text document and removes .sg from the output base name", async () => {
  const dir = mkdtempSync(join(tmpdir(), "standargraph-"));
  try {
    expect(await run(["export", "examples/architecture.sg", "--format", "svg", "--out", dir])).toBe(0);
    expect(statSync(join(dir, "architecture.svg")).size).toBeGreaterThan(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("layout on a text document still writes JSON", async () => {
  const dir = mkdtempSync(join(tmpdir(), "standargraph-"));
  try {
    const file = join(dir, "architecture.sg");
    writeFileSync(file, readFileSync("examples/architecture.sg", "utf8"));
    expect(await run(["layout", file])).toBe(0);
    const positioned = JSON.parse(readFileSync(join(dir, "architecture.positioned.json"), "utf8"));
    expect(validate(positioned).ok).toBe(true);
    expect(positioned.nodes.every((node: { position?: unknown }) => node.position !== undefined)).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("convert goes both ways and keeps the document", () => {
  const dir = mkdtempSync(join(tmpdir(), "standargraph-"));
  try {
    const json = join(dir, "architecture.json");
    expect(run(["convert", "examples/architecture.sg", "--out", json])).toBe(0);
    const direct = loadSource(readFileSync("examples/architecture.sg", "utf8"));
    const converted = loadSource(readFileSync(json, "utf8"));
    if (!direct.ok || !converted.ok) throw new Error("expected both to load");
    expect(converted.document).toEqual(direct.document);

    const copy = join(dir, "copy.json");
    writeFileSync(copy, readFileSync("examples/architecture.json", "utf8"));
    expect(run(["convert", copy])).toBe(0);
    const text = readFileSync(join(dir, "copy.sg"), "utf8");
    expect(sniff(text)).toBe("text");
    const back = loadSource(text);
    const original = loadSource(readFileSync(copy, "utf8"));
    if (!back.ok || !original.ok) throw new Error("expected both to load");
    expect(back.document).toEqual(canonicalize(original.document));

    const forced = join(dir, "forced.sg");
    expect(run(["convert", copy, "--to", "text", "--out", forced])).toBe(0);
    expect(readFileSync(forced, "utf8")).toBe(text);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("convert refuses to overwrite its input and rejects bad arguments with 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "standargraph-"));
  const seen = capture();
  try {
    const file = join(dir, "same.json");
    writeFileSync(file, readFileSync("examples/architecture.json", "utf8"));
    expect(run(["convert", file, "--to", "json"])).toBe(2);
    expect(run(["convert", file, "--out", file])).toBe(2);
    expect(run(["convert", file, "--to", "yaml"])).toBe(2);
    expect(run(["convert", file, "--nope"])).toBe(2);
    expect(run(["convert"])).toBe(2);
    seen.restore();
    expect(seen.stderr.join("")).toContain("Output would overwrite the input");
    expect(readFileSync(file, "utf8")).toBe(readFileSync("examples/architecture.json", "utf8"));
  } finally {
    seen.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("convert returns 1 on an invalid text document", () => {
  const dir = mkdtempSync(join(tmpdir(), "standargraph-"));
  const seen = capture();
  try {
    const file = join(dir, "bad.sg");
    writeFileSync(file, "graph\n\na %\n");
    expect(run(["convert", file])).toBe(1);
    expect(existsSync(join(dir, "bad.json"))).toBe(false);
  } finally {
    seen.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("export --format mermaid writes a .mmd file, prints warnings on stderr and exits 0", async () => {
  const dir = mkdtempSync(join(tmpdir(), "standargraph-"));
  const seen = capture();
  const printed: string[] = [];
  const original = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    printed.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  let code: number;
  try {
    code = await run(["export", "examples/shop-er.json", "--format", "mermaid", "--out", dir]);
  } finally {
    process.stdout.write = original;
    seen.restore();
  }
  try {
    expect(code).toBe(0);
    const file = join(dir, "shop-er.mmd");
    expect(readFileSync(file, "utf8").startsWith('---\ntitle: "Shop orders"\n---\nerDiagram\n')).toBe(true);
    expect(existsSync(join(dir, "shop-er.svg"))).toBe(false);
    expect(seen.stderr.join("")).toContain("warning: nullable dropped\n");
    expect(printed.join("")).not.toContain("```mermaid");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("export with mermaid and --markdown prints the snippet, then the Mermaid code block", async () => {
  const dir = mkdtempSync(join(tmpdir(), "standargraph-"));
  const seen = capture();
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
      "examples/protocol.sg",
      "--format",
      "svg,mermaid",
      "--out",
      dir,
      "--markdown",
    ]);
  } finally {
    process.stdout.write = original;
    seen.restore();
  }
  try {
    expect(code).toBe(0);
    expect(existsSync(join(dir, "protocol.svg"))).toBe(true);
    const mermaid = readFileSync(join(dir, "protocol.mmd"), "utf8");
    const output = printed.join("");
    const snippet = output.indexOf("[![");
    const block = output.indexOf("```mermaid\n");
    expect(snippet).toBeGreaterThan(-1);
    expect(block).toBeGreaterThan(snippet);
    expect(output.endsWith(`\`\`\`mermaid\n${mermaid}\`\`\`\n`)).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--theme nord colors the export with the palette", async () => {
  const dir = mkdtempSync(join(tmpdir(), "standargraph-"));
  try {
    expect(
      await run(["export", "examples/architecture.json", "--format", "svg,html", "--out", dir, "--theme", "nord"]),
    ).toBe(0);
    expect(readFileSync(join(dir, "architecture.svg"), "utf8")).toContain("--sg-bg:#2e3440");
    const page = readFileSync(join(dir, "architecture.html"), "utf8");
    expect(page).toContain("--sg-bg:#2e3440");
    expect(page).not.toContain(".sg-app[data-sg-scheme");
    expect(page).not.toContain('class="sg-scheme"');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--no-palette removes the automatic type colors and the default stays on", async () => {
  const dir = mkdtempSync(join(tmpdir(), "standargraph-"));
  try {
    expect(await run(["export", "examples/architecture.json", "--format", "svg", "--out", dir])).toBe(0);
    expect(readFileSync(join(dir, "architecture.svg"), "utf8")).toContain("[data-type=");
    expect(
      await run(["export", "examples/architecture.json", "--format", "svg,html", "--out", dir, "--no-palette"]),
    ).toBe(0);
    expect(readFileSync(join(dir, "architecture.svg"), "utf8")).not.toContain("[data-type=");
    expect(readFileSync(join(dir, "architecture.html"), "utf8")).not.toContain("[data-type=");
    expect(
      await run(["export", "examples/architecture.json", "--format", "svg", "--out", dir, "--theme", "dark", "--no-palette"]),
    ).toBe(0);
    expect(readFileSync(join(dir, "architecture.svg"), "utf8")).toContain("--sg-bg:#0f172a");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a theme file with a palette name as base and palette false is accepted", async () => {
  const dir = mkdtempSync(join(tmpdir(), "standargraph-"));
  try {
    const file = join(dir, "theme.json");
    writeFileSync(file, JSON.stringify({ base: "solarized-light", palette: false, tokens: { accent: "#ff0000" } }));
    expect(
      await run(["export", "examples/architecture.json", "--format", "svg", "--out", dir, "--theme", file]),
    ).toBe(0);
    const svg = readFileSync(join(dir, "architecture.svg"), "utf8");
    expect(svg).toContain("--sg-bg:#fdf6e3");
    expect(svg).toContain("--sg-accent:#ff0000");
    expect(svg).not.toContain("[data-type=");
    writeFileSync(file, JSON.stringify({ base: "sepia" }));
    expect(
      await run(["export", "examples/architecture.json", "--format", "svg", "--out", dir, "--theme", file]),
    ).toBe(2);
    writeFileSync(file, JSON.stringify({ palette: true }));
    expect(
      await run(["export", "examples/architecture.json", "--format", "svg", "--out", dir, "--theme", file]),
    ).toBe(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
