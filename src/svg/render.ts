import { FONT_METRICS, type FontWeight } from "../layout/font-metrics";
import { LINE_HEIGHT, measureText } from "../layout/measure";
import {
  ACTIONS_GAP,
  attributeTypeText,
  boxSize,
  CAPTION_FONT,
  EDGE_LABEL_FONT,
  GROUP_FONT,
  keysText,
  LABEL_FONT,
  PAD_X,
  round,
  SELF_LOOP_HEIGHT,
  SELF_LOOP_WIDTH,
} from "../layout/shared";
import {
  CYLINDER_RY,
  DOCUMENT_WAVE,
  outline,
  SUBROUTINE_BAR,
  textOffsetY,
} from "../layout/shapes";
import type {
  Box,
  LaidOut,
  LaidOutAttribute,
  LaidOutEdge,
  LaidOutEntity,
  LaidOutEr,
  LaidOutGraph,
  LaidOutGroup,
  LaidOutMessage,
  LaidOutNode,
  LaidOutParticipant,
  LaidOutRelation,
  LaidOutSequence,
  LaidOutState,
  LaidOutStateMachine,
  LaidOutTransition,
  LaidOutTree,
  LaidOutTreeEdge,
  LaidOutTreeNode,
  Point,
} from "../layout/types";
import type { Cardinality, Meta, Shape } from "../format";
import { esc } from "./escape";
import {
  type EffectiveTheme,
  edgeTypeRules,
  edgeTypesPresent,
  type EdgeTypeStyle,
  escapedTheme,
  resolveTheme,
  type ThemeOption,
  type ThemeTokens,
  themeVariables,
  type TypeStyle,
  typeRules,
  typesPresent,
  withPalette,
} from "./theme";

export type RenderOptions = {
  theme?: ThemeOption;
  standalone?: boolean;
  styles?: boolean;
  idPrefix?: string;
};

type Theme = ThemeTokens;
type Types = Record<string, TypeStyle>;

function typeStyleOf(types: Types, type: string | undefined): TypeStyle {
  return type !== undefined && Object.hasOwn(types, type) ? types[type]! : {};
}

const DASH = { inferred: "6 4", unknown: "2 3", reply: "5 3" } as const;

const UNSAFE_HREF = /^[\s\u0000-\u001f]*(javascript|data|vbscript):/i;

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

function css(
  tokens: ThemeTokens,
  types: Types,
  edgeTypes: Record<string, EdgeTypeStyle>,
): string {
  return [
    `.sg-root{${themeVariables({ tokens })}}`,
    ".sg-bg{fill:var(--sg-bg)}",
    ".sg-text{fill:var(--sg-fg)}",
    ".sg-muted{fill:var(--sg-muted)}",
    ".sg-node{fill:var(--sg-node-fill);stroke:var(--sg-node-stroke)}",
    ".sg-node.sg-unknown{fill:var(--sg-unknown-fill)}",
    ".sg-node-detail{fill:none;stroke:var(--sg-node-stroke)}",
    ".sg-divider{stroke:var(--sg-node-stroke)}",
    ".sg-header{fill:var(--sg-header-fill)}",
    ".sg-pseudo{fill:var(--sg-fg)}",
    ".sg-group{fill:var(--sg-group-fill);stroke:var(--sg-group-stroke)}",
    ".sg-edge{stroke:var(--sg-edge)}",
    ".sg-arrow-filled{fill:var(--sg-edge);stroke:var(--sg-edge)}",
    ".sg-arrow-open{stroke:var(--sg-edge)}",
    ".sg-label-bg{fill:var(--sg-label-bg)}",
    ".sg-accent{fill:var(--sg-accent)}",
    ".sg-lifeline{stroke:var(--sg-lifeline)}",
    typeRules(types, ".sg-root"),
    edgeTypeRules(edgeTypes, ".sg-root"),
  ].join("");
}

