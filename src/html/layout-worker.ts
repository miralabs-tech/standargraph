import { layout } from "../layout";

const scope = globalThis as unknown as {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown): void;
};

scope.onmessage = async (event) => {
  try {
    const scene = await layout(event.data);
    scope.postMessage({ ok: true, scene });
  } catch (error) {
    scope.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) });
  }
};
