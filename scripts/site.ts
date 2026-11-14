import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderHtml } from "../src/html";
import { layout } from "../src/layout";
import { loadSource } from "../src/text";

const root = resolve(import.meta.dir, "..");
const EXAMPLES = join(root, "examples");
const SITE = join(root, "site");

export const SITE_OUTPUT = join(root, "site-dist");

type Example = { name: string; title: string; source: string };

async function bundlePlayground(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [join(SITE, "playground.ts")],
    target: "browser",
    format: "iife",
    minify: true,
    banner: "var __require;",
  });
  if (!result.success) throw new Error(result.logs.map((log) => String(log)).join("\n"));
  const output = result.outputs[0];
  if (output === undefined) throw new Error("Playground bundle is empty");
  return output.text();
}

export async function buildSite(output: string = SITE_OUTPUT): Promise<void> {
  rmSync(output, { recursive: true, force: true });
  mkdirSync(join(output, "examples"), { recursive: true });

  const names = readdirSync(EXAMPLES)
    .filter((file) => file.endsWith(".sg"))
    .map((file) => file.slice(0, -3))
    .sort();
  const examples: Example[] = [];
  for (const name of names) {
    const source = readFileSync(join(EXAMPLES, `${name}.sg`), "utf8");
    const loaded = loadSource(source);
    if (!loaded.ok) throw new Error(`Example ${name} is invalid`);
    const title = loaded.document.title ?? name;
    examples.push({ name, title, source });
    writeFileSync(join(output, "examples", `${name}.sg`), source);
    writeFileSync(join(output, "examples", `${name}.json`), readFileSync(join(EXAMPLES, `${name}.json`)));
    const scene = await layout(loaded.document);
    writeFileSync(join(output, "examples", `${name}.html`), renderHtml(loaded.document, scene, { title }));
  }

  writeFileSync(
    join(output, "examples.js"),
    `window.SG_EXAMPLES=${JSON.stringify(examples).replaceAll("<", "\\u003c")};\n`,
  );
  writeFileSync(join(output, "playground.js"), await bundlePlayground());
  writeFileSync(join(output, "index.html"), readFileSync(join(SITE, "index.html")));
}

if (import.meta.main) {
  await buildSite();
  console.log(`Site written to ${SITE_OUTPUT}`);
}
