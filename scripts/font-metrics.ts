import { readFileSync, writeFileSync } from "node:fs";
import opentype from "opentype.js";

const WEIGHTS = {
  regular: "Inter-Regular.ttf",
  semibold: "Inter-SemiBold.ttf",
} as const;

const RANGES: [number, number][] = [
  [0x20, 0x24f],
  [0x2000, 0x206f],
  [0x2190, 0x21ff],
];

function load(file: string): opentype.Font {
  const bytes = readFileSync(new URL(`../assets/fonts/${file}`, import.meta.url));
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return opentype.parse(buffer);
}

function table(font: opentype.Font) {
  const advances: Record<number, number> = {};
  for (const [from, to] of RANGES) {
    for (let code = from; code <= to; code++) {
      const index = font.charToGlyphIndex(String.fromCodePoint(code));
      if (index === 0) continue;
      advances[code] = font.glyphs.get(index).advanceWidth ?? 0;
    }
  }
  let sum = 0;
  for (let code = 0x61; code <= 0x7a; code++) sum += advances[code] ?? 0;
  return {
    unitsPerEm: font.unitsPerEm,
    ascender: font.ascender,
    descender: font.descender,
    fallback: Math.round(sum / 26),
    advances,
  };
}

const metrics: Record<string, ReturnType<typeof table>> = {};
for (const [weight, file] of Object.entries(WEIGHTS)) {
  metrics[weight] = table(load(file));
}

const lines: string[] = [
  "export type FontWeight = \"regular\" | \"semibold\";",
  "",
  "export type FontMetrics = {",
  "  unitsPerEm: number;",
  "  ascender: number;",
  "  descender: number;",
  "  fallback: number;",
  "  advances: Readonly<Record<number, number>>;",
  "};",
  "",
  "export const FONT_METRICS: Record<FontWeight, FontMetrics> = {",
];
for (const weight of Object.keys(WEIGHTS)) {
  const m = metrics[weight]!;
  lines.push(`  ${weight}: {`);
  lines.push(`    unitsPerEm: ${m.unitsPerEm},`);
  lines.push(`    ascender: ${m.ascender},`);
  lines.push(`    descender: ${m.descender},`);
  lines.push(`    fallback: ${m.fallback},`);
  lines.push("    advances: {");
  const codes = Object.keys(m.advances)
    .map(Number)
    .sort((a, b) => a - b);
  for (let i = 0; i < codes.length; i += 8) {
    lines.push(
      "      " +
        codes
          .slice(i, i + 8)
          .map((code) => `${code}: ${m.advances[code]},`)
          .join(" "),
    );
  }
  lines.push("    },");
  lines.push("  },");
}
lines.push("};", "");

writeFileSync(
  new URL("../src/layout/font-metrics.ts", import.meta.url),
  lines.join("\n"),
);
