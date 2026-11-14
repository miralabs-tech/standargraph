import type { Document } from "../format";
import type { LaidOut } from "../layout/types";
import { loadFonts } from "../shared/package-root";
import { appMarkup, escapeHtml, type PageOptions, STYLE, themeStyle } from "./shell";

export type { PageOptions } from "./shell";

export function escapeScript(value: string): string {
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

export function withPositions(document: Document, laidOut: LaidOut): Document {
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

export type PageContent = {
  document: Document;
  laidOut: LaidOut;
  options: PageOptions;
  viewport: string;
  runtime: string;
};

export function renderPage(content: PageContent): string {
  const { document, laidOut, options } = content;
  const theme = options.theme ?? "auto";
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
    appMarkup(title, content.viewport),
    `<script type="application/json" id="standargraph-document">${json}</script>`,
    `<script type="application/json" id="standargraph-scene">${scene}</script>`,
    `<script>${escapeScript(content.runtime)}</script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
