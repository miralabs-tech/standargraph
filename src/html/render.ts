import { WEBGL_THRESHOLD } from "../core/threshold";
import type { Document } from "../format";
import type { LaidOut } from "../layout/types";
import { renderSvg } from "../svg/render";
import { lightTheme } from "../svg/theme";
import { renderWebglHtml } from "../webgl";
import { renderPage } from "./page";
import { RUNTIME_JS } from "./runtime.generated";
import { type PageOptions, svgViewport } from "./shell";

export type HtmlOptions = PageOptions & {
  renderer?: "auto" | "svg" | "webgl";
};

export function renderHtml(
  document: Document,
  laidOut: LaidOut,
  options: HtmlOptions = {},
): string {
  const renderer = options.renderer ?? "auto";
  const useWebgl =
    laidOut.kind === "graph" &&
    (renderer === "webgl" || (renderer === "auto" && laidOut.nodes.length > WEBGL_THRESHOLD));
  if (useWebgl) return renderWebglHtml(document, laidOut, options);
  const theme = options.theme ?? "auto";
  const svg = renderSvg(laidOut, {
    theme: lightTheme(theme),
    standalone: false,
  }).trim();
  return renderPage({
    document,
    laidOut,
    options,
    viewport: svgViewport(svg),
    runtime: RUNTIME_JS,
  });
}
