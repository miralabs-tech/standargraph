import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const RUNTIME_ENTRY = fileURLToPath(new URL("../src/html/runtime.ts", import.meta.url));
export const RUNTIME_OUTPUT = new URL("../src/html/runtime.generated.ts", import.meta.url);
export const WEBGL_ENTRY = fileURLToPath(new URL("../src/webgl/runtime.ts", import.meta.url));
export const WEBGL_OUTPUT = new URL("../src/webgl/runtime.generated.ts", import.meta.url);
export const WORKER_ENTRY = fileURLToPath(new URL("../src/html/layout-worker.ts", import.meta.url));
export const WORKER_OUTPUT = new URL("../src/html/layout-worker.generated.ts", import.meta.url);

async function bundle(entry: string, banner?: string): Promise<string> {
  const result = await Bun.build({
    entrypoints: [entry],
    target: "browser",
    format: "iife",
    minify: true,
    banner,
  });
  if (!result.success) {
    throw new Error(result.logs.map((log) => String(log)).join("\n"));
  }
  const output = result.outputs[0];
  if (output === undefined) throw new Error("Runtime bundle is empty");
  return (await output.text()).trim();
}

export async function buildRuntime(): Promise<string> {
  return `export const RUNTIME_JS = ${JSON.stringify(await bundle(RUNTIME_ENTRY))};\n`;
}

export async function buildWebglRuntime(): Promise<string> {
  return `export const WEBGL_RUNTIME_JS = ${JSON.stringify(await bundle(WEBGL_ENTRY))};\n`;
}

export async function buildLayoutWorker(): Promise<string> {
  return `export const LAYOUT_WORKER_JS = ${JSON.stringify(await bundle(WORKER_ENTRY, "var __require;"))};
`;
}

if (import.meta.main) {
  writeFileSync(RUNTIME_OUTPUT, await buildRuntime());
  writeFileSync(WEBGL_OUTPUT, await buildWebglRuntime());
  writeFileSync(WORKER_OUTPUT, await buildLayoutWorker());
}
