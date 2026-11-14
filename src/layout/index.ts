import { validate } from "../format";
import { layoutGraph } from "./graph";
import { layoutSequence } from "./sequence";
import type { LaidOut } from "./types";

export { VERSION } from "../version";
export { measureText, type TextOptions } from "./measure";
export type * from "./types";

export async function layout(document: unknown): Promise<LaidOut> {
  const result = validate(document);
  if (!result.ok) {
    const lines = result.errors.map(
      (error) => `${error.path === "" ? "/" : error.path}: ${error.message}`,
    );
    throw new Error(`Invalid document:\n${lines.join("\n")}`);
  }
  const doc = result.document;
  switch (doc.kind) {
    case "graph":
      return layoutGraph(doc);
    case "sequence":
      return layoutSequence(doc);
    default:
      return unreachable(doc);
  }
}

function unreachable(value: never): never {
  throw new Error(`Unsupported document: ${JSON.stringify(value)}`);
}
