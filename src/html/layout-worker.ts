import { validate } from "../format/validate";
import { layoutGraph } from "../layout/graph";
import { layoutSequence } from "../layout/sequence";
import { formatErrors } from "../shared/errors";

const scope = globalThis as unknown as {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown): void;
};

scope.onmessage = async (event) => {
  try {
    const result = validate(event.data);
    if (!result.ok) throw new Error(`Invalid document:\n${formatErrors(result.errors)}`);
    const document = result.document;
    const scene = document.kind === "graph" ? await layoutGraph(document) : await layoutSequence(document);
    scope.postMessage({ ok: true, scene });
  } catch (error) {
    scope.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) });
  }
};
