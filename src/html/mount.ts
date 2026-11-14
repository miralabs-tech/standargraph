import { WEBGL_THRESHOLD } from "../core/threshold";
import type { View } from "../core/view";
import { type Document, validate } from "../format";
import { layout } from "../layout";
import type { LaidOut } from "../layout/types";
import { formatErrors } from "../shared/errors";
import { renderSvg } from "../svg/render";
import { lightTheme, type PageThemeOption, themeStyle } from "../svg/theme";
import { appMarkup, STYLE, svgViewport, WEBGL_VIEWPORT } from "./shell";
import { withScope } from "./ui";

export type MountOptions = {
  theme?: PageThemeOption;
  title?: string;
  renderer?: "auto" | "svg" | "webgl";
};

export type Mounted = { view: View; destroy(): void };

type WorkerReply = { ok: true; scene: LaidOut } | { ok: false; message: string };

async function layoutInWorker(document: Document): Promise<LaidOut> {
  const { LAYOUT_WORKER_JS } = await import("./layout-worker.generated");
  const url = URL.createObjectURL(new Blob([LAYOUT_WORKER_JS], { type: "text/javascript" }));
  const worker = new Worker(url);
  return new Promise((resolve, reject) => {
    const finish = () => {
      worker.terminate();
      URL.revokeObjectURL(url);
    };
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      finish();
      if (event.data.ok) resolve(event.data.scene);
      else reject(new Error(event.data.message));
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message));
    };
    worker.postMessage(document);
  });
}

function hasPositions(document: Document): boolean {
  return (
    document.kind === "graph" &&
    document.nodes.length > 0 &&
    document.nodes.every((node) => node.position !== undefined)
  );
}

export async function mount(
  container: HTMLElement,
  input: unknown,
  options: MountOptions = {},
): Promise<Mounted> {
  const result = validate(input);
  if (!result.ok) throw new Error(`Invalid document:\n${formatErrors(result.errors)}`);
  const document = result.document;
  const needsWorker =
    (document.kind === "graph" && !hasPositions(document)) ||
    document.kind === "state" ||
    document.kind === "er";
  const scene = needsWorker ? await layoutInWorker(document) : await layout(document);

  const renderer = options.renderer ?? "auto";
  const useWebgl =
    scene.kind === "graph" &&
    (renderer === "webgl" || (renderer === "auto" && scene.nodes.length > WEBGL_THRESHOLD));
  const theme = options.theme ?? "auto";
  const title = options.title ?? scene.title ?? "Standargraph";
  const viewport = useWebgl
    ? WEBGL_VIEWPORT
    : svgViewport(
        renderSvg(scene, { theme: lightTheme(theme), standalone: false }).trim(),
      );

  const style = globalThis.document.createElement("style");
  style.textContent = STYLE + themeStyle(theme);
  container.classList.add("sg-mount");
  if (getComputedStyle(container).position === "static") container.style.position = "relative";
  container.replaceChildren(style);
  container.insertAdjacentHTML("beforeend", appMarkup(title, viewport));

  const start = useWebgl
    ? (await import("../webgl/adapter")).startWebgl
    : (await import("./svg-adapter")).startSvg;
  const started = withScope(container, () => start(document, scene));
  if (started === undefined) throw new Error("Nothing to render");
  return {
    view: started.view,
    destroy() {
      started.destroy();
      container.replaceChildren();
      container.classList.remove("sg-mount");
    },
  };
}
