import { LINE_HEIGHT, measureText, type TextOptions } from "./measure";

export const MARGIN = 20;
export const LABEL_FONT: TextOptions = { size: 14, weight: "semibold" };
export const CAPTION_FONT: TextOptions = { size: 11, weight: "regular" };
export const EDGE_LABEL_FONT: TextOptions = { size: 12, weight: "regular" };
export const GROUP_FONT: TextOptions = { size: 12, weight: "semibold" };
export const PAD_X = 12;
export const PAD_Y = 8;
export const SELF_LOOP_WIDTH = 30;
export const SELF_LOOP_HEIGHT = 20;

export function round(value: number): number {
  return Math.round(value * 100) / 100 + 0;
}

export function compact<T extends object>(value: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) result[key] = entry;
  }
  return result as T;
}

export function boxSize(
  label: string,
  type: string | undefined,
  minWidth: number,
): { width: number; height: number } {
  const text = measureText(label, LABEL_FONT);
  const caption =
    type === undefined ? undefined : measureText(type, CAPTION_FONT);
  const width = Math.ceil(
    Math.max(
      minWidth,
      text.width + 2 * PAD_X,
      caption === undefined ? 0 : caption.width + 2 * PAD_X,
    ),
  );
  const base = caption === undefined ? 40 : 54;
  const height = Math.ceil(
    Math.max(base, 2 * PAD_Y + text.height + (caption?.height ?? 0)),
  );
  return { width, height };
}

export function labelBoxSize(label: string): { width: number; height: number } {
  const text = measureText(label, EDGE_LABEL_FONT);
  return {
    width: Math.ceil(text.width + 8),
    height: Math.ceil(text.height + 4),
  };
}

export function groupTopPadding(label: string | undefined): number {
  if (label === undefined || label === "") return PAD_X;
  return Math.ceil(measureText(label, GROUP_FONT).height) + 16;
}

export const ACTIONS_GAP = 6;

export function actionsHeight(count: number): number {
  if (count === 0) return 0;
  return Math.ceil(ACTIONS_GAP + count * LINE_HEIGHT * CAPTION_FONT.size);
}

export function actionsWidth(actions: readonly string[]): number {
  return Math.max(0, ...actions.map((action) => measureText(action, CAPTION_FONT).width));
}
