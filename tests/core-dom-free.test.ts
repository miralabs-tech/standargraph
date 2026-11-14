import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const FORBIDDEN = [/\bdocument\./, /\bwindow\./, /requestAnimationFrame/, /\bHTMLElement\b/];

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

test("core, format, layout, text and mermaid never touch the DOM", () => {
  const root = fileURLToPath(new URL("../src", import.meta.url));
  const files = ["core", "format", "layout", "text", "mermaid"].flatMap((name) => sources(join(root, name)));
  expect(files.length).toBeGreaterThan(5);
  const offenders: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const pattern of FORBIDDEN) {
      if (pattern.test(text)) offenders.push(`${file}: ${pattern}`);
    }
  }
  expect(offenders).toEqual([]);
});
