import type { GraphDocument, Group, Node, Shape, TreeDocument } from "../format/schema";
import { FLOW_DIRECTIONS, Ids, mlabel, noteLosses, type Warnings } from "./common";

const DELIMITERS: Record<Shape, readonly [string, string]> = {
  box: ["(", ")"],
  rect: ["[", "]"],
  pill: ["([", "])"],
  diamond: ["{", "}"],
  circle: ["((", "))"],
  ellipse: ["((", "))"],
  hexagon: ["{{", "}}"],
  parallelogram: ["[/", "/]"],
  cylinder: ["[(", ")]"],
  subroutine: ["[[", "]]"],
  document: ["[", "]"],
};

function shapeNode(
  id: string,
  label: string,
  shape: Shape | undefined,
  warnings: Warnings,
): string {
  if (shape === "ellipse") warnings.add('shape "ellipse" written as a circle');
  if (shape === "document") warnings.add('shape "document" written as a rectangle');
  const [open, close] = DELIMITERS[shape ?? "box"];
  return `${id}${open}${mlabel(label)}${close}`;
}

function push<T>(map: Map<string, T[]>, key: string, item: T): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [item]);
  else list.push(item);
}

export function graphLines(doc: GraphDocument, warnings: Warnings): string[] {
  const ids = new Ids();
  for (const node of doc.nodes) ids.add(`node:${node.id}`, node.id);
  const groups = doc.groups ?? [];
  for (const group of groups) ids.add(`group:${group.id}`, group.id);

  const nodesByGroup = new Map<string, Node[]>();
  for (const node of doc.nodes) {
    noteLosses(warnings, node);
    push(nodesByGroup, node.group ?? "", node);
  }
  const groupsByParent = new Map<string, Group[]>();
  for (const group of groups) {
    noteLosses(warnings, group);
    push(groupsByParent, group.parent ?? "", group);
  }

  const lines = [`flowchart ${FLOW_DIRECTIONS[doc.direction ?? "down"]}`];
  const emit = (container: string, depth: number): void => {
    const indent = "  ".repeat(depth);
    for (const node of nodesByGroup.get(container) ?? []) {
      const id = ids.get(`node:${node.id}`);
      lines.push(`${indent}${shapeNode(id, node.label ?? node.id, node.shape, warnings)}`);
    }
    for (const group of groupsByParent.get(container) ?? []) {
      const id = ids.get(`group:${group.id}`);
      lines.push(`${indent}subgraph ${id} [${mlabel(group.label ?? group.id)}]`);
      emit(group.id, depth + 1);
      lines.push(`${indent}end`);
    }
  };
  emit("", 1);

  for (const edge of doc.edges ?? []) {
    noteLosses(warnings, edge);
    const confidence = edge.meta?.provenance?.confidence;
    const dotted = confidence === "inferred" || confidence === "unknown";
    const directed = edge.directed ?? true;
    const arrow = directed ? (dotted ? "-.->" : "-->") : dotted ? "-.-" : "---";
    const label =
      edge.label === undefined || edge.label === "" ? "" : `|${mlabel(edge.label)}|`;
    lines.push(`  ${ids.get(`node:${edge.from}`)} ${arrow}${label} ${ids.get(`node:${edge.to}`)}`);
  }
  return lines;
}

export function treeFlowLines(doc: TreeDocument, warnings: Warnings): string[] {
  const ids = new Ids();
  for (const node of doc.nodes) ids.add(node.id, node.id);
  const lines = [`flowchart ${FLOW_DIRECTIONS[doc.direction ?? "down"]}`];
  for (const node of doc.nodes) {
    noteLosses(warnings, node);
    lines.push(`  ${shapeNode(ids.get(node.id), node.label, node.shape, warnings)}`);
  }
  for (const node of doc.nodes) {
    if (node.parent !== undefined) lines.push(`  ${ids.get(node.parent)} --- ${ids.get(node.id)}`);
  }
  return lines;
}
