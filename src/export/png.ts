import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { loadFonts } from "../shared/package-root";

export type PngOptions = { scale?: number };

let ready: Promise<void> | undefined;

function ensureWasm(): Promise<void> {
  if (ready === undefined) {
    const path = createRequire(import.meta.url).resolve(
      "@resvg/resvg-wasm/index_bg.wasm",
    );
    ready = readFile(path).then((bytes) => initWasm(bytes));
  }
  return ready;
}

export async function renderPng(
  svg: string,
  options: PngOptions = {},
): Promise<Uint8Array> {
  await ensureWasm();
  const fonts = loadFonts();
  const resvg = new Resvg(svg, {
    font: {
      fontBuffers: [fonts.regular, fonts.semibold],
      defaultFontFamily: "Inter",
      loadSystemFonts: false,
    },
    fitTo: { mode: "zoom", value: options.scale ?? 2 },
  });
  try {
    const image = resvg.render();
    return image.asPng();
  } finally {
    resvg.free();
  }
}
