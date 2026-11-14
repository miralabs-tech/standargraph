export type ValidationError = { path: string; message: string };

export function checkUnique(
  items: readonly { id?: string }[],
  collection: string,
  label: string,
  errors: ValidationError[],
): Set<string> {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (item.id === undefined) return;
    if (seen.has(item.id)) {
      errors.push({
        path: `/${collection}/${index}/id`,
        message: `Duplicate ${label} id "${item.id}"`,
      });
    }
    seen.add(item.id);
  });
  return seen;
}

export function parentCycles(
  items: readonly { id: string; parent?: string }[],
): { index: number; cycle: string[] }[] {
  const ids = new Set(items.map((item) => item.id));
  const parentOf = new Map<string, string>();
  for (const item of items) {
    if (item.parent !== undefined && ids.has(item.parent)) {
      parentOf.set(item.id, item.parent);
    }
  }
  const firstIndex = new Map<string, number>();
  items.forEach((item, index) => {
    if (!firstIndex.has(item.id)) firstIndex.set(item.id, index);
  });
  const state = new Map<string, 1 | 2>();
  const found: { index: number; cycle: string[] }[] = [];
  for (const item of items) {
    if (state.has(item.id)) continue;
    const path: string[] = [];
    const position = new Map<string, number>();
    let current: string | undefined = item.id;
    while (current !== undefined && !state.has(current)) {
      state.set(current, 1);
      position.set(current, path.length);
      path.push(current);
      current = parentOf.get(current);
    }
    if (current !== undefined && state.get(current) === 1) {
      const members = path.slice(position.get(current)!);
      let start = 0;
      members.forEach((id, at) => {
        if (firstIndex.get(id)! < firstIndex.get(members[start]!)!) start = at;
      });
      const cycle = [...members.slice(start), ...members.slice(0, start)];
      found.push({ index: firstIndex.get(cycle[0]!)!, cycle: [...cycle, cycle[0]!] });
    }
    for (const id of path) state.set(id, 2);
  }
  return found.sort((a, b) => a.index - b.index);
}
