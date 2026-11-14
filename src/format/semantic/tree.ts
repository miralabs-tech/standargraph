import type { TreeDocument } from "../schema";
import { checkUnique, parentCycles, type ValidationError } from "./shared";

export function semanticTreeErrors(doc: TreeDocument): ValidationError[] {
  const errors: ValidationError[] = [];
  const nodeIds = checkUnique(doc.nodes, "nodes", "node", errors);

  doc.nodes.forEach((node, index) => {
    if (node.parent !== undefined && !nodeIds.has(node.parent)) {
      errors.push({
        path: `/nodes/${index}/parent`,
        message: `Parent node "${node.parent}" is not a known node id`,
      });
    }
  });

  for (const { index, cycle } of parentCycles(doc.nodes)) {
    errors.push({
      path: `/nodes/${index}/parent`,
      message: `Node parent cycle: ${cycle.join(" -> ")}`,
    });
  }

  let first: string | undefined;
  doc.nodes.forEach((node, index) => {
    if (node.parent !== undefined) return;
    if (first === undefined) {
      first = node.id;
      return;
    }
    errors.push({
      path: `/nodes/${index}`,
      message: `Second root "${node.id}": a tree has exactly one node without parent (first: "${first}")`,
    });
  });
  if (first === undefined) {
    errors.push({
      path: "/nodes",
      message: "A tree needs exactly one root (a node without parent): found none",
    });
  }

  if (doc.layout === "mindmap" && doc.direction !== undefined) {
    errors.push({
      path: "/direction",
      message: 'direction does not apply to layout "mindmap"',
    });
  }

  return errors;
}
