import { type Change, createView, type ItemKind, type ItemRef, type View } from "../core/view";
import type { Document } from "../format";
import type { LaidOut } from "../layout/types";
import { bindInteraction, byId, createPanel } from "./ui";

const IDLE_MS = 150;
const CULL_MIN_ITEMS = 400;

export type Mounted = { view: View; destroy(): void };

export function startSvg(doc: Document, scene: LaidOut): Mounted | undefined {
  const viewport = byId<HTMLDivElement>("sg-viewport");
  const stage = byId<HTMLDivElement>("sg-stage");
  const panel = byId<HTMLElement>("sg-panel");
  const search = byId<HTMLInputElement>("sg-search");
  const svg = stage.querySelector("svg");
  if (svg === null) return undefined;
  const root: SVGSVGElement = svg;

  const view = createView(scene);
  const updatePanel = createPanel(view, doc, panel);

  const elements = new Map<string, Element>();
  for (const item of root.querySelectorAll("[data-kind]")) {
    elements.set(`${item.getAttribute("data-kind")}:${item.getAttribute("data-id")}`, item);
  }
  const elementByRef = new Map<ItemRef, Element>();

  function elementOf(ref: ItemRef): Element | undefined {
    let found = elementByRef.get(ref);
    if (found === undefined) {
      found = elements.get(`${ref.kind}:${ref.id}`);
      if (found !== undefined) elementByRef.set(ref, found);
    }
    return found;
  }

  const itemCount =
    scene.kind === "graph"
      ? scene.groups.length + scene.nodes.length + scene.edges.length
      : scene.participants.length + scene.messages.length;
  const culling = itemCount > CULL_MIN_ITEMS;

  let lastMove = 0;
  let idleTimer = 0;
  let willChange = false;
  let scheduled = false;
  let cullDirty = false;
  let pending = new Set<Change>();
  let shown = new Set<ItemRef>(view.visible().items);
  let previousActive: ReadonlySet<string> = new Set();
  let previousFocused = false;
  let selectedElement: Element | null = null;

  function touch(): void {
    lastMove = performance.now();
    if (!willChange) {
      willChange = true;
      stage.style.willChange = "transform";
    }
    if (idleTimer === 0) idleTimer = window.setTimeout(idle, IDLE_MS);
  }

  function idle(): void {
    const remaining = IDLE_MS - (performance.now() - lastMove);
    if (remaining > 1) {
      idleTimer = window.setTimeout(idle, remaining);
      return;
    }
    idleTimer = 0;
    willChange = false;
    stage.style.willChange = "";
    if (cullDirty) applyVisible();
    if (ui.pointer !== null) schedule();
  }

  function applyCamera(): void {
    const camera = view.camera();
    stage.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
  }

  function applyLod(): void {
    const lod = view.lod();
    root.classList.toggle("sg-lod-nolabels", !lod.labels);
    root.classList.toggle("sg-lod-nocaptions", !lod.captions);
    root.classList.toggle("sg-lod-noedgelabels", !lod.edgeLabels);
  }

  function applyHighlight(): void {
    const { focused, active } = view.highlight();
    if (focused !== previousFocused) {
      root.classList.toggle("sg-focus", focused);
      previousFocused = focused;
    }
    for (const key of previousActive) {
      if (!active.has(key)) elements.get(key)?.classList.remove("sg-hl");
    }
    for (const key of active) {
      if (!previousActive.has(key)) elements.get(key)?.classList.add("sg-hl");
    }
    previousActive = active;
  }

  function applyVisible(): void {
    cullDirty = false;
    const next = new Set(view.visible().items);
    for (const ref of shown) {
      if (next.has(ref)) continue;
      const target = elementOf(ref);
      if (target instanceof SVGElement) target.style.display = "none";
    }
    for (const ref of next) {
      if (shown.has(ref)) continue;
      const target = elementOf(ref);
      if (target instanceof SVGElement) target.style.display = "";
    }
    shown = next;
  }

  function revealVisible(): void {
    cullDirty = true;
    const next = view.visible().items;
    const grown = new Set(shown);
    for (const ref of next) {
      if (grown.has(ref)) continue;
      const target = elementOf(ref);
      if (target instanceof SVGElement) target.style.display = "";
      grown.add(ref);
    }
    shown = grown;
  }

  function applyHover(): void {
    const pointer = ui.pointer;
    if (pointer === null || ui.dragging) return;
    if (performance.now() - ui.lastWheel < IDLE_MS) return;
    const hit = view.hitTest(pointer.x, pointer.y);
    ui.pointer = null;
    view.hover(hit !== null && (hit.kind === "node" || hit.kind === "participant") ? hit : null);
  }

  function frame(): void {
    applyHover();
    scheduled = false;
    const changes = pending;
    pending = new Set();
    if (changes.has("camera")) applyCamera();
    if (changes.has("lod")) applyLod();
    if (changes.has("hover") || changes.has("search")) applyHighlight();
    if (culling && changes.has("visible")) {
      if (willChange) revealVisible();
      else applyVisible();
    }
  }

  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(frame);
  }

  view.subscribe((changes) => {
    if (changes.has("selection")) applySelection();
    if (changes.has("camera")) touch();
    for (const change of changes) pending.add(change);
    schedule();
  });

  function applySelection(): void {
    selectedElement?.classList.remove("sg-selected");
    selectedElement = null;
    const ref = view.selected();
    if (ref !== null) {
      selectedElement = elementOf(ref) ?? null;
      selectedElement?.classList.add("sg-selected");
    }
    updatePanel();
  }

  function pickable(target: EventTarget | null): ItemRef | null {
    if (!(target instanceof Element)) return null;
    const found = target.closest("[data-kind]");
    if (found === null || found.getAttribute("data-kind") === "group") return null;
    return {
      kind: (found.getAttribute("data-kind") ?? "") as ItemKind,
      id: found.getAttribute("data-id") ?? "",
    };
  }

  const ui = bindInteraction({
    view,
    viewport,
    search,
    pick: (event) => pickable(event.target),
    onPointer: schedule,
  });

  applyCamera();
  applyLod();
  if (culling) applyVisible();
  byId("sg-app").dataset.sgReady = "1";
  return { view, destroy: () => ui.destroy() };
}
