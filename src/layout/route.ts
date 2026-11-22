import type { Box, Point } from "./types";

const EPSILON = 1e-9;

function inflate(box: Box, margin: number): Box {
  return {
    x: box.x - margin,
    y: box.y - margin,
    width: box.width + 2 * margin,
    height: box.height + 2 * margin,
  };
}

function strictlyInside(point: Point, box: Box): boolean {
  return (
    point.x > box.x + EPSILON &&
    point.x < box.x + box.width - EPSILON &&
    point.y > box.y + EPSILON &&
    point.y < box.y + box.height - EPSILON
  );
}

function crossesInterior(from: Point, to: Point, box: Box): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let low = 0;
  let high = 1;
  const bounds: [number, number][] = [
    [-dx, from.x - box.x],
    [dx, box.x + box.width - from.x],
    [-dy, from.y - box.y],
    [dy, box.y + box.height - from.y],
  ];
  for (const [p, q] of bounds) {
    if (Math.abs(p) < EPSILON) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > high) return false;
      if (t > low) low = t;
    } else {
      if (t < low) return false;
      if (t < high) high = t;
    }
  }
  if (high - low < EPSILON) return false;
  const middle = (low + high) / 2;
  return strictlyInside(
    { x: from.x + dx * middle, y: from.y + dy * middle },
    box,
  );
}

function blocked(from: Point, to: Point, boxes: readonly Box[]): boolean {
  for (const box of boxes) {
    if (crossesInterior(from, to, box)) return true;
  }
  return false;
}

export function routeAroundObstacles(
  from: Point,
  to: Point,
  obstacles: readonly Box[],
  margin = 12,
): Point[] {
  const direct = [from, to];
  const boxes = obstacles.map((box) => inflate(box, margin));
  if (!blocked(from, to, boxes)) return direct;

  const nodes: Point[] = [from, to];
  for (const box of boxes) {
    const corners: Point[] = [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
      { x: box.x, y: box.y + box.height },
    ];
    for (const corner of corners) {
      if (boxes.some((other) => strictlyInside(corner, other))) continue;
      nodes.push(corner);
    }
  }

  const count = nodes.length;
  const distance = new Array<number>(count).fill(Number.POSITIVE_INFINITY);
  const previous = new Array<number>(count).fill(-1);
  const done = new Array<boolean>(count).fill(false);
  distance[0] = 0;
  for (;;) {
    let current = -1;
    for (let i = 0; i < count; i++) {
      if (done[i]) continue;
      if (distance[i]! === Number.POSITIVE_INFINITY) continue;
      if (current === -1 || distance[i]! < distance[current]!) current = i;
    }
    if (current === -1 || current === 1) break;
    done[current] = true;
    const here = nodes[current]!;
    for (let next = 0; next < count; next++) {
      if (done[next]) continue;
      const there = nodes[next]!;
      const step = Math.hypot(there.x - here.x, there.y - here.y);
      if (step === 0) continue;
      const total = distance[current]! + step;
      if (total >= distance[next]! - EPSILON) continue;
      if (blocked(here, there, boxes)) continue;
      distance[next] = total;
      previous[next] = current;
    }
  }

  if (previous[1]! === -1) return direct;
  const path: Point[] = [];
  for (let at = 1; at !== -1; at = previous[at]!) path.push(nodes[at]!);
  path.reverse();
  return path.map((point) => ({ ...point }));
}

export function offsetPolyline(points: readonly Point[], offset: number): Point[] {
  const clean: Point[] = [];
  for (const point of points) {
    const last = clean[clean.length - 1];
    if (last !== undefined && last.x === point.x && last.y === point.y) continue;
    clean.push(point);
  }
  if (offset === 0 || clean.length < 2) return clean.map((p) => ({ ...p }));

  const lines = clean.slice(1).map((end, i) => {
    const start = clean[i]!;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const nx = (-(end.y - start.y) / length) * offset;
    const ny = ((end.x - start.x) / length) * offset;
    return {
      start: { x: start.x + nx, y: start.y + ny },
      end: { x: end.x + nx, y: end.y + ny },
    };
  });

  const result: Point[] = [lines[0]!.start];
  for (let i = 1; i < clean.length - 1; i++) {
    const a = lines[i - 1]!;
    const b = lines[i]!;
    const adx = a.end.x - a.start.x;
    const ady = a.end.y - a.start.y;
    const bdx = b.end.x - b.start.x;
    const bdy = b.end.y - b.start.y;
    const cross = adx * bdy - ady * bdx;
    const average = {
      x: (a.end.x + b.start.x) / 2,
      y: (a.end.y + b.start.y) / 2,
    };
    if (Math.abs(cross) < EPSILON) {
      result.push(average);
      continue;
    }
    const t = ((b.start.x - a.start.x) * bdy - (b.start.y - a.start.y) * bdx) / cross;
    const joint = { x: a.start.x + adx * t, y: a.start.y + ady * t };
    const reach = Math.hypot(joint.x - clean[i]!.x, joint.y - clean[i]!.y);
    result.push(reach > 4 * Math.abs(offset) ? average : joint);
  }
  result.push(lines[lines.length - 1]!.end);
  return result;
}
