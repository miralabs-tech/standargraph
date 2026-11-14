import type { Cardinality, ErDocument } from "../format/schema";
import { BLOCK_DIRECTIONS, Ids, mlabel, noteLosses, type Warnings } from "./common";

const LEFT: Record<Cardinality, string> = {
  one: "||",
  "zero-or-one": "|o",
  "one-or-more": "}|",
  "zero-or-more": "}o",
};

const RIGHT: Record<Cardinality, string> = {
  one: "||",
  "zero-or-one": "o|",
  "one-or-more": "|{",
  "zero-or-more": "o{",
};

function safe(text: string): string {
  return text.replace(/[^A-Za-z0-9_()[\]-]/g, "_");
}

function attributeType(type: string | undefined): string {
  if (type === undefined || type === "") return "any";
  const name = safe(type);
  return /^[A-Za-z]/.test(name) ? name : `t_${name}`;
}

export function erLines(doc: ErDocument, warnings: Warnings): string[] {
  const ids = new Ids();
  const lines = ["erDiagram", `  direction ${BLOCK_DIRECTIONS[doc.direction ?? "down"]}`];
  for (const entity of doc.entities) {
    noteLosses(warnings, entity);
    const id = ids.add(entity.id, entity.id);
    const label = entity.label ?? entity.id;
    lines.push(`  ${id}${label === id ? "" : `[${mlabel(label)}]`} {`);
    for (const attribute of entity.attributes ?? []) {
      if (attribute.nullable !== undefined) warnings.add("nullable dropped");
      const keys = (attribute.keys ?? []).map((key) => key.toUpperCase());
      const note =
        attribute.note === undefined || attribute.note === ""
          ? ""
          : ` "${attribute.note.replace(/"/g, "").replace(/\r?\n/g, " ")}"`;
      const suffix = keys.length === 0 ? "" : ` ${keys.join(", ")}`;
      lines.push(`    ${attributeType(attribute.type)} ${safe(attribute.name)}${suffix}${note}`);
    }
    lines.push("  }");
  }
  for (const relation of doc.relations ?? []) {
    noteLosses(warnings, relation);
    if (relation.fromCardinality === undefined || relation.toCardinality === undefined) {
      warnings.add('relation cardinality missing, written as "one"');
    }
    const left = LEFT[relation.fromCardinality ?? "one"];
    const right = RIGHT[relation.toCardinality ?? "one"];
    const operator = (relation.identifying ?? true) ? "--" : "..";
    lines.push(
      `  ${ids.get(relation.from)} ${left}${operator}${right} ${ids.get(relation.to)} : ${mlabel(relation.label ?? "")}`,
    );
  }
  return lines;
}
