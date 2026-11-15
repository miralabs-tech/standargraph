import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const PACKAGE = "@standarx/graph";
const SUBPATHS = ["core", "format", "layout", "svg", "html", "export", "webgl", "remark", "text", "language", "mermaid"];
const EDITOR_FILES = ["grammars/standargraph.tmLanguage.json", "language-configuration.json"];
const failures: string[] = [];

function report(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` ${detail}`}`);
  if (!ok) failures.push(name);
}

function run(command: string[], cwd: string): { code: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: result.exitCode ?? 1, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

function nonEmpty(file: string): boolean {
  return existsSync(file) && statSync(file).size > 0;
}

const work = mkdtempSync(join(tmpdir(), "standargraph-smoke-"));
try {
  const build = run(["bun", "run", "build"], root);
  report("build", build.code === 0, build.code === 0 ? "" : build.stderr);
  if (build.code !== 0) throw new Error("build failed");

  const packDir = join(work, "pack");
  const pack = run(["bun", "pm", "pack", "--destination", packDir], root);
  const tarball = existsSync(packDir)
    ? readdirSync(packDir).find((entry) => entry.endsWith(".tgz"))
    : undefined;
  report("pack", pack.code === 0 && tarball !== undefined, pack.code === 0 ? "" : pack.stderr);
  if (tarball === undefined) throw new Error("pack failed");

  const project = join(work, "project");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "smoke", private: true, type: "module" }));
  const install = run(["bun", "add", join(packDir, tarball)], project);
  report("install tarball with bun add", install.code === 0, install.code === 0 ? "" : install.stderr);
  if (install.code !== 0) throw new Error("install failed");

  const node = run(["node", "--version"], project);
  console.log(`node ${node.stdout.trim()}`);

  const probe = join(project, "probe.mjs");
  for (const subpath of SUBPATHS) {
    writeFileSync(
      probe,
      `const m = await import(${JSON.stringify(`${PACKAGE}/${subpath}`)}); if (Object.keys(m).length === 0) process.exit(3);`,
    );
    const result = run(["node", probe], project);
    report(`import ${subpath}`, result.code === 0, result.code === 0 ? "" : result.stderr.trim().split("\n")[0] ?? "");
  }

  for (const file of EDITOR_FILES) {
    const installed = join(project, "node_modules", PACKAGE, file);
    let parsed = false;
    try {
      parsed = typeof JSON.parse(readFileSync(installed, "utf8")) === "object";
    } catch {}
    report(`editor file ${file} installed and valid JSON`, parsed);
    writeFileSync(
      probe,
      `const m = await import(${JSON.stringify(`${PACKAGE}/${file}`)}, { with: { type: "json" } }); if (typeof m.default !== "object") process.exit(3);`,
    );
    const result = run(["node", probe], project);
    report(`import ${file}`, result.code === 0, result.code === 0 ? "" : result.stderr.trim().split("\n")[0] ?? "");
  }

  const binDir = join(project, "node_modules", ".bin");
  const cli = join(project, "node_modules", PACKAGE, "dist", "cli.js");
  report("bin entry present", existsSync(cli) && existsSync(binDir));

  const version = run(["node", cli, "--version"], project);
  report("cli --version", version.code === 0 && /^\d+\.\d+\.\d+/.test(version.stdout.trim()), version.stdout.trim());

  const out = join(work, "out");
  const example = join(root, "examples", "architecture.json");
  const exported = run(["node", cli, "export", example, "--format", "svg,html", "--out", out], project);
  report("cli export", exported.code === 0, exported.code === 0 ? "" : exported.stderr.trim());
  for (const extension of ["svg", "html"]) {
    report(`output ${extension} non-empty`, nonEmpty(join(out, `architecture.${extension}`)));
  }

  const textOut = join(work, "out-text");
  const textExample = join(root, "examples", "architecture.sg");
  const textValidated = run(["node", cli, "validate", textExample], project);
  report("cli validate .sg", textValidated.code === 0, textValidated.code === 0 ? "" : textValidated.stderr.trim());
  const textExported = run(["node", cli, "export", textExample, "--format", "svg", "--out", textOut], project);
  report("cli export .sg", textExported.code === 0, textExported.code === 0 ? "" : textExported.stderr.trim());
  report("output svg from .sg non-empty", nonEmpty(join(textOut, "architecture.svg")));
  const converted = run(["node", cli, "convert", textExample, "--out", join(textOut, "architecture.json")], project);
  report("cli convert .sg to json", converted.code === 0 && nonEmpty(join(textOut, "architecture.json")), converted.code === 0 ? "" : converted.stderr.trim());
} catch (error) {
  if (failures.length === 0) report("setup", false, error instanceof Error ? error.message : String(error));
} finally {
  rmSync(work, { recursive: true, force: true });
}

process.exit(failures.length === 0 ? 0 : 1);
