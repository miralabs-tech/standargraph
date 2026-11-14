import { FONT_METRICS, type FontWeight } from "../layout/font-metrics";
import { LINE_HEIGHT, measureText } from "../layout/measure";
import {
  CAPTION_FONT,
  EDGE_LABEL_FONT,
  GROUP_FONT,
  LABEL_FONT,
  PAD_X,
  round,
  SELF_LOOP_HEIGHT,
  SELF_LOOP_WIDTH,
} from "../layout/shared";
import type {
  Box,
  LaidOut,
  LaidOutEdge,
  LaidOutGraph,
  LaidOutGroup,
  LaidOutMessage,
  LaidOutNode,
  LaidOutParticipant,
  LaidOutSequence,
} from "../layout/types";
import type { Meta } from "../format";

export type RenderOptions = {
  theme?: "light" | "dark";
  standalone?: boolean;
  styles?: boolean;
  idPrefix?: string;
};

type Theme = {
  bg: string;
  fg: string;
  muted: string;
  nodeFill: string;
  nodeStroke: string;
  unknownFill: string;
  groupFill: string;
  groupStroke: string;
  edge: string;
  labelBg: string;
  accent: string;
  lifeline: string;
};

const THEMES: Record<"light" | "dark", Theme> = {
  light: {
    bg: "#ffffff",
    fg: "#1f2430",
    muted: "#6b7280",
    nodeFill: "#ffffff",
    nodeStroke: "#475569",
    unknownFill: "#f1f5f9",
    groupFill: "#f1f5f9",
    groupStroke: "#cbd5e1",
    edge: "#475569",
    labelBg: "#ffffff",
    accent: "#2563eb",
    lifeline: "#94a3b8",
  },
  dark: {
    bg: "#0f172a",
    fg: "#e2e8f0",
    muted: "#94a3b8",
    nodeFill: "#1e293b",
    nodeStroke: "#94a3b8",
    unknownFill: "#111827",
    groupFill: "#162033",
    groupStroke: "#334155",
    edge: "#94a3b8",
    labelBg: "#0f172a",
    accent: "#60a5fa",
    lifeline: "#475569",
  },
};

const DASH = { inferred: "6 4", unknown: "2 3", reply: "5 3" } as const;

const INVALID_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;
const UNSAFE_HREF = /^[\s\u0000-\u001f]*(javascript|data|vbscript):/i;

