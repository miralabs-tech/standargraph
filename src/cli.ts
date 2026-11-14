#!/usr/bin/env node
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExportResult } from "./export";
import type { Document } from "./format/schema";
import { formatLoadErrors } from "./shared/errors";
import { type PageThemeOption, THEMES } from "./svg/theme";
import { loadSource, print } from "./text";
import { VERSION } from "./version";

const USAGE = `Usage: standargraph <command> [options]

Commands:
  validate <file>    Validate a document (JSON or text syntax) against format v1
  export <file>      Export a document to SVG, HTML, PNG, PDF or Mermaid
  layout <file>      Write the graph document with every node position computed (JSON)
  convert <file>     Convert a document between JSON and the text syntax

Convert options:
  --to <format>      json or text (default: the other format than the input)
  --out <file>       Output file (default: <input base>.json or .sg next to the input)

Layout options:
  --out <file>       Output file (default: <input>.positioned.json next to the input)

Export options:
  --format <list>    Comma-separated formats: svg, html, png, pdf, mermaid (default: svg,html)
  --out <dir>        Output directory (default: the input file directory)
  --name <base>      Output base name (default: the input file name without .json or .sg)
  --theme <theme>    light, dark, auto or a theme file ending in .json (default: auto)
  --scale <n>        PNG scale factor (default: 2)
  --renderer <name>  HTML renderer: auto, svg or webgl (default: auto)
  --markdown         Print a Markdown snippet linking the SVG preview to the HTML page, then the Mermaid code block when mermaid is exported

Options:
  -v, --version    Print the version
  -h, --help       Show this help
`;

type Read = { document: Document; format: "json" | "text" };

