import Graph from "graphology";
import Sigma from "sigma";
import { sdfCircle, sdfDiamond, sdfRectangle } from "sigma/rendering";
import type { NodeDisplayData } from "sigma/types";
import { type Change, createView, type ItemRef } from "../core/view";
import type { Document } from "../format";
import type { LaidOut } from "../layout/types";
import type { Mounted } from "../html/svg-adapter";
import { bindInteraction, bindScheme, createPanel, part } from "../html/ui";

const IDLE_MS = 150;
const DIM_OPACITY = 0.25;
const EDGE_SIZE = 1.5;

type Rgb = [number, number, number];

function parseColor(value: string): Rgb {
  const text = value.trim();
  if (text.startsWith("#")) {
    const hex =
      text.length === 4
        ? text
            .slice(1)
            .split("")
            .map((digit) => digit + digit)
            .join("")
        : text.slice(1, 7);
    const number = Number.parseInt(hex, 16);
    return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
  }
  const parts = text.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function mix(a: Rgb, b: Rgb, weight: number): Rgb {
  return [
    a[0] + (b[0] - a[0]) * weight,
    a[1] + (b[1] - a[1]) * weight,
    a[2] + (b[2] - a[2]) * weight,
  ];
}

function css(color: Rgb): string {
  return `rgb(${Math.round(color[0])},${Math.round(color[1])},${Math.round(color[2])})`;
}

function luminance(color: Rgb): number {
  const [r, g, b] = color.map((channel) => {
    const unit = channel / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

function typeFills(app: HTMLElement, types: readonly string[]): Map<string, Rgb> {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "sg-root");
  svg.style.display = "none";
  const probe = (type: string | undefined): SVGElement => {
    const holder = document.createElementNS(ns, "g");
    if (type !== undefined) holder.setAttribute("data-type", type);
    const rect = document.createElementNS(ns, "rect");
    rect.setAttribute("class", "sg-node");
    holder.append(rect);
    svg.append(holder);
    return rect;
  };
  const plain = probe(undefined);
  const probes = types.map((type) => [type, probe(type)] as const);
  app.append(svg);
  const base = getComputedStyle(plain).fill;
  const fills = new Map<string, Rgb>();
  for (const [type, rect] of probes) {
    const fill = getComputedStyle(rect).fill;
    if (fill !== base) fills.set(type, parseColor(fill));
  }
  svg.remove();
  return fills;
}

export function startWebgl(doc: Document, scene: LaidOut): Mounted | undefined {
  if (scene.kind !== "graph") return undefined;
  const graphScene = scene;
  const rectangleShape = sdfRectangle({
    aspectRatio: { attribute: "aspect", default: 3 },
    cornerRadius: 0.18,
  });
  const diamondShape = sdfDiamond();
  const circleShape = sdfCircle();
  const app = part<HTMLElement>("sg-app");
  const viewport = part<HTMLElement>("sg-viewport");
  const glElement = part<HTMLElement>("sg-gl");
  const groupsCanvas = part<HTMLCanvasElement>("sg-groups");
  const panel = part<HTMLElement>("sg-panel");
  const search = part<HTMLInputElement>("sg-search");

  bindScheme(app);

  const fonts = "Inter, system-ui, sans-serif";
  const typeNames = [
    ...new Set(graphScene.nodes.flatMap((node) => (node.type === undefined ? [] : [node.type]))),
  ];
  const readColors = () => {
    const style = getComputedStyle(app);
    const token = (name: string): Rgb => parseColor(style.getPropertyValue(name));
    return {
      bg: token("--sg-bg"),
      fg: token("--sg-fg"),
      muted: token("--sg-muted"),
      stroke: token("--sg-node-stroke"),
      edge: token("--sg-edge"),
      groupFill: css(token("--sg-group-fill")),
      groupStroke: css(token("--sg-group-stroke")),
      accent: css(token("--sg-accent")),
      typed: typeFills(app, typeNames),
    };
  };
  let colors = readColors();

  const view = createView(graphScene);
  const panelControl = createPanel(view, doc, panel);

  const graph = new Graph({ multi: true, type: "directed" });
  const confidence = (meta: { provenance?: { confidence?: string } } | undefined) =>
    meta?.provenance?.confidence;
  const nodeColors = (node: (typeof graphScene.nodes)[number]) => {
    const { bg, fg, muted, stroke, typed } = colors;
    const level = confidence(node.meta);
    const base = (node.type === undefined ? undefined : typed.get(node.type)) ?? stroke;
    const fill =
      level === "unknown"
        ? mix(muted, bg, 0.55)
        : level === "inferred"
          ? mix(base, bg, 0.88)
          : mix(base, bg, 0.75);
    return { color: css(fill), labelColor: css(contrast(fill, fg) >= contrast(fill, bg) ? fg : bg) };
  };
  const edgeColorOf = (edge: (typeof graphScene.edges)[number]): string => {
    const level = confidence(edge.meta);
    return css(
      level === "unknown"
        ? mix(colors.edge, colors.bg, 0.7)
        : level === "inferred"
          ? mix(colors.edge, colors.bg, 0.4)
          : colors.edge,
    );
  };
  for (const node of graphScene.nodes) {
    graph.addNode(node.id, {
      x: node.x + node.width / 2,
      y: -(node.y + node.height / 2),
      size: node.width / 2,
      aspect: node.width / node.height,
      shape: node.shape === "diamond" ? diamondShape.name : node.shape === "circle" ? circleShape.name : rectangleShape.name,
      label: node.label,
      ...nodeColors(node),
    });
  }
  for (const edge of graphScene.edges) {
    if (!graph.hasNode(edge.from) || !graph.hasNode(edge.to)) continue;
    graph.addEdgeWithKey(edge.id, edge.from, edge.to, {
      size: EDGE_SIZE,
      color: edgeColorOf(edge),
      directed: edge.directed,
    });
  }

  let hl = view.highlight();
  let selected = view.selected();
  const accentSelected = (): Partial<NodeDisplayData> => ({
    backdropVisibility: "visible",
    backdropColor: colors.accent,
    backdropPadding: 4,
  });
  const dimmedNode: Partial<NodeDisplayData> = { opacity: DIM_OPACITY, labelVisibility: "hidden" };

  let labelUnit = 1;

  const sigma = new Sigma(graph, glElement, {
    primitives: {
      nodes: {
        shapes: [rectangleShape, diamondShape, circleShape],
        label: { zoomToLabelSizeRatioFunction: (ratio: number) => ratio / labelUnit },
      },
    },
    styles: {
      nodes: {
        x: { attribute: "x" },
        y: { attribute: "y" },
        size: { attribute: "size" },
        color: { attribute: "color" },
        shape: { attribute: "shape" },
        label: { attribute: "label" },
        labelColor: { attribute: "labelColor" },
        labelPosition: "over",
        labelSize: 14,
        labelFont: `600 ${fonts}`,
      },
      edges: {
        size: { attribute: "size" },
        color: { attribute: "color" },
      },
    } as never,
    settings: {
      itemSizesReference: "positions",
      zoomToSizeRatioFunction: (ratio: number) => ratio,
      autoRescale: false,
      enableCameraRotation: false,
      enableNodeDrag: false,
      renderLabels: view.lod().labels,
      renderEdgeLabels: false,
      hideEdgesOnMove: false,
      hideLabelsOnMove: false,
      labelRenderedSizeThreshold: 0,
      labelDensity: 1000,
    },
    nodeReducer(key) {
      const out: Partial<NodeDisplayData> = {};
      if (hl.focused && !hl.active.has(`node:${key}`)) Object.assign(out, dimmedNode);
      if (selected !== null && selected.kind === "node" && selected.id === key) {
        Object.assign(out, accentSelected());
      }
      return out;
    },
    edgeReducer(key) {
      if (selected !== null && selected.kind === "edge" && selected.id === key) {
        return { color: colors.accent, size: EDGE_SIZE * 2 };
      }
      if (hl.focused && !hl.active.has(`edge:${key}`)) return { opacity: DIM_OPACITY };
      return {};
    },
  });
  sigma.getMouseCaptor().kill();
  sigma.getTouchCaptor().kill();

  sigma.setCustomBBox({ x: [0, graphScene.width], y: [-graphScene.height, 0] });

  type Calibration = { unit: number; span: number; offsetX: number; offsetY: number };

  function calibrate(): Calibration {
    const at = (x: number, y: number, gx: number) =>
      sigma.graphToViewport({ x: gx, y: 0 }, { cameraState: { x, y, ratio: 1, angle: 0 } });
    const base = at(0.5, 0.5, 0);
    const { width, height } = sigma.getDimensions();
    return {
      unit: at(0.5, 0.5, 1).x - base.x,
      span: base.x - at(1.5, 0.5, 0).x,
      offsetX: base.x - width / 2,
      offsetY: base.y - height / 2,
    };
  }

  let calibration = calibrate();
  labelUnit = calibration.unit;

  function applyCamera(): void {
    const camera = view.camera();
    const { width, height } = view.viewport();
    const { unit, span, offsetX, offsetY } = calibration;
    const ratio = unit / camera.scale;
    sigma.getCamera().setState({
      ratio,
      x: 0.5 + (offsetX - (camera.x - width / 2) * ratio) / span,
      y: 0.5 + ((camera.y - height / 2) * ratio - offsetY) / span,
      angle: 0,
    });
  }

  const groupsContext = groupsCanvas.getContext("2d")!;

  function drawGroups(): void {
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = view.viewport();
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (groupsCanvas.width !== pixelWidth || groupsCanvas.height !== pixelHeight) {
      groupsCanvas.width = pixelWidth;
      groupsCanvas.height = pixelHeight;
    }
    const context = groupsContext;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, pixelWidth, pixelHeight);
    const camera = view.camera();
    context.setTransform(
      ratio * camera.scale,
      0,
      0,
      ratio * camera.scale,
      ratio * camera.x,
      ratio * camera.y,
    );
    context.lineWidth = 1 / camera.scale;
    const { groupFill, groupStroke } = colors;
    context.fillStyle = groupFill;
    context.strokeStyle = groupStroke;
    const captions = view.lod().edgeLabels;
    const labelFill = css(colors.muted);
    context.font = `600 12px ${fonts}`;
    context.textBaseline = "top";
    for (const ref of view.visible().items) {
      if (ref.kind !== "group") continue;
      const group = view.item({ kind: "group", id: ref.id });
      if (group === undefined) continue;
      context.beginPath();
      context.roundRect(group.x, group.y, group.width, group.height, 8);
      context.fill();
      context.stroke();
      if (captions && group.label !== undefined) {
        context.fillStyle = labelFill;
        context.fillText(group.label, group.x + 12, group.y + 8);
        context.fillStyle = groupFill;
      }
    }
  }

  sigma.on("afterRender", () => {
    drawGroups();
    if (app.dataset.sgReady === undefined) app.dataset.sgReady = "1";
  });

  let scheduled = false;
  let highlightDirty = false;
  let lastMove = 0;
  let idleTimer = 0;

  function touch(): void {
    lastMove = performance.now();
    if (idleTimer === 0) idleTimer = window.setTimeout(idle, IDLE_MS);
  }

  function idle(): void {
    const remaining = IDLE_MS - (performance.now() - lastMove);
    if (remaining > 1) {
      idleTimer = window.setTimeout(idle, remaining);
      return;
    }
    idleTimer = 0;
    if (ui.pointer !== null) schedule();
  }

  function applyHover(): void {
    const pointer = ui.pointer;
    if (pointer === null || ui.dragging) return;
    if (performance.now() - ui.lastWheel < IDLE_MS) return;
    const hit = view.hitTest(pointer.x, pointer.y);
    ui.pointer = null;
    view.hover(hit !== null && hit.kind === "node" ? hit : null);
  }

  function frame(): void {
    applyHover();
    scheduled = false;
    if (highlightDirty) {
      highlightDirty = false;
      hl = view.highlight();
      selected = view.selected();
      sigma.refresh({ skipIndexation: true, schedule: true });
    }
  }

  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(frame);
  }

  view.subscribe((changes: ReadonlySet<Change>) => {
    if (changes.has("selection")) panelControl.update();
    if (changes.has("camera")) {
      touch();
      applyCamera();
    }
    if (changes.has("lod")) sigma.setSetting("renderLabels", view.lod().labels);
    if (changes.has("hover") || changes.has("search") || changes.has("selection")) {
      highlightDirty = true;
    }
    schedule();
  });

  function pick(_event: MouseEvent, x: number, y: number): ItemRef | null {
    const hit = view.hitTest(x, y);
    return hit === null || hit.kind === "group" ? null : hit;
  }

  const ui = bindInteraction({
    view,
    viewport,
    search,
    pick,
    onPointer: schedule,
    onResize() {
      sigma.resize();
      calibration = calibrate();
      labelUnit = calibration.unit;
      applyCamera();
      drawGroups();
    },
  });

  app.addEventListener("sg-scheme", () => {
    colors = readColors();
    for (const node of graphScene.nodes) graph.mergeNodeAttributes(node.id, nodeColors(node));
    for (const edge of graphScene.edges) {
      if (graph.hasEdge(edge.id)) graph.setEdgeAttribute(edge.id, "color", edgeColorOf(edge));
    }
    drawGroups();
    sigma.refresh();
  });

  sigma.resize();
  calibration = calibrate();
  labelUnit = calibration.unit;
  applyCamera();
  sigma.refresh();
  return {
    view,
    destroy() {
      ui.destroy();
      panelControl.destroy();
      clearTimeout(idleTimer);
      sigma.kill();
    },
  };
}
