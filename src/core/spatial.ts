export type Rect = { x: number; y: number; width: number; height: number };

export type SpatialEntry<T> = { box: Rect; value: T };

export interface SpatialIndex<T> {
  readonly size: number;
  query(rect: Rect): T[];
  at(x: number, y: number): T[];
}

const MAX_CELLS = 262144;
const MIN_CELL = 32;
const LARGE_CELLS = 64;

function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x <= b.x + b.width &&
    b.x <= a.x + a.width &&
    a.y <= b.y + b.height &&
    b.y <= a.y + a.height
  );
}

export function createSpatialIndex<T>(
  entries: readonly SpatialEntry<T>[],
  cellSize?: number,
): SpatialIndex<T> {
  const count = entries.length;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { box } of entries) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  if (count === 0) {
    minX = minY = 0;
    maxX = maxY = 1;
  }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  let size = cellSize ?? Math.max(MIN_CELL, Math.sqrt((spanX * spanY) / Math.max(1, count)) * 2);
  while ((Math.floor(spanX / size) + 1) * (Math.floor(spanY / size) + 1) > MAX_CELLS) {
    size *= 1.5;
  }
  const cols = Math.floor(spanX / size) + 1;
  const rows = Math.floor(spanY / size) + 1;
  const cells = new Map<number, number[]>();
  const large: number[] = [];

  const column = (x: number) => Math.min(cols - 1, Math.max(0, Math.floor((x - minX) / size)));
  const row = (y: number) => Math.min(rows - 1, Math.max(0, Math.floor((y - minY) / size)));

  entries.forEach(({ box }, index) => {
    const c0 = column(box.x);
    const c1 = column(box.x + box.width);
    const r0 = row(box.y);
    const r1 = row(box.y + box.height);
    if ((c1 - c0 + 1) * (r1 - r0 + 1) > LARGE_CELLS) {
      large.push(index);
      return;
    }
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const key = r * cols + c;
        const cell = cells.get(key);
        if (cell === undefined) cells.set(key, [index]);
        else cell.push(index);
      }
    }
  });

  const marks = new Int32Array(count);
  let stamp = 0;

  function query(rect: Rect): T[] {
    stamp += 1;
    const found: T[] = [];
    const visit = (index: number) => {
      if (marks[index] === stamp) return;
      marks[index] = stamp;
      const entry = entries[index]!;
      if (intersects(entry.box, rect)) found.push(entry.value);
    };
    if (rect.x <= maxX && rect.x + rect.width >= minX && rect.y <= maxY && rect.y + rect.height >= minY) {
      const c0 = column(rect.x);
      const c1 = column(rect.x + rect.width);
      const r0 = row(rect.y);
      const r1 = row(rect.y + rect.height);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const cell = cells.get(r * cols + c);
          if (cell === undefined) continue;
          for (const index of cell) visit(index);
        }
      }
    }
    for (const index of large) visit(index);
    return found;
  }

  return {
    size: count,
    query,
    at: (x, y) => query({ x, y, width: 0, height: 0 }),
  };
}
