import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let cachedRoot: string | undefined;
let cachedFonts: { regular: Uint8Array; semibold: Uint8Array } | undefined;

function isPackageRoot(directory: string): boolean {
  const file = join(directory, "package.json");
  if (!existsSync(file)) return false;
  try {
    return (JSON.parse(readFileSync(file, "utf8")) as { name?: unknown }).name === "standargraph";
  } catch {
    return false;
  }
}

export function packageRoot(): string {
  if (cachedRoot !== undefined) return cachedRoot;
  let directory = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (isPackageRoot(directory)) {
      cachedRoot = directory;
      return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error("Cannot locate the standargraph package root");
    }
    directory = parent;
  }
}

export function loadFonts(): { regular: Uint8Array; semibold: Uint8Array } {
  if (cachedFonts === undefined) {
    const directory = join(packageRoot(), "assets", "fonts");
    cachedFonts = {
      regular: new Uint8Array(readFileSync(join(directory, "Inter-Regular.ttf"))),
      semibold: new Uint8Array(readFileSync(join(directory, "Inter-SemiBold.ttf"))),
    };
  }
  return cachedFonts;
}
