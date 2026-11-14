import type { GraphDocument, Meta, Node } from "../src/format";

export type GenerateOptions = {
  nodes: number;
  seed: number;
  groups?: number;
};

const WORDS = [
  "auth", "billing", "cache", "client", "config", "controller", "db", "event", "gateway",
  "handler", "index", "job", "kernel", "loader", "mapper", "notifier", "order", "parser",
  "queue", "repository", "router", "scheduler", "service", "session", "store", "sync",
  "token", "user", "validator", "worker",
];
const TYPES = ["service", "component", "endpoint", "database", "queue", "job", "hook"];
const EDGE_TYPES = ["calls", "reads", "writes", "emits"];
const CONFIDENCE = ["confirmed", "inferred", "unknown"] as const;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generate(options: GenerateOptions): GraphDocument {
  const count = Math.max(1, Math.floor(options.nodes));
  const groupCount = Math.max(1, Math.floor(options.groups ?? Math.max(1, Math.round(count / 100))));
  const random = mulberry32(options.seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
  const int = (max: number): number => Math.floor(random() * max);

  const groups = Array.from({ length: groupCount }, (_, index) => ({
    id: `g${index}`,
    label: `Module ${index}`,
  }));

  const nodes: Node[] = [];
  for (let index = 0; index < count; index++) {
    const words = 1 + int(4);
    const label = Array.from({ length: words }, () => pick(WORDS)).join(" ");
    const node: Node = {
      id: `n${index}`,
      label: random() < 0.1 ? `${label} ${pick(WORDS)} ${pick(WORDS)} handler` : label,
      group: groups[Math.floor((index * groupCount) / count)]!.id,
    };
    if (random() < 0.7) node.type = pick(TYPES);
    if (random() < 0.2) {
      const meta: Meta = {
        provenance: { source: "static-analysis", confidence: pick(CONFIDENCE) },
      };
      if (random() < 0.3) meta.coverage = Math.round(random() * 100) / 100;
      node.meta = meta;
    }
    nodes.push(node);
  }

  const edges: NonNullable<GraphDocument["edges"]> = [];
  const total = Math.round(count * 1.25);
  for (let index = 1; index < count && edges.length < total; index++) {
    const reach = Math.min(index, 50);
    const from = index - 1 - int(reach);
    edges.push({ from: `n${from}`, to: `n${index}`, directed: true });
  }
  while (edges.length < total && count > 1) {
    const from = int(count);
    const to = int(count);
    if (from === to) continue;
    const edge: NonNullable<GraphDocument["edges"]>[number] = {
      from: `n${from}`,
      to: `n${to}`,
      directed: true,
    };
    if (random() < 0.3) edge.type = pick(EDGE_TYPES);
    if (random() < 0.15) edge.label = pick(EDGE_TYPES);
    if (random() < 0.1) {
      edge.meta = { provenance: { source: "runtime-trace", confidence: pick(CONFIDENCE) } };
    }
    edges.push(edge);
  }

  return {
    version: 1,
    kind: "graph",
    title: `Generated graph (${count} nodes, seed ${options.seed})`,
    direction: "down",
    groups,
    nodes,
    edges,
    meta: { provenance: { source: "scripts/generate.ts" } },
  };
}

function parseArguments(args: string[]): GenerateOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]!;
    if (!flag.startsWith("--")) throw new Error(`Unexpected argument: ${flag}`);
    const value = args[++index];
    if (value === undefined) throw new Error(`Missing value for ${flag}`);
    values.set(flag, value);
  }
  const nodes = Number(values.get("--nodes") ?? 1000);
  const seed = Number(values.get("--seed") ?? 1);
  const groupsText = values.get("--groups");
  if (!Number.isFinite(nodes) || nodes < 1) throw new Error("Invalid --nodes");
  if (!Number.isFinite(seed)) throw new Error("Invalid --seed");
  return { nodes, seed, groups: groupsText === undefined ? undefined : Number(groupsText) };
}

if (import.meta.main) {
  try {
    process.stdout.write(`${JSON.stringify(generate(parseArguments(process.argv.slice(2))))}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
