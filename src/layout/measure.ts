import { FONT_METRICS, type FontWeight } from "./font-metrics";

export type TextOptions = { size: number; weight: FontWeight };

export const LINE_HEIGHT = 1.25;

export function measureText(
  text: string,
  options: TextOptions,
): { width: number; height: number } {
  const metrics = FONT_METRICS[options.weight];
  const lines = text.split("\n");
  let widest = 0;
  for (const line of lines) {
    let units = 0;
    for (const char of line) {
      units += metrics.advances[char.codePointAt(0) ?? 0] ?? metrics.fallback;
    }
    widest = Math.max(widest, (units / metrics.unitsPerEm) * options.size);
  }
  return {
    width: widest,
    height: lines.length * LINE_HEIGHT * options.size,
  };
}
