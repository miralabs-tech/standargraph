import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const RUNTIME_ENTRY = fileURLToPath(new URL("../src/html/runtime.ts", import.meta.url));
export const RUNTIME_OUTPUT = new URL("../src/html/runtime.generated.ts", import.meta.url);

export async function buildRuntime(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [RUNTIME_ENTRY],
    target: "browser",
    format: "iife",
    minify: true,
  });
  if (!result.success) {
    throw new Error(result.logs.map((log) => String(log)).join("\n"));
  }
  const output = result.outputs[0];
  if (output === undefined) throw new Error("Runtime bundle is empty");
  const code = (await output.text()).trim();
  return `export const RUNTIME_JS = ${JSON.stringify(code)};\n`;
}

if (import.meta.main) {
  writeFileSync(RUNTIME_OUTPUT, await buildRuntime());
}
