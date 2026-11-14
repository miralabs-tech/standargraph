import type { ErDocument } from "../schema";
import { checkUnique, type ValidationError } from "./shared";

export function semanticErErrors(doc: ErDocument): ValidationError[] {
  const errors: ValidationError[] = [];
  const entityIds = checkUnique(doc.entities, "entities", "entity", errors);
  const relations = doc.relations ?? [];
  checkUnique(relations, "relations", "relation", errors);

  relations.forEach((relation, index) => {
    if (!entityIds.has(relation.from)) {
      errors.push({
        path: `/relations/${index}/from`,
        message: `Relation source "${relation.from}" is not a known entity id`,
      });
    }
    if (!entityIds.has(relation.to)) {
      errors.push({
        path: `/relations/${index}/to`,
        message: `Relation target "${relation.to}" is not a known entity id`,
      });
    }
  });

  doc.entities.forEach((entity, index) => {
    const names = new Set<string>();
    (entity.attributes ?? []).forEach((attribute, position) => {
      const base = `/entities/${index}/attributes/${position}`;
      if (names.has(attribute.name)) {
        errors.push({
          path: `${base}/name`,
          message: `Duplicate attribute "${attribute.name}" in entity "${entity.id}"`,
        });
      }
      names.add(attribute.name);
      const keys = new Set<string>();
      (attribute.keys ?? []).forEach((key, slot) => {
        if (keys.has(key)) {
          errors.push({ path: `${base}/keys/${slot}`, message: `Duplicate key "${key}"` });
        }
        keys.add(key);
      });
    });
  });

  return errors;
}
