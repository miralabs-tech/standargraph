import type { Shape } from "../format";
import { measureText } from "./measure";
import { boxSize, CAPTION_FONT, LABEL_FONT } from "./shared";
import type { Box, Point } from "./types";

export const CYLINDER_RY = 7;
export const DOCUMENT_WAVE = 6;
const SUBROUTINE_PAD = 16;
const PILL_SEGMENTS = 12;
const ROUND_SEGMENTS = 48;
const CYLINDER_SEGMENTS = 24;

type Size = { width: number; height: number };

export const SUBROUTINE_BAR = 8;

export function shapeSize(
  shape: Shape | undefined,
  label: string,
  type: string | undefined,
  minWidth: number,
): Size {
  const base = boxSize(label, type, minWidth);
  const kind = shape ?? "box";
  const text = measureText(label, LABEL_FONT);
  const caption =
    type === undefined ? undefined : measureText(type, CAPTION_FONT);
  const tw = Math.max(text.width, caption?.width ?? 0);
  const th = text.height + (caption?.height ?? 0);
  switch (kind) {
    case "box":
    case "rect":
      return base;
    case "pill":
      return {
        width: Math.ceil(base.width + base.height / 2),
        height: base.height,
      };
    case "diamond": {
      const height = Math.ceil(Math.max(48, 2 * th + 8));
      return {
        width: Math.ceil(Math.max(80, tw / (1 - th / height) + 16)),
        height,
      };
    }
    case "circle": {
      const diameter = Math.ceil(Math.max(48, Math.hypot(tw, th) + 16));
      return { width: diameter, height: diameter };
    }
    case "ellipse":
      return {
        width: Math.ceil(Math.max(80, tw * Math.SQRT2 + 12)),
        height: Math.ceil(Math.max(40, th * Math.SQRT2 + 8)),
      };
    case "hexagon":
      return {
        width: Math.ceil(base.width + base.height / 2),
        height: base.height,
      };
    case "parallelogram":
      return {
        width: Math.ceil(base.width + base.height / 3),
        height: base.height,
      };
    case "cylinder":
      return { width: base.width, height: base.height + 2 * CYLINDER_RY };
    case "document":
      return { width: base.width, height: base.height + DOCUMENT_WAVE };
    case "subroutine":
      return { width: base.width + SUBROUTINE_PAD, height: base.height };
  }
}

export function textOffsetY(shape: Shape | undefined): number {
  if (shape === "cylinder") return CYLINDER_RY / 2;
  if (shape === "document") return -DOCUMENT_WAVE / 2;
  return 0;
}

function ellipsePoints(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  from: number,
  to: number,
  segments: number,
): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = from + ((to - from) * i) / segments;
    points.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
  }
  return points;
}

export function outline(
  shape: Shape | undefined,
  box: Box,
): Point[] | undefined {
  const { x, y, width: w, height: h } = box;
  switch (shape) {
    case undefined:
    case "box":
    case "rect":
    case "document":
    case "subroutine":
      return undefined;
    case "pill": {
      const r = h / 2;
      return [
        ...ellipsePoints(x + w - r, y + r, r, r, -Math.PI / 2, Math.PI / 2, PILL_SEGMENTS),
        ...ellipsePoints(x + r, y + r, r, r, Math.PI / 2, (3 * Math.PI) / 2, PILL_SEGMENTS),
      ];
    }
    case "diamond":
      return [
        { x: x + w / 2, y },
        { x: x + w, y: y + h / 2 },
        { x: x + w / 2, y: y + h },
        { x, y: y + h / 2 },
      ];
    case "circle":
    case "ellipse":
      return ellipsePoints(
        x + w / 2,
        y + h / 2,
        w / 2,
        h / 2,
        0,
        2 * Math.PI,
        ROUND_SEGMENTS,
      ).slice(0, ROUND_SEGMENTS);
    case "hexagon": {
      const i = h / 4;
      return [
        { x: x + i, y },
        { x: x + w - i, y },
        { x: x + w, y: y + h / 2 },
        { x: x + w - i, y: y + h },
        { x: x + i, y: y + h },
        { x, y: y + h / 2 },
      ];
    }
    case "parallelogram": {
      const s = h / 3;
      return [
        { x: x + s, y },
        { x: x + w, y },
        { x: x + w - s, y: y + h },
        { x, y: y + h },
      ];
    }
    case "cylinder":
      return [
        ...ellipsePoints(x + w / 2, y + CYLINDER_RY, w / 2, CYLINDER_RY, Math.PI, 2 * Math.PI, CYLINDER_SEGMENTS),
        ...ellipsePoints(x + w / 2, y + h - CYLINDER_RY, w / 2, CYLINDER_RY, 0, Math.PI, CYLINDER_SEGMENTS),
      ];
  }
}

function intersect(a: Point, c: Point, p: Point, q: Point): number | undefined {
  const rx = c.x - a.x;
  const ry = c.y - a.y;
  const sx = q.x - p.x;
  const sy = q.y - p.y;
  const denominator = rx * sy - ry * sx;
  if (denominator === 0) return undefined;
  const t = ((p.x - a.x) * sy - (p.y - a.y) * sx) / denominator;
  const u = ((p.x - a.x) * ry - (p.y - a.y) * rx) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return undefined;
  return t;
}

function firstHit(a: Point, c: Point, contour: readonly Point[]): Point | undefined {
  let best: number | undefined;
  for (let i = 0; i < contour.length; i++) {
    const t = intersect(a, c, contour[i]!, contour[(i + 1) % contour.length]!);
    if (t !== undefined && (best === undefined || t < best)) best = t;
  }
  if (best === undefined) return undefined;
  return { x: a.x + (c.x - a.x) * best, y: a.y + (c.y - a.y) * best };
}

function clipEnd(
  inner: Point,
  end: Point,
  contour: readonly Point[],
  box: Box,
): Point {
  const dx = end.x - inner.x;
  const dy = end.y - inner.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return end;
  const reach = box.width + box.height;
  const far = {
    x: end.x + (dx / length) * reach,
    y: end.y + (dy / length) * reach,
  };
  return firstHit(inner, far, contour) ?? end;
}

export function clipEnds(
  points: readonly Point[],
  fromShape: Shape | undefined,
  fromBox: Box,
  toShape: Shape | undefined,
  toBox: Box,
): Point[] {
  const result = points.map((point) => ({ ...point }));
  if (result.length < 2) return result;
  const fromContour = outline(fromShape, fromBox);
  const toContour = outline(toShape, toBox);
  const last = result.length - 1;
  if (toContour !== undefined) {
    result[last] = clipEnd(points[last - 1]!, points[last]!, toContour, toBox);
  }
  if (fromContour !== undefined) {
    result[0] = clipEnd(points[1]!, points[0]!, fromContour, fromBox);
  }
  return result;
}

export function clipToRect(rect: Box, toward: Point): Point {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scale = Math.min(
    dx === 0 ? Infinity : rect.width / 2 / Math.abs(dx),
    dy === 0 ? Infinity : rect.height / 2 / Math.abs(dy),
  );
  return { x: cx + dx * scale, y: cy + dy * scale };
}

export function clipToShape(
  shape: Shape | undefined,
  rect: Box,
  toward: Point,
): Point {
  const contour = outline(shape, rect);
  if (contour === undefined) return clipToRect(rect, toward);
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return center;
  const reach = rect.width + rect.height;
  const far = {
    x: center.x + (dx / length) * reach,
    y: center.y + (dy / length) * reach,
  };
  return firstHit(center, far, contour) ?? clipToRect(rect, toward);
}
