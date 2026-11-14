import { DocumentSchema } from "./schema";

export function buildJsonSchema(): Record<string, unknown> {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    ...JSON.parse(JSON.stringify(DocumentSchema)),
  };
}

export function renderJsonSchema(): string {
  return `${JSON.stringify(buildJsonSchema(), null, 2)}\n`;
}
