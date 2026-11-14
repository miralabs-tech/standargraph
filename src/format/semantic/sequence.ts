import type { SequenceDocument } from "../schema";
import { checkUnique, type ValidationError } from "./shared";

export function semanticSequenceErrors(doc: SequenceDocument): ValidationError[] {
  const errors: ValidationError[] = [];
  const ids = checkUnique(
    doc.participants,
    "participants",
    "participant",
    errors,
  );
  doc.messages.forEach((message, index) => {
    if (!ids.has(message.from)) {
      errors.push({
        path: `/messages/${index}/from`,
        message: `Message sender "${message.from}" is not a known participant id`,
      });
    }
    if (!ids.has(message.to)) {
      errors.push({
        path: `/messages/${index}/to`,
        message: `Message recipient "${message.to}" is not a known participant id`,
      });
    }
  });
  return errors;
}