function defs(theme: Theme, resolved: EffectiveTheme, styles: boolean): string {
  return [
    "<defs>",
    styles ? `<style>${css(resolved.tokens, resolved.types, resolved.edgeTypes)}</style>` : "",
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

function data(entries: readonly (readonly [string, string | number | undefined])[]): string {
  return entries
    .filter((entry): entry is readonly [string, string | number] => entry[1] !== undefined)
    .map(([name, value]) => ` data-${name}="${esc(String(value))}"`)
    .join("");
}

function group(
  kind: string,
  id: string,
  meta: Meta | undefined,
  body: string,
  attributes = "",
): string {
  return `<g data-kind="${kind}" data-id="${esc(id)}"${attributes}>${metaTitle(meta)}${body}</g>`;
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
    ? `<rect class="sg-label-bg sg-edge-label" x="${n(box.x)}" y="${n(box.y)}" width="${n(box.width)}" height="${n(box.height)}" rx="3" fill="${theme.labelBg}"/>`
    : "";
  return (
    background +
    textLines(
      text,
      box.x + box.width / 2,
      top,
      EDGE_LABEL_FONT,
      "sg-text sg-edge-label",
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
          "sg-muted sg-label",
          theme.muted,
          "start",
        );
  return group(
    "group",
    item.id,
    item.meta,
    rect + label,
    data([
      ["confidence", confidenceOf(item.meta)],
      ["depth", item.depth],
    ]),
  );
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
  return group(
    "edge",
    item.id,
    item.meta,
    path + label,
    data([
      ["type", item.type],
      ["confidence", confidenceOf(item.meta)],
      ["from", item.from],
      ["to", item.to],
      ["directed", item.directed ? undefined : "false"],
    ]),
  );
}

type Geometry = { tag: string; attrs: string };

function shapeGeometry(shape: Shape, box: Box): Geometry {
  const { x, y, width: w, height: h } = box;
  const rect = (rx: number): Geometry => ({
    tag: "rect",
    attrs: ` x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(rx)}"`,
  });
  const polygon = (): Geometry => ({
    tag: "polygon",
    attrs: ` points="${outline(shape, box)!.map((point) => `${n(point.x)},${n(point.y)}`).join(" ")}"`,
  });
  switch (shape) {
    case "box":
      return rect(8);
    case "rect":
    case "subroutine":
      return rect(0);
    case "pill":
      return rect(h / 2);
    case "diamond":
    case "hexagon":
    case "parallelogram":
      return polygon();
    case "circle":
      return {
        tag: "circle",
        attrs: ` cx="${n(x + w / 2)}" cy="${n(y + h / 2)}" r="${n(w / 2)}"`,
      };
    case "ellipse":
      return {
        tag: "ellipse",
        attrs: ` cx="${n(x + w / 2)}" cy="${n(y + h / 2)}" rx="${n(w / 2)}" ry="${n(h / 2)}"`,
      };
    case "cylinder": {
      const arc = `A${n(w / 2)},${CYLINDER_RY} 0 0 1`;
      return {
        tag: "path",
        attrs: ` d="M${n(x)},${n(y + CYLINDER_RY)} ${arc} ${n(x + w)},${n(y + CYLINDER_RY)} V${n(y + h - CYLINDER_RY)} ${arc} ${n(x)},${n(y + h - CYLINDER_RY)} Z"`,
      };
    }
    case "document": {
      const a = DOCUMENT_WAVE;
      return {
        tag: "path",
        attrs: ` d="M${n(x)},${n(y)} H${n(x + w)} V${n(y + h - a)} C${n(x + 0.75 * w)},${n(y + h - 3 * a)} ${n(x + 0.25 * w)},${n(y + h + a)} ${n(x)},${n(y + h - a)} Z"`,
      };
    }
  }
}

function shapeDetails(shape: Shape, box: Box, theme: Theme): string {
  const { x, y, width: w, height: h } = box;
  const style = `fill="none" stroke="${theme.nodeStroke}" stroke-width="1.5"`;
  if (shape === "cylinder") {
    return `<path class="sg-node-detail" d="M${n(x)},${n(y + CYLINDER_RY)} A${n(w / 2)},${CYLINDER_RY} 0 0 0 ${n(x + w)},${n(y + CYLINDER_RY)}" ${style}/>`;
  }
  if (shape === "subroutine") {
    return [x + SUBROUTINE_BAR, x + w - SUBROUTINE_BAR]
      .map(
        (lineX) =>
          `<line class="sg-node-detail" x1="${n(lineX)}" y1="${n(y)}" x2="${n(lineX)}" y2="${n(y + h)}" ${style}/>`,
      )
      .join("");
  }
  return "";
}

function renderNode(
  item: LaidOutNode,
  index: number,
  theme: Theme,
  types: Types,
  extra: readonly (readonly [string, string | number | undefined])[] = [],
): string {
  const confidence = confidenceOf(item.meta);
  const dash = confidenceDash(item.meta);
  const unknown = confidence === "unknown";
  const typed = typeStyleOf(types, item.type);
  const fill = unknown ? theme.unknownFill : (typed.fill ?? theme.nodeFill);
  const stroke = typed.stroke ?? theme.nodeStroke;
  const cls = unknown ? "sg-node sg-unknown" : "sg-node";
  const shape = item.shape ?? "box";
  const geometry = shapeGeometry(shape, item);
  let body = `<${geometry.tag} class="${cls}"${geometry.attrs} fill="${fill}" stroke="${stroke}" stroke-width="1.5"${dashAttr(dash)}/>${shapeDetails(shape, item, theme)}`;

  const label = measureText(item.label, LABEL_FONT);
  const caption =
    item.type === undefined ? undefined : measureText(item.type, CAPTION_FONT);
  const block = label.height + (caption?.height ?? 0);
  const top = item.y + (item.height - block) / 2 + textOffsetY(shape);
  const cx = item.x + item.width / 2;
  body += textLines(item.label, cx, top, LABEL_FONT, "sg-text sg-label", typed.text ?? theme.fg);
  if (item.type !== undefined) {
    body += textLines(
      item.type,
      cx,
      top + label.height,
      CAPTION_FONT,
      "sg-muted sg-caption",
      theme.muted,
    );
  }

  const coverage = item.meta?.coverage;
  if (coverage !== undefined) {
    const clip = `sg-clip-${index}`;
    body =
      `<clipPath id="${clip}"><${geometry.tag}${geometry.attrs}/></clipPath>` +
      body +
      `<rect class="sg-accent" x="${n(item.x)}" y="${n(item.y + item.height - 4)}" width="${n(coverage * item.width)}" height="4" fill="${theme.accent}" clip-path="url(#${clip})"/>`;
  }

  return wrapLink(
    group(
      "node",
      item.id,
      item.meta,
      body,
      data([
        ["type", item.type],
        ["confidence", confidence],
        ["shape", shape],
        ...extra,
      ]),
    ),
    item.link,
  );
}

function renderGraph(laid: LaidOutGraph, theme: Theme, types: Types): string {
  return [
    ...laid.groups.map((item) => renderGroup(item, theme)),
    ...laid.edges.map((item) => renderEdge(item, theme)),
    ...laid.nodes.map((item, index) => renderNode(item, index, theme, types)),
  ].join("");
}

function renderParticipant(
  item: LaidOutParticipant,
  lifelineBottom: number,
  theme: Theme,
  types: Types,
): string {
  const lifeline = `<line class="sg-lifeline" x1="${n(item.lifelineX)}" y1="${n(item.y + item.height)}" x2="${n(item.lifelineX)}" y2="${n(lifelineBottom)}" stroke="${theme.lifeline}" stroke-width="1" stroke-dasharray="4 4"/>`;
  const confidence = confidenceOf(item.meta);
  const unknown = confidence === "unknown";
  const typed = typeStyleOf(types, item.type);
  const fill = unknown ? theme.unknownFill : (typed.fill ?? theme.nodeFill);
  const cls = unknown ? "sg-node sg-unknown" : "sg-node";
  let body = `<rect class="${cls}" x="${n(item.x)}" y="${n(item.y)}" width="${n(item.width)}" height="${n(item.height)}" rx="8" fill="${fill}" stroke="${typed.stroke ?? theme.nodeStroke}" stroke-width="1.5"${dashAttr(confidenceDash(item.meta))}/>`;
  const label = measureText(item.label, LABEL_FONT);
  const caption =
    item.type === undefined ? undefined : measureText(item.type, CAPTION_FONT);
  const top = item.y + (item.height - label.height - (caption?.height ?? 0)) / 2;
  const cx = item.x + item.width / 2;
  body += textLines(item.label, cx, top, LABEL_FONT, "sg-text sg-label", typed.text ?? theme.fg);
  if (item.type !== undefined) {
    body += textLines(
      item.type,
      cx,
      top + label.height,
      CAPTION_FONT,
      "sg-muted sg-caption",
      theme.muted,
    );
  }
  return group(
    "participant",
    item.id,
    item.meta,
    lifeline + body,
    data([
      ["type", item.type],
      ["confidence", confidence],
    ]),
  );
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
  return group(
    "message",
    String(item.index),
    item.meta,
    path + label,
    data([
      ["confidence", confidenceOf(item.meta)],
      ["from", item.from],
      ["to", item.to],
      ["style", item.style],
    ]),
  );
}

function renderSequence(laid: LaidOutSequence, theme: Theme, types: Types): string {
  return [
    ...laid.participants.map((item) =>
      renderParticipant(item, laid.lifelineBottom, theme, types),
    ),
    ...laid.messages.map((item) => renderMessage(item, theme)),
  ].join("");
}

function nodeLook(
  meta: Meta | undefined,
  type: string | undefined,
  theme: Theme,
  types: Types,
): { cls: string; paint: string; typed: TypeStyle } {
  const unknown = confidenceOf(meta) === "unknown";
  const typed = typeStyleOf(types, type);
  const fill = unknown ? theme.unknownFill : (typed.fill ?? theme.nodeFill);
  const stroke = typed.stroke ?? theme.nodeStroke;
  return {
    cls: unknown ? "sg-node sg-unknown" : "sg-node",
    paint: `fill="${fill}" stroke="${stroke}" stroke-width="1.5"${dashAttr(confidenceDash(meta))}`,
    typed,
  };
}

function actionLines(
  actions: readonly string[],
  x: number,
  top: number,
  theme: Theme,
): string {
  return actions
    .map((action, index) =>
      textLines(
        action,
        x,
        top + index * LINE_HEIGHT * CAPTION_FONT.size,
        CAPTION_FONT,
        "sg-muted sg-caption",
        theme.muted,
        "start",
      ),
    )
    .join("");
}

function pseudoBody(item: LaidOutState, theme: Theme, types: Types): string {
  const cx = item.x + item.width / 2;
  const cy = item.y + item.height / 2;
  const look = nodeLook(item.meta, item.type, theme, types);
  const circle = (r: number, cls: string, paint: string): string =>
    `<circle class="${cls}" cx="${n(cx)}" cy="${n(cy)}" r="${r}" ${paint}/>`;
  const solid = `fill="${theme.fg}"`;
  switch (item.pseudo) {
    case "initial":
      return circle(10, "sg-pseudo", solid);
    case "final":
      return circle(12, look.cls, look.paint) + circle(7, "sg-pseudo", solid);
    case "history": {
      const glyph = measureText("H", LABEL_FONT);
      return (
        circle(12, look.cls, look.paint) +
        textLines("H", cx, cy - glyph.height / 2, LABEL_FONT, "sg-text", theme.fg)
      );
    }
    case "choice": {
      const points = outline("diamond", item)!
        .map((point) => `${n(point.x)},${n(point.y)}`)
        .join(" ");
      return `<polygon class="${look.cls}" points="${points}" ${look.paint}/>`;
    }
    default:
      return `<rect class="sg-pseudo" x="${n(item.x)}" y="${n(item.y)}" width="${n(item.width)}" height="${n(item.height)}" ${solid}/>`;
  }
}

function compositeBody(item: LaidOutState, theme: Theme): string {
  const rect = `<rect class="sg-group" x="${n(item.x)}" y="${n(item.y)}" width="${n(item.width)}" height="${n(item.height)}" rx="10" fill="${theme.groupFill}" stroke="${theme.groupStroke}" stroke-width="1"${dashAttr(confidenceDash(item.meta))}/>`;
  const title = measureText(item.label, GROUP_FONT);
  const label =
    item.label === ""
      ? ""
      : textLines(
          item.label,
          item.x + PAD_X,
          item.y + 8,
          GROUP_FONT,
          "sg-muted sg-label",
          theme.muted,
          "start",
        );
  const actions = item.actions ?? [];
  return (
    rect +
    label +
    actionLines(actions, item.x + PAD_X, item.y + 8 + title.height + ACTIONS_GAP / 2, theme)
  );
}

function simpleBody(
  item: LaidOutState,
  index: number,
  theme: Theme,
  types: Types,
): string {
  const look = nodeLook(item.meta, item.type, theme, types);
  const actions = item.actions ?? [];
  const geometry: Geometry = {
    tag: "rect",
    attrs: ` x="${n(item.x)}" y="${n(item.y)}" width="${n(item.width)}" height="${n(item.height)}" rx="10"`,
  };
  let body = `<rect class="${look.cls}"${geometry.attrs} ${look.paint}/>`;

  const header =
    actions.length === 0 ? item.height : boxSize(item.label, item.type, 80).height;
  const label = measureText(item.label, LABEL_FONT);
  const caption =
    item.type === undefined ? undefined : measureText(item.type, CAPTION_FONT);
  const top = item.y + (header - label.height - (caption?.height ?? 0)) / 2;
  const cx = item.x + item.width / 2;
  body += textLines(
    item.label,
    cx,
    top,
    LABEL_FONT,
    "sg-text sg-label",
    look.typed.text ?? theme.fg,
  );
  if (item.type !== undefined) {
    body += textLines(
      item.type,
      cx,
      top + label.height,
      CAPTION_FONT,
      "sg-muted sg-caption",
      theme.muted,
    );
  }
  if (actions.length > 0) {
    body += `<line class="sg-divider" x1="${n(item.x)}" y1="${n(item.y + header)}" x2="${n(item.x + item.width)}" y2="${n(item.y + header)}" stroke="${theme.nodeStroke}" stroke-width="1"/>`;
    body += actionLines(actions, item.x + PAD_X, item.y + header + ACTIONS_GAP, theme);
  }

  const coverage = item.meta?.coverage;
  if (coverage !== undefined) {
    const clip = `sg-clip-${index}`;
    body =
      `<clipPath id="${clip}"><rect${geometry.attrs}/></clipPath>` +
      body +
      `<rect class="sg-accent" x="${n(item.x)}" y="${n(item.y + item.height - 4)}" width="${n(coverage * item.width)}" height="4" fill="${theme.accent}" clip-path="url(#${clip})"/>`;
  }
  return body;
}

function renderStateItem(
  item: LaidOutState,
  index: number,
  theme: Theme,
  types: Types,
): string {
  const body = item.composite
    ? compositeBody(item, theme)
    : item.pseudo !== undefined
      ? pseudoBody(item, theme, types)
      : simpleBody(item, index, theme, types);
  return wrapLink(
    group(
      "state",
      item.id,
      item.meta,
      body,
      data([
        ["type", item.type],
        ["confidence", confidenceOf(item.meta)],
        ["pseudo", item.pseudo],
        ["composite", item.composite ? "true" : undefined],
      ]),
    ),
    item.link,
  );
}

function renderTransition(item: LaidOutTransition, theme: Theme): string {
  const path = `<path class="sg-edge" d="${pathOf(item.points)}" fill="none" stroke="${theme.edge}" stroke-width="1.5" stroke-linejoin="round"${dashAttr(confidenceDash(item.meta))} marker-end="url(#sg-arrow-filled)"/>`;
  const label =
    item.labelBox === undefined || item.label === undefined
      ? ""
      : labelBoxSvg(item.labelBox, item.label, theme, true);
  return group(
    "transition",
    item.id,
    item.meta,
    path + label,
    data([
      ["type", item.type],
      ["confidence", confidenceOf(item.meta)],
      ["from", item.from],
      ["to", item.to],
    ]),
  );
}

function renderState(laid: LaidOutStateMachine, theme: Theme, types: Types): string {
  const composites = laid.states
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.composite)
    .sort((a, b) => a.item.depth - b.item.depth);
  const simple = laid.states
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.composite);
  return [
    ...composites.map(({ item, index }) => renderStateItem(item, index, theme, types)),
    ...laid.transitions.map((item) => renderTransition(item, theme)),
    ...simple.map(({ item, index }) => renderStateItem(item, index, theme, types)),
  ].join("");
}

function attributeRow(
  attribute: LaidOutAttribute,
  entity: LaidOutEntity,
  theme: Theme,
): string {
  const keys = keysText(attribute.keys);
  const typeText = attributeTypeText(attribute);
  const top = attribute.y + (attribute.height - LINE_HEIGHT * EDGE_LABEL_FONT.size) / 2;
  const keyTop = attribute.y + (attribute.height - LINE_HEIGHT * CAPTION_FONT.size) / 2;
  let body =
    attribute.note === undefined ? "" : `<title>${esc(attribute.note)}</title>`;
  if (keys !== "") {
    body += textLines(
      keys,
      entity.x + entity.columns.key,
      keyTop,
      CAPTION_FONT,
      "sg-muted sg-attr-key",
      theme.muted,
      "start",
    );
  }
  body += textLines(
    attribute.name,
    entity.x + entity.columns.name,
    top,
    EDGE_LABEL_FONT,
    "sg-text",
    theme.fg,
    "start",
  );
  if (typeText !== "") {
    body += textLines(
      typeText,
      entity.x + entity.columns.type,
      top,
      EDGE_LABEL_FONT,
      "sg-muted sg-attr-type",
      theme.muted,
      "start",
    );
  }
  return `<g class="sg-attr"${data([
    ["attr", attribute.name],
    ["keys", attribute.keys === undefined ? undefined : attribute.keys.join(" ")],
  ])}>${body}</g>`;
}

function renderEntity(
  item: LaidOutEntity,
  index: number,
  theme: Theme,
  types: Types,
): string {
  const look = nodeLook(item.meta, item.type, theme, types);
  const frame = ` x="${n(item.x)}" y="${n(item.y)}" width="${n(item.width)}" height="${n(item.height)}" rx="4"`;
  const clip = `sg-clip-${index}`;
  let body =
    `<clipPath id="${clip}"><rect${frame}/></clipPath>` +
    `<rect class="${look.cls}"${frame} ${look.paint}/>` +
    `<rect class="sg-header" x="${n(item.x)}" y="${n(item.y)}" width="${n(item.width)}" height="${n(item.headerHeight)}" fill="${theme.headerFill}" clip-path="url(#${clip})"/>`;

  const label = measureText(item.label, LABEL_FONT);
  const caption =
    item.type === undefined ? undefined : measureText(item.type, CAPTION_FONT);
  const top = item.y + (item.headerHeight - label.height - (caption?.height ?? 0)) / 2;
  const cx = item.x + item.width / 2;
  body += textLines(item.label, cx, top, LABEL_FONT, "sg-text sg-label", look.typed.text ?? theme.fg);
  if (item.type !== undefined) {
    body += textLines(
      item.type,
      cx,
      top + label.height,
      CAPTION_FONT,
      "sg-muted sg-caption",
      theme.muted,
    );
  }
  body += item.attributes.map((attribute) => attributeRow(attribute, item, theme)).join("");

  const coverage = item.meta?.coverage;
  if (coverage !== undefined) {
    body += `<rect class="sg-accent" x="${n(item.x)}" y="${n(item.y + item.height - 4)}" width="${n(coverage * item.width)}" height="4" fill="${theme.accent}" clip-path="url(#${clip})"/>`;
  }

  return wrapLink(
    group(
      "entity",
      item.id,
      item.meta,
      body,
      data([
        ["type", item.type],
        ["confidence", confidenceOf(item.meta)],
      ]),
    ),
    item.link,
  );
}

function cardinalityMarks(
  cardinality: Cardinality | undefined,
  from: Point | undefined,
  next: Point | undefined,
  theme: Theme,
): string {
  if (cardinality === undefined || from === undefined || next === undefined) return "";
  const length = Math.hypot(next.x - from.x, next.y - from.y);
  if (length === 0) return "";
  const ux = (next.x - from.x) / length;
  const uy = (next.y - from.y) / length;
  const vx = -uy;
  const vy = ux;
  const at = (distance: number, side = 0): string =>
    `${n(from.x + distance * ux + side * vx)},${n(from.y + distance * uy + side * vy)}`;
  const stroke = `fill="none" stroke="${theme.edge}" stroke-width="1.5" stroke-linecap="round"`;
  const line = (d: string): string => `<path class="sg-edge" d="${d}" ${stroke}/>`;
  const bar = (distance: number): string =>
    line(`M${at(distance, 6)} L${at(distance, -6)}`);
  const circle = (distance: number): string =>
    `<circle class="sg-bg sg-edge" cx="${n(from.x + distance * ux)}" cy="${n(from.y + distance * uy)}" r="4" fill="${theme.bg}" stroke="${theme.edge}" stroke-width="1.5"/>`;
  const foot = (): string =>
    line(`M${at(12)} L${at(0, 7)} M${at(12)} L${at(0)} M${at(12)} L${at(0, -7)}`);
  switch (cardinality) {
    case "one":
      return bar(6) + bar(11);
    case "zero-or-one":
      return bar(6) + circle(15);
    case "one-or-more":
      return foot() + bar(15);
    case "zero-or-more":
      return foot() + circle(17);
  }
}

function renderRelation(item: LaidOutRelation, theme: Theme): string {
  const dash = confidenceDash(item.meta) ?? (item.identifying ? undefined : "4 3");
  const path = `<path class="sg-edge" d="${pathOf(item.points)}" fill="none" stroke="${theme.edge}" stroke-width="1.5" stroke-linejoin="round"${dashAttr(dash)}/>`;
  const points = item.points;
  const marks =
    cardinalityMarks(item.fromCardinality, points[0], points[1], theme) +
    cardinalityMarks(
      item.toCardinality,
      points[points.length - 1],
      points[points.length - 2],
      theme,
    );
  const label =
    item.labelBox === undefined || item.label === undefined
      ? ""
      : labelBoxSvg(item.labelBox, item.label, theme, true);
  return group(
    "relation",
    item.id,
    item.meta,
    path + marks + label,
    data([
      ["type", item.type],
      ["confidence", confidenceOf(item.meta)],
      ["from", item.from],
      ["to", item.to],
      ["from-cardinality", item.fromCardinality],
      ["to-cardinality", item.toCardinality],
      ["identifying", String(item.identifying)],
    ]),
  );
}

function renderEr(laid: LaidOutEr, theme: Theme, types: Types): string {
  return [
    ...laid.relations.map((item) => renderRelation(item, theme)),
    ...laid.entities.map((item, index) => renderEntity(item, index, theme, types)),
  ].join("");
}

function renderTreeEdge(item: LaidOutTreeEdge, theme: Theme): string {
  const [first, ...rest] = item.points;
  const d =
    first === undefined
      ? ""
      : item.curve === "bezier"
        ? `M${n(first.x)},${n(first.y)} C${rest.map((point) => `${n(point.x)},${n(point.y)}`).join(" ")}`
        : pathOf(item.points);
  return group(
    "edge",
    item.id,
    undefined,
    `<path class="sg-edge" d="${d}" fill="none" stroke="${theme.edge}" stroke-width="1.5" stroke-linejoin="round"/>`,
    data([
      ["from", item.from],
      ["to", item.to],
    ]),
  );
}

function renderTreeNode(
  item: LaidOutTreeNode,
  index: number,
  theme: Theme,
  types: Types,
): string {
  return renderNode(item, index, theme, types, [
    ["depth", item.depth],
    ["side", item.side],
  ]);
}

function renderTree(laid: LaidOutTree, theme: Theme, types: Types): string {
  return [
    ...laid.edges.map((item) => renderTreeEdge(item, theme)),
    ...laid.nodes.map((item, index) => renderTreeNode(item, index, theme, types)),
  ].join("");
}

function renderScene(laidOut: LaidOut, theme: Theme, types: Types): string {
  switch (laidOut.kind) {
    case "graph":
      return renderGraph(laidOut, theme, types);
    case "sequence":
      return renderSequence(laidOut, theme, types);
    case "state":
      return renderState(laidOut, theme, types);
    case "er":
      return renderEr(laidOut, theme, types);
    case "tree":
      return renderTree(laidOut, theme, types);
    default:
      return unreachable(laidOut);
  }
}

function unreachable(value: never): never {
  throw new Error(`Unsupported scene: ${JSON.stringify(value)}`);
}

export function renderSvg(laidOut: LaidOut, options: RenderOptions = {}): string {
  const resolved = withPalette(
    resolveTheme(options.theme),
    typesPresent(laidOut),
    edgeTypesPresent(laidOut),
  );
  const { tokens: theme, types } = escapedTheme(resolved);
  const standalone = options.standalone ?? true;
  const width = n(laidOut.width);
  const height = n(laidOut.height);
  const head = standalone
    ? `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"`
    : "<svg";
  const title =
    laidOut.title === undefined ? "" : `<title>${esc(laidOut.title)}</title>`;
  const body = renderScene(laidOut, theme, types);
  const svg = [
    `${head} class="sg-root" data-diagram="${laidOut.kind}"${laidOut.kind === "tree" ? ` data-layout="${laidOut.layout}"` : ""} version="1.1" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="Inter, system-ui, sans-serif">`,
    title,
    defs(theme, resolved, options.styles ?? true),
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
