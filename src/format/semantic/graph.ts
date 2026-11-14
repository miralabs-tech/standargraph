import type { GraphDocument } from "../schema";
import { checkUnique, parentCycles, type ValidationError } from "./shared";

export function semanticGraphErrors(doc: GraphDocument): ValidationError[] {
  const errors: ValidationError[] = [];
  const nodeIds = checkUnique(doc.nodes, "nodes", "node", errors);
  const groups = doc.groups ?? [];
  const groupIds = checkUnique(groups, "groups", "group", errors);
  const edges = doc.edges ?? [];
  checkUnique(edges, "edges", "edge", errors);

  edges.forEach((edge, index) => {
    if (!nodeIds.has(edge.from)) {
      errors.push({
        path: `/edges/${index}/from`,
        message: `Edge source "${edge.from}" is not a known node id`,
      });
    }
    if (!nodeIds.has(edge.to)) {
      errors.push({
        path: `/edges/${index}/to`,
        message: `Edge target "${edge.to}" is not a known node id`,
      });
    }
  });

  doc.nodes.forEach((node, index) => {
    if (node.group !== undefined && !groupIds.has(node.group)) {
      errors.push({
        path: `/nodes/${index}/group`,
        message: `Group "${node.group}" is not a known group id`,
      });
    }
  });

  groups.forEach((group, index) => {
    if (group.parent !== undefined && !groupIds.has(group.parent)) {
      errors.push({
        path: `/groups/${index}/parent`,
        message: `Parent group "${group.parent}" is not a known group id`,
      });
    }
  });

  for (const { index, cycle } of parentCycles(groups)) {
    errors.push({
      path: `/groups/${index}/parent`,
      message: `Group parent cycle: ${cycle.join(" -> ")}`,
    });
  }

  return errors;
}
