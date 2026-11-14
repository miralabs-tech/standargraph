import type { Shape, TreeDocument, TreeNode } from "../format/schema";
import { Ids, noteLosses, type Warnings } from "./common";

const DELIMITERS: Partial<Record<Shape, readonly [string, string]>> = {
  box: ["(", ")"],
  pill: ["(", ")"],
  rect: ["[", "]"],
  circle: ["((", "))"],
  hexagon: ["{{", "}}"],
};

function nodeText(label: string): string {
  const flat = label.replace(/\r?\n/g, " ");
  if (/[()[\]{}]/.test(flat) || flat.startsWith('"')) {
    return `"\`${flat.replace(/`/g, "")}\`"`;
  }
  return flat;
}

export function mindmapLines(doc: TreeDocument, warnings: Warnings): string[] {
  const ids = new Ids();
  const children = new Map<string, TreeNode[]>();
  let root: TreeNode | undefined;
  for (const node of doc.nodes) {
    ids.add(node.id, node.id);
    noteLosses(warnings, node);
    if (node.parent === undefined) {
      root ??= node;
      continue;
    }
    const list = children.get(node.parent);
    if (list === undefined) children.set(node.parent, [node]);
    else list.push(node);
  }
  const lines = ["mindmap"];
  const stack: { node: TreeNode; depth: number }[] =
    root === undefined ? [] : [{ node: root, depth: 1 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    const shape = node.shape ?? "box";
    let delimiters = DELIMITERS[shape];
    if (delimiters === undefined) {
      warnings.add(`shape "${shape}" written as a rectangle`);
      delimiters = ["[", "]"];
    }
    lines.push(
      `${"  ".repeat(depth)}${ids.get(node.id)}${delimiters[0]}${nodeText(node.label)}${delimiters[1]}`,
    );
    const own = children.get(node.id) ?? [];
    for (let index = own.length - 1; index >= 0; index--) {
      stack.push({ node: own[index]!, depth: depth + 1 });
    }
  }
  return lines;
}