function readDocument(file: string): Read | number {
  let source: string;
  try {
    source = readFileSync(file, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Cannot read ${file}: ${reason}\n`);
    return 2;
  }
  const loaded = loadSource(source);
  if (loaded.ok) return { document: loaded.document, format: loaded.format };
  if (loaded.format === "json" && loaded.errors[0]?.path === undefined) {
    process.stderr.write(`Cannot read ${file}: ${loaded.errors[0]?.message}\n`);
    return 2;
  }
  process.stderr.write(`${formatLoadErrors(loaded.errors, file)}\n`);
  return 1;
}

function baseName(file: string): string {
  const extension = extname(file);
  return basename(file, extension === ".json" || extension === ".sg" ? extension : "");
}

function runValidate(file: string | undefined): number {
  if (file === undefined) {
    process.stderr.write("Usage: standargraph validate <file>\n");
    return 2;
  }
  const read = readDocument(file);
  if (typeof read === "number") return read;
  process.stdout.write(`valid: ${file}\n`);
  return 0;
}

const FORMATS = ["svg", "html", "png", "pdf", "mermaid"] as const;
type Format = (typeof FORMATS)[number];
type Renderer = "auto" | "svg" | "webgl";

type ExportArgs = {
  file: string;
  formats: Format[];
  out: string | undefined;
  name: string | undefined;
  theme: PageThemeOption;
  scale: number | undefined;
  renderer: Renderer;
  markdown: boolean;
};

function fail(message: string): undefined {
  process.stderr.write(`${message}\n`);
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStrings(value: unknown, keys: readonly string[]): boolean {
  return (
    isRecord(value) &&
    Object.entries(value).every(([key, item]) => keys.includes(key) && typeof item === "string")
  );
}

function isTheme(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const { base, tokens, types } = value;
  if (base !== undefined && base !== "light" && base !== "dark") return false;
  if (tokens !== undefined && !isStrings(tokens, Object.keys(THEMES.light))) return false;
  if (types === undefined) return true;
  return (
    isRecord(types) &&
    Object.values(types).every((style) => isStrings(style, ["fill", "stroke", "text"]))
  );
}

function readTheme(file: string): PageThemeOption | undefined {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return fail(`Cannot read theme ${file}: ${reason}`);
  }
  const valid =
    isRecord(value) && "light" in value && "dark" in value
      ? isTheme(value.light) && isTheme(value.dark)
      : isTheme(value);
  return valid ? (value as PageThemeOption) : fail(`Invalid theme file: ${file}`);
}

function parseExportArgs(args: string[]): ExportArgs | undefined {
  const values = new Map<string, string>();
  const valued = new Set(["--format", "--out", "--name", "--theme", "--scale", "--renderer"]);
  let markdown = false;
  let file: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (!arg.startsWith("--")) {
      if (file !== undefined) return fail(`Unexpected argument: ${arg}`);
      file = arg;
      continue;
    }
    const equals = arg.indexOf("=");
    const flag = equals === -1 ? arg : arg.slice(0, equals);
    if (flag === "--markdown" && equals === -1) {
      markdown = true;
    } else if (valued.has(flag)) {
      const value = equals === -1 ? args[++index] : arg.slice(equals + 1);
      if (value === undefined) return fail(`Missing value for ${flag}`);
      values.set(flag, value);
    } else {
      return fail(`Unknown option: ${arg}`);
    }
  }
  if (file === undefined) {
    return fail("Usage: standargraph export <file> [--format svg,html,png,pdf,mermaid] [--out <dir>] [--name <base>] [--theme light|dark|auto|<file.json>] [--scale <n>] [--renderer auto|svg|webgl] [--markdown]");
  }
  const formats: Format[] = [];
  for (const item of (values.get("--format") ?? "svg,html").split(",")) {
    const format = item.trim();
    if (!(FORMATS as readonly string[]).includes(format)) {
      return fail(`Unknown format: ${format}`);
    }
    if (!formats.includes(format as Format)) formats.push(format as Format);
  }
  const themeValue = values.get("--theme") ?? "auto";
  let theme: PageThemeOption | undefined;
  if (themeValue.endsWith(".json")) {
    theme = readTheme(themeValue);
    if (theme === undefined) return undefined;
  } else if (themeValue === "light" || themeValue === "dark" || themeValue === "auto") {
    theme = themeValue;
  } else {
    return fail(`Unknown theme: ${themeValue}`);
  }
  const renderer = values.get("--renderer") ?? "auto";
  if (renderer !== "auto" && renderer !== "svg" && renderer !== "webgl") {
    return fail(`Unknown renderer: ${renderer}`);
  }
  const scaleText = values.get("--scale");
  let scale: number | undefined;
  if (scaleText !== undefined) {
    scale = Number(scaleText);
    if (!Number.isFinite(scale) || scale <= 0) return fail(`Invalid scale: ${scaleText}`);
  }
  return {
    file,
    formats,
    out: values.get("--out"),
    name: values.get("--name"),
    theme,
    scale,
    renderer,
    markdown,
  };
}

async function runExport(args: string[]): Promise<number> {
  const parsed = parseExportArgs(args);
  if (parsed === undefined) return 2;
  const read = readDocument(parsed.file);
  if (typeof read === "number") return read;
  const document = read.document;
  const base = parsed.name ?? baseName(parsed.file);
  const directory = parsed.out ?? dirname(parsed.file);
  const rendered = parsed.formats.filter((format) => format !== "mermaid");
  let output: ExportResult = {};
  if (rendered.length > 0) {
    const { exportDocument } = await import("./export");
    output = await exportDocument(document, {
      formats: rendered,
      theme: parsed.theme,
      scale: parsed.scale,
      renderer: parsed.renderer,
    });
  }
  if (rendered.length < parsed.formats.length) {
    const { toMermaid } = await import("./mermaid");
    const result = toMermaid(document);
    for (const warning of result.warnings) process.stderr.write(`warning: ${warning}\n`);
    output.mermaid = result.text;
  }
  try {
    mkdirSync(directory, { recursive: true });
    for (const format of parsed.formats) {
      const data = output[format];
      if (data === undefined) continue;
      const target = join(directory, `${base}.${format === "mermaid" ? "mmd" : format}`);
      writeFileSync(target, data);
      process.stdout.write(`wrote ${target}\n`);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Cannot write to ${directory}: ${reason}\n`);
    return 2;
  }
  if (parsed.markdown) {
    const title = document.title ?? base;
    process.stdout.write(`[![${title}](${base}.svg)](${base}.html)\n`);
    if (output.mermaid !== undefined) {
      process.stdout.write(`\`\`\`mermaid\n${output.mermaid}\`\`\`\n`);
    }
  }
  return 0;
}

