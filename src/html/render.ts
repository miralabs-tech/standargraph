import type { Document } from "../format";
import type { LaidOut } from "../layout/types";
import { loadFonts } from "../shared/package-root";
import { renderSvg, themeVariables } from "../svg/render";
import { RUNTIME_JS } from "./runtime.generated";

export type HtmlOptions = {
  theme?: "light" | "dark" | "auto";
  title?: string;
};

const STYLE = [
  "*{box-sizing:border-box}",
  "html,body{margin:0;height:100%}",
  "body{font-family:Inter,system-ui,sans-serif;font-size:14px}",
  "#sg-app{position:fixed;inset:0;display:flex;flex-direction:column;background:var(--sg-bg);color:var(--sg-fg)}",
  "#sg-toolbar{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--sg-group-stroke);background:var(--sg-group-fill)}",
  "#sg-toolbar .sg-title{flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  "#sg-toolbar input,#sg-toolbar button{font:inherit;color:inherit;background:var(--sg-bg);border:1px solid var(--sg-group-stroke);border-radius:6px;padding:4px 10px}",
  "#sg-toolbar button{cursor:pointer;min-width:32px}",
  "#sg-toolbar button:hover{border-color:var(--sg-accent)}",
  "#sg-viewport{position:relative;flex:1;overflow:hidden;cursor:grab;touch-action:none;user-select:none}",
  "#sg-viewport.sg-dragging{cursor:grabbing}",
  "#sg-stage{position:absolute;left:0;top:0;transform-origin:0 0}",
  "#sg-stage svg{display:block}",
  "#sg-stage [data-kind=node],#sg-stage [data-kind=edge],#sg-stage [data-kind=participant],#sg-stage [data-kind=message]{cursor:pointer}",
  "#sg-stage .sg-focus [data-kind]:not(.sg-hl){opacity:.25}",
  "#sg-stage .sg-lod-nolabels .sg-label,#sg-stage .sg-lod-nocaptions .sg-caption,#sg-stage .sg-lod-noedgelabels .sg-edge-label{display:none}",
  "#sg-stage .sg-selected{filter:drop-shadow(0 0 3px var(--sg-accent))}",
  "#sg-panel{position:absolute;top:56px;right:12px;bottom:12px;width:320px;max-width:calc(100% - 24px);overflow:auto;padding:16px;background:var(--sg-bg);border:1px solid var(--sg-group-stroke);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.2)}",
  "#sg-panel[hidden]{display:none}",
  "#sg-panel h2{margin:0 24px 12px 0;font-size:16px;overflow-wrap:anywhere}",
  "#sg-panel .sg-close{position:absolute;top:8px;right:8px;font:inherit;font-size:18px;line-height:1;color:inherit;background:none;border:0;cursor:pointer}",
  "#sg-panel dl{margin:0}",
  "#sg-panel dt{margin-top:10px;font-size:12px;color:var(--sg-muted)}",
  "#sg-panel dd{margin:2px 0 0;overflow-wrap:anywhere}",
  "#sg-panel a{color:var(--sg-accent)}",
  "#sg-panel .sg-data{border-collapse:collapse;width:100%}",
  "#sg-panel .sg-data th,#sg-panel .sg-data td{padding:2px 6px;border:1px solid var(--sg-group-stroke);text-align:left;vertical-align:top}",
].join("");

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeScript(value: string): string {
  return value.replace(/<\//g, "<\\/").replace(/<!--/g, "\\u003c!--");
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function fontFaces(): string {
  const fonts = loadFonts();
  const face = (weight: number, bytes: Uint8Array) =>
    `@font-face{font-family:Inter;font-style:normal;font-weight:${weight};src:url(data:font/ttf;base64,${base64(bytes)}) format("truetype")}`;
  return face(400, fonts.regular) + face(600, fonts.semibold);
}

function themeStyle(theme: "light" | "dark" | "auto"): string {
  const selector = "#sg-app,#sg-app .sg-root";
  if (theme === "auto") {
    return `${selector}{${themeVariables("light")}}@media (prefers-color-scheme:dark){${selector}{${themeVariables("dark")}}}`;
  }
  return `${selector}{${themeVariables(theme)}}`;
}

function withPositions(document: Document, laidOut: LaidOut): Document {
  if (document.kind !== "graph" || laidOut.kind !== "graph") return document;
  const positions = new Map(
    laidOut.nodes.map((node) => [node.id, { x: node.x, y: node.y }]),
  );
  return {
    ...document,
    nodes: document.nodes.map((node) => ({
      ...node,
      position: positions.get(node.id) ?? node.position,
    })),
  };
}

export function renderHtml(
  document: Document,
  laidOut: LaidOut,
  options: HtmlOptions = {},
): string {
  const theme = options.theme ?? "auto";
  const svg = renderSvg(laidOut, {
    theme: theme === "dark" ? "dark" : "light",
    standalone: false,
  }).trim();
  const title = options.title ?? laidOut.title ?? "Standargraph";
  const json = escapeScript(JSON.stringify(withPositions(document, laidOut)));
  const scene = escapeScript(JSON.stringify(laidOut));
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${fontFaces()}${STYLE}${themeStyle(theme)}</style>`,
    "</head>",
    "<body>",
    '<div id="sg-app">',
    '<header id="sg-toolbar">',
    `<span class="sg-title">${escapeHtml(title)}</span>`,
    '<input id="sg-search" type="search" placeholder="Search" aria-label="Search">',
    '<button id="sg-zoom-out" type="button" aria-label="Zoom out">−</button>',
    '<button id="sg-zoom-in" type="button" aria-label="Zoom in">+</button>',
    '<button id="sg-fit" type="button">Fit</button>',
    "</header>",
    `<main id="sg-viewport"><div id="sg-stage">${svg}</div></main>`,
    '<aside id="sg-panel" hidden></aside>',
    "</div>",
    `<script type="application/json" id="standargraph-document">${json}</script>`,
    `<script type="application/json" id="standargraph-scene">${scene}</script>`,
    `<script>${escapeScript(RUNTIME_JS)}</script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
