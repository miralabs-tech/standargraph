import type { Document } from "../format";
import type { LaidOut } from "../layout/types";
import { renderPage } from "../html/page";
import { type PageOptions, WEBGL_VIEWPORT } from "../html/shell";
import { WEBGL_RUNTIME_JS } from "./runtime.generated";

export { WEBGL_THRESHOLD } from "../core/threshold";
export { VERSION } from "../version";

export type WebglOptions = PageOptions;

export function renderWebglHtml(
  document: Document,
  laidOut: LaidOut,
  options: WebglOptions = {},
): string {
  return renderPage({
    document,
    laidOut,
    options,
    viewport: WEBGL_VIEWPORT,
    runtime: WEBGL_RUNTIME_JS,
  });
}
