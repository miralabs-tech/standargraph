import type { Document, Group, Node } from "../format/schema";

type Linked = { id: string; parent?: string };
type Json = Record<string, any>;

function childrenOf<T extends Linked>(items: readonly T[]): Map<string | undefined, T[]> {
  const children = new Map<string | undefined, T[]>();
  for (const item of items) {
    const list = children.get(item.parent);
    if (list) list.push(item);
    else children.set(item.parent, [item]);
  }
  return children;
}

export function walk<T extends Linked>(
  items: readonly T[],
  enter: (item: T, depth: number, children: number) => void,
  exit?: (item: T, depth: number, children: number) => void,
): void {
  const children = childrenOf(items);
  const stack: { item: T; depth: number; exiting: boolean }[] = [];
  const push = (parent: string | undefined, depth: number): void => {
    const list = children.get(parent);
    if (!list) return;
    for (let index = list.length - 1; index >= 0; index--) {
      stack.push({ item: list[index]!, depth, exiting: false });
    }
  };
  push(undefined, 0);
  while (stack.length > 0) {
    const frame = stack.pop()!;
    const count = children.get(frame.item.id)?.length ?? 0;
    if (frame.exiting) {
      exit?.(frame.item, frame.depth, count);
      continue;
    }
    enter(frame.item, frame.depth, count);
    stack.push({ ...frame, exiting: true });
    push(frame.item.id, frame.depth + 1);
  }
}

export function preorder<T extends Linked>(items: readonly T[]): T[] {
  const ordered: T[] = [];
  walk(items, (item) => {
    ordered.push(item);
  });
  return ordered;
}

export function groupNodes(nodes: readonly Node[]): Map<string | undefined, Node[]> {
  const byGroup = new Map<string | undefined, Node[]>();
  for (const node of nodes) {
    const list = byGroup.get(node.group);
    if (list) list.push(node);
    else byGroup.set(node.group, [node]);
  }
  return byGroup;
}

function orderedNodes(nodes: readonly Node[], groups: readonly Group[]): Node[] {
  const byGroup = groupNodes(nodes);
  const ordered = [...(byGroup.get(undefined) ?? [])];
  for (const group of preorder(groups)) ordered.push(...(byGroup.get(group.id) ?? []));
  return ordered;
}

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clean(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) clean(item);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "meta" && isRecord(child)) {
      if (isRecord(child.data) && Object.keys(child.data).length === 0) delete child.data;
      if (Object.keys(child).length === 0) delete value[key];
    } else {
      clean(child);
    }
  }
}

function dropEmpty(target: Json, key: string): void {
  if (Array.isArray(target[key]) && target[key].length === 0) delete target[key];
}

export function canonicalize(document: Document): Document {
  const copy = structuredClone(document) as Json;
  delete copy.$schema;
  clean(copy);
  switch (copy.kind) {
    case "graph":
      copy.nodes = orderedNodes(copy.nodes, copy.groups ?? []);
      if (copy.groups) copy.groups = preorder<Group>(copy.groups);
      for (const edge of copy.edges ?? []) edge.directed ??= true;
      dropEmpty(copy, "edges");
      dropEmpty(copy, "groups");
      break;
    case "sequence":
      for (const message of copy.messages) message.style ??= "sync";
      break;
    case "state":
      copy.states = preorder(copy.states);
      dropEmpty(copy, "transitions");
      break;
    case "er":
      for (const entity of copy.entities) {
        for (const attribute of entity.attributes ?? []) {
          if (attribute.nullable === false) delete attribute.nullable;
          dropEmpty(attribute, "keys");
        }
      }
      for (const relation of copy.relations ?? []) relation.identifying ??= true;
      dropEmpty(copy, "relations");
      break;
    case "tree":
      copy.nodes = preorder(copy.nodes);
      break;
  }
  return copy as Document;
}
