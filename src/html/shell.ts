import { themeVariables } from "../svg/render";

export type PageOptions = {
  theme?: "light" | "dark" | "auto";
  title?: string;
};

export const STYLE = [
  "*{box-sizing:border-box}",
  "html,body{margin:0;height:100%}",
  "body{font-family:Inter,system-ui,sans-serif;font-size:14px}",
  ".sg-app{position:fixed;inset:0;display:flex;flex-direction:column;background:var(--sg-bg);color:var(--sg-fg)}",
  ".sg-toolbar{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--sg-group-stroke);background:var(--sg-group-fill)}",
  ".sg-toolbar .sg-title{flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".sg-toolbar input,.sg-toolbar button{font:inherit;color:inherit;background:var(--sg-bg);border:1px solid var(--sg-group-stroke);border-radius:6px;padding:4px 10px}",
  ".sg-toolbar button{cursor:pointer;min-width:32px}",
  ".sg-toolbar button:hover{border-color:var(--sg-accent)}",
  ".sg-viewport{position:relative;flex:1;overflow:hidden;cursor:grab;touch-action:none;user-select:none}",
  ".sg-viewport.sg-dragging{cursor:grabbing}",
  ".sg-stage{position:absolute;left:0;top:0;transform-origin:0 0}",
  ".sg-stage svg{display:block}",
  ".sg-groups,.sg-gl{position:absolute;inset:0;width:100%;height:100%}",
  ".sg-mount .sg-app{position:absolute}",
  ".sg-stage [data-kind=node],.sg-stage [data-kind=edge],.sg-stage [data-kind=participant],.sg-stage [data-kind=message]{cursor:pointer}",
  ".sg-stage .sg-focus [data-kind]:not(.sg-hl){opacity:.25}",
  ".sg-stage .sg-lod-nolabels .sg-label,.sg-stage .sg-lod-nocaptions .sg-caption,.sg-stage .sg-lod-noedgelabels .sg-edge-label{display:none}",
  ".sg-stage .sg-selected{filter:drop-shadow(0 0 3px var(--sg-accent))}",
  ".sg-panel{position:absolute;top:56px;right:12px;bottom:12px;width:320px;max-width:calc(100% - 24px);overflow:auto;padding:16px;background:var(--sg-bg);border:1px solid var(--sg-group-stroke);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.2)}",
  ".sg-panel[hidden]{display:none}",
  ".sg-panel h2{margin:0 24px 12px 0;font-size:16px;overflow-wrap:anywhere}",
  ".sg-panel .sg-close{position:absolute;top:8px;right:8px;font:inherit;font-size:18px;line-height:1;color:inherit;background:none;border:0;cursor:pointer}",
  ".sg-panel dl{margin:0}",
  ".sg-panel dt{margin-top:10px;font-size:12px;color:var(--sg-muted)}",
  ".sg-panel dd{margin:2px 0 0;overflow-wrap:anywhere}",
  ".sg-panel a{color:var(--sg-accent)}",
  ".sg-panel .sg-data{border-collapse:collapse;width:100%}",
  ".sg-panel .sg-data th,.sg-panel .sg-data td{padding:2px 6px;border:1px solid var(--sg-group-stroke);text-align:left;vertical-align:top}",
].join("");

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function themeStyle(theme: "light" | "dark" | "auto"): string {
  const selector = ".sg-app,.sg-app .sg-root";
  if (theme === "auto") {
    return `${selector}{${themeVariables("light")}}@media (prefers-color-scheme:dark){${selector}{${themeVariables("dark")}}}`;
  }
  return `${selector}{${themeVariables(theme)}}`;
}

export function svgViewport(svg: string): string {
  return `<main class="sg-viewport"><div class="sg-stage">${svg}</div></main>`;
}

export const WEBGL_VIEWPORT =
  '<main class="sg-viewport"><canvas class="sg-groups"></canvas><div class="sg-gl"></div></main>';

export function appMarkup(title: string, viewport: string): string {
  return [
    '<div class="sg-app">',
    '<header class="sg-toolbar">',
    `<span class="sg-title">${escapeHtml(title)}</span>`,
    '<input class="sg-search" type="search" placeholder="Search" aria-label="Search">',
    '<button class="sg-zoom-out" type="button" aria-label="Zoom out">−</button>',
    '<button class="sg-zoom-in" type="button" aria-label="Zoom in">+</button>',
    '<button class="sg-fit" type="button">Fit</button>',
    "</header>",
    viewport,
    '<aside class="sg-panel" hidden></aside>',
    "</div>",
  ].join("\n");
}
