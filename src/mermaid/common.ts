import type { Meta } from "../format/schema";

const RESERVED = new Set([
  "end",
  "graph",
  "flowchart",
  "subgraph",
  "style",
  "classdef",
  "class",
  "click",
  "linkstyle",
  "direction",
  "state",
  "note",
  "default",
  "call",
  "href",
]);

export class Ids {
  private readonly table = new Map<string, string>();
  private readonly used = new Set<string>();

  add(key: string, id: string): string {
    let base = id.replace(/[^A-Za-z0-9_]/gu, "_");
    if (/^[0-9]/.test(base) || RESERVED.has(base.toLowerCase())) base = `n_${base}`;
    let candidate = base;
    for (let count = 2; this.used.has(candidate); count++) candidate = `${base}_${count}`;
    this.used.add(candidate);
    this.table.set(key, candidate);
    return candidate;
  }

  get(key: string): string {
    return this.table.get(key) ?? key;
  }
}

export class Warnings {
  private readonly seen = new Set<string>();
  readonly list: string[] = [];

  add(message: string): void {
    if (this.seen.has(message)) return;
    this.seen.add(message);
    this.list.push(message);
  }
}

export const FLOW_DIRECTIONS = { down: "TD", right: "LR", up: "BT", left: "RL" } as const;

export const BLOCK_DIRECTIONS = { down: "TB", right: "LR", up: "BT", left: "RL" } as const;

export function mlabel(text: string): string {
  return `"${text.replace(/"/g, "#quot;").replace(/\r?\n/g, "<br>")}"`;
}

export function plainText(text: string): string {
  return text
    .replace(/[#;]/g, (character) => (character === "#" ? "#35;" : "#59;"))
    .replace(/\r?\n/g, "<br>");
}

type Lossy = { type?: string; description?: string; link?: string; position?: unknown; meta?: Meta };

export function noteLosses(warnings: Warnings, item: Lossy): void {
  if (item.type !== undefined) warnings.add("type dropped");
  if (item.description !== undefined) warnings.add("description dropped");
  if (item.link !== undefined) warnings.add("link dropped");
  if (item.position !== undefined) warnings.add("position dropped");
  if (item.meta !== undefined) warnings.add("metadata dropped");
}

export function frontMatter(title: string | undefined): string[] {
  if (title === undefined || title === "") return [];
  const value = title.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ");
  return ["---", `title: "${value}"`, "---"];
}
