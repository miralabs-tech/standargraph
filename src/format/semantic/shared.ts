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
  const found: { index: number; cycle: string[] }[] = [];
  const reported = new Set<string>();
  items.forEach((item, index) => {
    const path: string[] = [];
    let current: string | undefined = item.id;
    while (current !== undefined) {
      const at = path.indexOf(current);
      if (at !== -1) {
        const cycle = path.slice(at);
        if (cycle.includes(item.id) && !reported.has(item.id)) {
          for (const id of cycle) reported.add(id);
          found.push({ index, cycle: [...cycle, current] });
        }
        break;
      }
      path.push(current);
      current = parentOf.get(current);
    }
  });
  return found;
}