async function runLayout(args: string[]): Promise<number> {
  let file: string | undefined;
  let out: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--out") {
      out = args[++index];
      if (out === undefined) return fail("Missing value for --out") ?? 2;
    } else if (arg.startsWith("--out=")) {
      out = arg.slice("--out=".length);
    } else if (arg.startsWith("--")) {
      return fail(`Unknown option: ${arg}`) ?? 2;
    } else if (file === undefined) {
      file = arg;
    } else {
      return fail(`Unexpected argument: ${arg}`) ?? 2;
    }
  }
  if (file === undefined) return fail("Usage: standargraph layout <file> [--out <file>]") ?? 2;
  const read = readDocument(file);
  if (typeof read === "number") return read;
  const document = read.document;
  if (document.kind !== "graph") {
    process.stderr.write("Only graph documents carry node positions\n");
    return 1;
  }
  const { layout } = await import("./layout");
  const scene = await layout(document);
  if (scene.kind !== "graph") return 1;
  const placed = new Map(scene.nodes.map((node) => [node.id, node]));
  const positioned = {
    ...document,
    nodes: document.nodes.map((node) => {
      const item = placed.get(node.id);
      return item === undefined ? node : { ...node, position: { x: item.x, y: item.y } };
    }),
  };
  const target =
    out ?? join(dirname(file), `${baseName(file)}.positioned.json`);
  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(positioned, null, 2)}\n`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Cannot write ${target}: ${reason}\n`);
    return 2;
  }
  process.stdout.write(`wrote ${target}\n`);
  return 0;
}

function runConvert(args: string[]): number {
  let file: string | undefined;
  let out: string | undefined;
  let to: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    const equals = arg.indexOf("=");
    const flag = equals === -1 ? arg : arg.slice(0, equals);
    if (flag === "--out" || flag === "--to") {
      const value = equals === -1 ? args[++index] : arg.slice(equals + 1);
      if (value === undefined) return fail(`Missing value for ${flag}`) ?? 2;
      if (flag === "--out") out = value;
      else to = value;
    } else if (arg.startsWith("--")) {
      return fail(`Unknown option: ${arg}`) ?? 2;
    } else if (file === undefined) {
      file = arg;
    } else {
      return fail(`Unexpected argument: ${arg}`) ?? 2;
    }
  }
  if (file === undefined) {
    return fail("Usage: standargraph convert <file> [--to json|text] [--out <file>]") ?? 2;
  }
  if (to !== undefined && to !== "json" && to !== "text") {
    return fail(`Unknown format: ${to}`) ?? 2;
  }
  const read = readDocument(file);
  if (typeof read === "number") return read;
  const target = to ?? (read.format === "json" ? "text" : "json");
  const output =
    out ?? join(dirname(file), `${baseName(file)}.${target === "json" ? "json" : "sg"}`);
  if (resolve(output) === resolve(file)) {
    return fail("Output would overwrite the input") ?? 2;
  }
  try {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(
      output,
      target === "json" ? `${JSON.stringify(read.document, null, 2)}\n` : print(read.document),
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Cannot write ${output}: ${reason}\n`);
    return 2;
  }
  process.stdout.write(`wrote ${output}\n`);
  return 0;
}

export function run(argv: string[]): number | Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }
  if (command === "--version" || command === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (command === "validate") {
    return runValidate(rest[0]);
  }
  if (command === "export") {
    return runExport(rest);
  }
  if (command === "layout") {
    return runLayout(rest);
  }
  if (command === "convert") {
    return runConvert(rest);
  }
  process.stderr.write(`Unknown command: ${command}\n`);
  return 1;
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  process.exitCode = await run(process.argv.slice(2));
}