function esc(value: string): string {
  return value
    .replace(INVALID_XML, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function n(value: number): string {
  return String(round(value));
}

function baseline(top: number, size: number, weight: FontWeight): number {
  const metrics = FONT_METRICS[weight];
  const ascent = (metrics.ascender / metrics.unitsPerEm) * size;
  const descent = (-metrics.descender / metrics.unitsPerEm) * size;
  return top + (LINE_HEIGHT * size - (ascent + descent)) / 2 + ascent;
}

type TextStyle = { size: number; weight: FontWeight };

function textLines(
  text: string,
  x: number,
  top: number,
  style: TextStyle,
  cls: string,
  fill: string,
  anchor: "start" | "middle" = "middle",
): string {
  return text
    .split("\n")
    .map((line, index) => {
      const y = baseline(top + index * LINE_HEIGHT * style.size, style.size, style.weight);
      const weight = style.weight === "semibold" ? ' font-weight="600"' : "";
      return `<text class="${cls}" x="${n(x)}" y="${n(y)}" text-anchor="${anchor}" font-size="${style.size}"${weight} fill="${fill}">${esc(line)}</text>`;
    })
    .join("");
}

function metaTitle(meta: Meta | undefined): string {
  if (meta === undefined) return "";
  const lines: string[] = [];
  const provenance = meta.provenance;
  if (provenance !== undefined) {
    const confidence =
      provenance.confidence === undefined ? "" : ` (${provenance.confidence})`;
    lines.push(`Source: ${provenance.source}${confidence}`);
    if (provenance.tool !== undefined) lines.push(`Tool: ${provenance.tool}`);
  }
  if (meta.coverage !== undefined) {
    lines.push(`Coverage: ${round(meta.coverage * 100)}%`);
  }
  if (meta.freshness !== undefined) lines.push(`Freshness: ${meta.freshness}`);
  if (lines.length === 0) return "";
  return `<title>${esc(lines.join("\n"))}</title>`;
}

function confidenceOf(meta: Meta | undefined): string | undefined {
  return meta?.provenance?.confidence;
}

function dashAttr(dash: string | undefined): string {
  return dash === undefined ? "" : ` stroke-dasharray="${dash}"`;
}

function confidenceDash(meta: Meta | undefined): string | undefined {
  const confidence = confidenceOf(meta);
  if (confidence === "inferred") return DASH.inferred;
  if (confidence === "unknown") return DASH.unknown;
  return undefined;
}

function variables(theme: Theme): string {
  return `--sg-bg:${theme.bg};--sg-fg:${theme.fg};--sg-muted:${theme.muted};--sg-node-fill:${theme.nodeFill};--sg-node-stroke:${theme.nodeStroke};--sg-unknown-fill:${theme.unknownFill};--sg-group-fill:${theme.groupFill};--sg-group-stroke:${theme.groupStroke};--sg-edge:${theme.edge};--sg-label-bg:${theme.labelBg};--sg-accent:${theme.accent};--sg-lifeline:${theme.lifeline}`;
}

export function themeVariables(name: "light" | "dark"): string {
  return variables(THEMES[name]);
}

function css(theme: Theme): string {
  return [
    `.sg-root{${variables(theme)}}`,
    ".sg-bg{fill:var(--sg-bg)}",
    ".sg-text{fill:var(--sg-fg)}",
    ".sg-muted{fill:var(--sg-muted)}",
    ".sg-node{fill:var(--sg-node-fill);stroke:var(--sg-node-stroke)}",
    ".sg-node.sg-unknown{fill:var(--sg-unknown-fill)}",
    ".sg-group{fill:var(--sg-group-fill);stroke:var(--sg-group-stroke)}",
    ".sg-edge{stroke:var(--sg-edge)}",
    ".sg-arrow-filled{fill:var(--sg-edge);stroke:var(--sg-edge)}",
    ".sg-arrow-open{stroke:var(--sg-edge)}",
    ".sg-label-bg{fill:var(--sg-label-bg)}",
    ".sg-accent{fill:var(--sg-accent)}",
    ".sg-lifeline{stroke:var(--sg-lifeline)}",
  ].join("");
}

function defs(theme: Theme, styles: boolean): string {
  return [
    "<defs>",
    styles ? `<style>${css(theme)}</style>` : "",
    `<marker id="sg-arrow-filled" viewBox="0 0 10 10" refX="10" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto"><path class="sg-arrow-filled" d="M0,0 L10,5 L0,10 z" fill="${theme.edge}" stroke="${theme.edge}" stroke-width="1" stroke-linejoin="round"/></marker>`,
    `<marker id="sg-arrow-open" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto"><path class="sg-arrow-open" d="M1,1 L9,5 L1,9" fill="none" stroke="${theme.edge}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker>`,
    "</defs>",
  ].join("");
}

function wrapLink(content: string, link: string | undefined): string {
  if (link === undefined || link === "" || UNSAFE_HREF.test(link)) {
    return content;
  }
  return `<a href="${esc(link)}">${content}</a>`;
}

function group(kind: string, id: string, meta: Meta | undefined, body: string): string {
  return `<g data-kind="${kind}" data-id="${esc(id)}">${metaTitle(meta)}${body}</g>`;
}

function labelBoxSvg(
  box: Box,
  text: string,
  theme: Theme,
  withBackground: boolean,
): string {
  const lines = text.split("\n").length;
  const textHeight = lines * LINE_HEIGHT * EDGE_LABEL_FONT.size;
  const top = box.y + (box.height - textHeight) / 2;
  const background = withBackground
    ? `<rect class="sg-label-bg" x="${n(box.x)}" y="${n(box.y)}" width="${n(box.width)}" height="${n(box.height)}" rx="3" fill="${theme.labelBg}"/>`
    : "";
  return (
    background +
    textLines(
      text,
      box.x + box.width / 2,
      top,
      EDGE_LABEL_FONT,
      "sg-text",
      theme.fg,
    )
  );
}

function renderGroup(item: LaidOutGroup, theme: Theme): string {
  const dash = confidenceDash(item.meta);
  const rect = `<rect class="sg-group" x="${n(item.x)}" y="${n(item.y)}" width="${n(item.width)}" height="${n(item.height)}" rx="10" fill="${theme.groupFill}" stroke="${theme.groupStroke}" stroke-width="1"${dashAttr(dash)}/>`;
  const label =
    item.label === undefined || item.label === ""
      ? ""
      : textLines(
          item.label,
          item.x + PAD_X,
          item.y + 8,
          GROUP_FONT,
          "sg-muted",
          theme.muted,
          "start",
        );
  return group("group", item.id, item.meta, rect + label);
}

function pathOf(points: readonly { x: number; y: number }[]): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${n(point.x)},${n(point.y)}`)
    .join(" ");
}

function renderEdge(item: LaidOutEdge, theme: Theme): string {
  const dash = confidenceDash(item.meta);
  const marker = item.directed ? ' marker-end="url(#sg-arrow-filled)"' : "";
  const path = `<path class="sg-edge" d="${pathOf(item.points)}" fill="none" stroke="${theme.edge}" stroke-width="1.5" stroke-linejoin="round"${dashAttr(dash)}${marker}/>`;
  const label =
    item.labelBox === undefined || item.label === undefined
      ? ""
      : labelBoxSvg(item.labelBox, item.label, theme, true);
  return group("edge", item.id, item.meta, path + label);
}

function renderNode(item: LaidOutNode, index: number, theme: Theme): string {
  const confidence = confidenceOf(item.meta);
  const dash = confidenceDash(item.meta);
  const unknown = confidence === "unknown";
  const fill = unknown ? theme.unknownFill : theme.nodeFill;
  const cls = unknown ? "sg-node sg-unknown" : "sg-node";
  let body = `<rect class="${cls}" x="${n(item.x)}" y="${n(item.y)}" width="${n(item.width)}" height="${n(item.height)}" rx="8" fill="${fill}" stroke="${theme.nodeStroke}" stroke-width="1.5"${dashAttr(dash)}/>`;

  const label = measureText(item.label, LABEL_FONT);
  const caption =
    item.type === undefined ? undefined : measureText(item.type, CAPTION_FONT);
  const block = label.height + (caption?.height ?? 0);
  const top = item.y + (item.height - block) / 2;
  const cx = item.x + item.width / 2;
  body += textLines(item.label, cx, top, LABEL_FONT, "sg-text", theme.fg);
  if (item.type !== undefined) {
    body += textLines(
      item.type,
      cx,
      top + label.height,
      CAPTION_FONT,
      "sg-muted",
      theme.muted,
    );
  }

  const coverage = item.meta?.coverage;
  if (coverage !== undefined) {
    const clip = `sg-clip-${index}`;
    body =
      `<clipPath id="${clip}"><rect x="${n(item.x)}" y="${n(item.y)}" width="${n(item.width)}" height="${n(item.height)}" rx="8"/></clipPath>` +
      body +
      `<rect class="sg-accent" x="${n(item.x)}" y="${n(item.y + item.height - 4)}" width="${n(coverage * item.width)}" height="4" fill="${theme.accent}" clip-path="url(#${clip})"/>`;
  }

  return wrapLink(group("node", item.id, item.meta, body), item.link);
}

function renderGraph(laid: LaidOutGraph, theme: Theme): string {
  return [
    ...laid.groups.map((item) => renderGroup(item, theme)),
    ...laid.edges.map((item) => renderEdge(item, theme)),
    ...laid.nodes.map((item, index) => renderNode(item, index, theme)),
  ].join("");
}

function renderParticipant(
  item: LaidOutParticipant,
  lifelineBottom: number,
  theme: Theme,
): string {
  const lifeline = `<line class="sg-lifeline" x1="${n(item.lifelineX)}" y1="${n(item.y + item.height)}" x2="${n(item.lifelineX)}" y2="${n(lifelineBottom)}" stroke="${theme.lifeline}" stroke-width="1" stroke-dasharray="4 4"/>`;
  const confidence = confidenceOf(item.meta);
  const unknown = confidence === "unknown";
  const fill = unknown ? theme.unknownFill : theme.nodeFill;
  const cls = unknown ? "sg-node sg-unknown" : "sg-node";
  let body = `<rect class="${cls}" x="${n(item.x)}" y="${n(item.y)}" width="${n(item.width)}" height="${n(item.height)}" rx="8" fill="${fill}" stroke="${theme.nodeStroke}" stroke-width="1.5"${dashAttr(confidenceDash(item.meta))}/>`;
  const label = measureText(item.label, LABEL_FONT);
  const caption =
    item.type === undefined ? undefined : measureText(item.type, CAPTION_FONT);
  const top = item.y + (item.height - label.height - (caption?.height ?? 0)) / 2;
  const cx = item.x + item.width / 2;
  body += textLines(item.label, cx, top, LABEL_FONT, "sg-text", theme.fg);
  if (item.type !== undefined) {
    body += textLines(
      item.type,
      cx,
      top + label.height,
      CAPTION_FONT,
      "sg-muted",
      theme.muted,
    );
  }
  return group("participant", item.id, item.meta, lifeline + body);
}

function renderMessage(item: LaidOutMessage, theme: Theme): string {
  const dash =
    confidenceDash(item.meta) ?? (item.style === "reply" ? DASH.reply : undefined);
  const marker =
    item.style === "sync" ? "url(#sg-arrow-filled)" : "url(#sg-arrow-open)";
  const d = item.self
    ? `M${n(item.x1)},${n(item.y)} H${n(item.x1 + SELF_LOOP_WIDTH)} V${n(item.y + SELF_LOOP_HEIGHT)} H${n(item.x1)}`
    : `M${n(item.x1)},${n(item.y)} L${n(item.x2)},${n(item.y)}`;
  const path = `<path class="sg-edge" d="${d}" fill="none" stroke="${theme.edge}" stroke-width="1.5" stroke-linejoin="round"${dashAttr(dash)} marker-end="${marker}"/>`;
  const label =
    item.labelBox === undefined || item.label === undefined
      ? ""
      : labelBoxSvg(item.labelBox, item.label, theme, false);
  return group("message", String(item.index), item.meta, path + label);
}

function renderSequence(laid: LaidOutSequence, theme: Theme): string {
  return [
    ...laid.participants.map((item) =>
      renderParticipant(item, laid.lifelineBottom, theme),
    ),
    ...laid.messages.map((item) => renderMessage(item, theme)),
  ].join("");
}

export function renderSvg(laidOut: LaidOut, options: RenderOptions = {}): string {
  const theme = THEMES[options.theme ?? "light"];
  const standalone = options.standalone ?? true;
  const width = n(laidOut.width);
  const height = n(laidOut.height);
  const head = standalone
    ? `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"`
    : "<svg";
  const title =
    laidOut.title === undefined ? "" : `<title>${esc(laidOut.title)}</title>`;
  const body =
    laidOut.kind === "graph"
      ? renderGraph(laidOut, theme)
      : renderSequence(laidOut, theme);
  const svg = [
    `${head} class="sg-root" version="1.1" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="Inter, system-ui, sans-serif">`,
    title,
    defs(theme, options.styles ?? true),
    `<rect class="sg-bg" x="0" y="0" width="${width}" height="${height}" fill="${theme.bg}"/>`,
    body,
    "</svg>",
    "",
  ]
    .filter((part, index, all) => part !== "" || index === all.length - 1)
    .join("\n");
  const prefix = options.idPrefix;
  if (prefix === undefined || prefix === "sg") return svg;
  return svg
    .replaceAll('id="sg-', `id="${esc(prefix)}-`)
    .replaceAll("url(#sg-", `url(#${esc(prefix)}-`);
}
