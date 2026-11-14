#!/usr/bin/env node
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "./format/validate";
import { type PageThemeOption, THEMES } from "./svg/theme";
import { VERSION } from "./version";

const USAGE = `Usage: standargraph <command> [options]

Commands:
  validate <file>    Validate a graph document (JSON) against format v1
  export <file>      Export a graph document to SVG, HTML, PNG or PDF
  layout <file>      Write the graph document with every node position computed

Layout options:
  --out <file>       Output file (default: <input>.positioned.json next to the input)

Export options:
  --format <list>    Comma-separated formats: svg, html, png, pdf (default: svg,html)
  --out <dir>        Output directory (default: the input file directory)
  --name <base>      Output base name (default: the input file name without .json)
  --theme <theme>    light, dark, auto or a theme file ending in .json (default: auto)
  --scale <n>        PNG scale factor (default: 2)
  --renderer <name>  HTML renderer: auto, svg or webgl (default: auto)
  --markdown         Print a Markdown snippet linking the SVG preview to the HTML page

Options:
  -v, --version    Print the version
  -h, --help       Show this help
`;

function runValidate(file: string | undefined): number {
  if (file === undefined) {
    process.stderr.write("Usage: standargraph validate <file>\n");
    return 2;
  }
  let input: unknown;
  try {
    input = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Cannot read ${file}: ${reason}\n`);
    return 2;
  }
  const result = validate(input);
  if (result.ok) {
    process.stdout.write(`valid: ${file}\n`);
    return 0;
  }
  for (const error of result.errors) {
    process.stderr.write(`${error.path}: ${error.message}\n`);
  }
  return 1;
}

const FORMATS = ["svg", "html", "png", "pdf"] as const;
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
    return fail("Usage: standargraph export <file> [--format svg,html,png,pdf] [--out <dir>] [--name <base>] [--theme light|dark|auto|<file.json>] [--scale <n>] [--renderer auto|svg|webgl] [--markdown]");
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
  let input: unknown;
  try {
    input = JSON.parse(readFileSync(parsed.file, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Cannot read ${parsed.file}: ${reason}\n`);
    return 2;
  }
  const result = validate(input);
  if (!result.ok) {
    for (const error of result.errors) {
      process.stderr.write(`${error.path}: ${error.message}\n`);
    }
    return 1;
  }
  const base =
    parsed.name ?? basename(parsed.file, extname(parsed.file) === ".json" ? ".json" : "");
  const directory = parsed.out ?? dirname(parsed.file);
  const { exportDocument } = await import("./export");
  const output = await exportDocument(result.document, {
    formats: parsed.formats,
    theme: parsed.theme,
    scale: parsed.scale,
    renderer: parsed.renderer,
  });
  try {
    mkdirSync(directory, { recursive: true });
    for (const format of parsed.formats) {
      const data = output[format];
      if (data === undefined) continue;
      const target = join(directory, `${base}.${format}`);
      writeFileSync(target, data);
      process.stdout.write(`wrote ${target}\n`);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Cannot write to ${directory}: ${reason}\n`);
    return 2;
  }
  if (parsed.markdown) {
    const title = result.document.title ?? base;
    process.stdout.write(`[![${title}](${base}.svg)](${base}.html)\n`);
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
  let input: unknown;
  try {
    input = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Cannot read ${file}: ${reason}\n`);
    return 2;
  }
  const result = validate(input);
  if (!result.ok) {
    for (const error of result.errors) {
      process.stderr.write(`${error.path}: ${error.message}\n`);
    }
    return 1;
  }
  const document = result.document;
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
    out ?? join(dirname(file), `${basename(file, extname(file) === ".json" ? ".json" : "")}.positioned.json`);
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
