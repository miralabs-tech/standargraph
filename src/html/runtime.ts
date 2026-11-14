import { type Change, createView, type ItemKind, type ItemRef } from "../core/view";
import type { Document, Meta } from "../format";
import type { LaidOut } from "../layout/types";

const DRAG_THRESHOLD = 4;
const IDLE_MS = 150;
const CULL_MIN_ITEMS = 400;
const UNSAFE_LINK = /^[\s\u0000-\u001f]*(javascript|data|vbscript):/i;

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing element #${id}`);
  return element as T;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const created = document.createElement(tag);
  if (text !== undefined) created.textContent = text;
  if (className !== undefined) created.className = className;
  return created;
}

function start(): void {
  const documentJson = byId<HTMLScriptElement>("standargraph-document").textContent;
  const doc = JSON.parse(documentJson ?? "{}") as Document;
  const sceneJson = byId<HTMLScriptElement>("standargraph-scene").textContent;
  const scene = JSON.parse(sceneJson ?? "{}") as LaidOut;
  const viewport = byId<HTMLDivElement>("sg-viewport");
  const stage = byId<HTMLDivElement>("sg-stage");
  const panel = byId<HTMLElement>("sg-panel");
  const search = byId<HTMLInputElement>("sg-search");
  const svg = stage.querySelector("svg");
  if (svg === null) return;
  const root: SVGSVGElement = svg;

  const view = createView(scene);

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

  const edges = doc.kind === "graph" ? (doc.edges ?? []) : [];

  function edgeId(index: number): string {
    return edges[index]?.id ?? `e${index}`;
  }

  const itemCount =
    scene.kind === "graph"
      ? scene.groups.length + scene.nodes.length + scene.edges.length
      : scene.participants.length + scene.messages.length;
  const culling = itemCount > CULL_MIN_ITEMS;

  let rect = viewport.getBoundingClientRect();
  let pointer: { x: number; y: number } | null = null;
  let dragging = false;
  let lastWheel = -Infinity;
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
    if (pointer !== null) schedule();
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
    if (pointer === null || dragging) return;
    if (performance.now() - lastWheel < IDLE_MS) return;
    const hit = view.hitTest(pointer.x, pointer.y);
    pointer = null;
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

  function row(list: HTMLElement, name: string, value: string | Node): void {
    const term = element("dt", name);
    const detail = element("dd");
    if (typeof value === "string") detail.textContent = value;
    else detail.appendChild(value);
    list.append(term, detail);
  }

  function linkValue(link: string): Node {
    if (UNSAFE_LINK.test(link)) return document.createTextNode(link);
    const anchor = element("a", link);
    anchor.href = link;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    return anchor;
  }

  function metaRows(list: HTMLElement, meta: Meta | undefined): void {
    if (meta === undefined) return;
    const provenance = meta.provenance;
    if (provenance !== undefined) {
      row(list, "Source", provenance.source);
      if (provenance.confidence !== undefined) row(list, "Confidence", provenance.confidence);
      if (provenance.tool !== undefined) row(list, "Tool", provenance.tool);
    }
    if (meta.coverage !== undefined) {
      row(list, "Coverage", `${Math.round(meta.coverage * 1000) / 10}%`);
    }
    if (meta.freshness !== undefined) {
      const date = new Date(meta.freshness);
      row(
        list,
        "Freshness",
        Number.isNaN(date.getTime()) ? meta.freshness : date.toLocaleString(),
      );
    }
    if (meta.data !== undefined) {
      const table = element("table", undefined, "sg-data");
      for (const [key, value] of Object.entries(meta.data)) {
        const tr = element("tr");
        tr.append(element("th", key), element("td", String(value)));
        table.appendChild(tr);
      }
      row(list, "Data", table);
    }
  }

  function describe(kind: string, id: string): void {
    const list = element("dl");
    let title = id;
    let meta: Meta | undefined;
    if (kind === "node" && doc.kind === "graph") {
      const item = doc.nodes.find((candidate) => candidate.id === id);
      if (item === undefined) return;
      title = item.label ?? item.id;
      meta = item.meta;
      row(list, "Kind", "Node");
      if (item.type !== undefined) row(list, "Type", item.type);
      if (item.description !== undefined) row(list, "Description", item.description);
      if (item.link !== undefined) row(list, "Link", linkValue(item.link));
    } else if (kind === "edge" && doc.kind === "graph") {
      const index = edges.findIndex((_, position) => edgeId(position) === id);
      const item = edges[index];
      if (item === undefined) return;
      title = item.label ?? `${item.from} → ${item.to}`;
      meta = item.meta;
      row(list, "Kind", "Edge");
      row(list, "Connection", `${item.from} → ${item.to}`);
      if (item.type !== undefined) row(list, "Type", item.type);
    } else if (kind === "participant" && doc.kind === "sequence") {
      const item = doc.participants.find((candidate) => candidate.id === id);
      if (item === undefined) return;
      title = item.label ?? item.id;
      meta = item.meta;
      row(list, "Kind", "Participant");
      if (item.type !== undefined) row(list, "Type", item.type);
    } else if (kind === "message" && doc.kind === "sequence") {
      const item = doc.messages[Number(id)];
      if (item === undefined) return;
      title = item.label ?? `${item.from} → ${item.to}`;
      meta = item.meta;
      row(list, "Kind", "Message");
      row(list, "Connection", `${item.from} → ${item.to}`);
      row(list, "Style", item.style ?? "sync");
    } else {
      return;
    }
    metaRows(list, meta);
    const close = element("button", "×", "sg-close");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", closePanel);
    panel.replaceChildren(close, element("h2", title), list);
    panel.hidden = false;
  }

  function closePanel(): void {
    view.select(null);
  }

  function applySelection(): void {
    selectedElement?.classList.remove("sg-selected");
    selectedElement = null;
    const ref = view.selected();
    if (ref === null) {
      panel.hidden = true;
      panel.replaceChildren();
      return;
    }
    selectedElement = elementOf(ref) ?? null;
    selectedElement?.classList.add("sg-selected");
    describe(ref.kind, ref.id);
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

  let pointerId: number | null = null;
  let originX = 0;
  let originY = 0;
  let lastX = 0;
  let lastY = 0;
  let moved = false;

  viewport.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    pointerId = event.pointerId;
    originX = event.clientX;
    originY = event.clientY;
    lastX = event.clientX;
    lastY = event.clientY;
    moved = false;
  });

  viewport.addEventListener("pointermove", (event) => {
    if (pointerId === event.pointerId) {
      const travelled = Math.hypot(event.clientX - originX, event.clientY - originY);
      if (!moved && travelled < DRAG_THRESHOLD) return;
      if (!moved) {
        moved = true;
        dragging = true;
        viewport.setPointerCapture(event.pointerId);
        viewport.classList.add("sg-dragging");
      }
      view.panBy(event.clientX - lastX, event.clientY - lastY);
      lastX = event.clientX;
      lastY = event.clientY;
      return;
    }
    if (pointerId !== null) return;
    pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    schedule();
  });

  function endDrag(event: PointerEvent): void {
    if (pointerId !== event.pointerId) return;
    pointerId = null;
    dragging = false;
    viewport.classList.remove("sg-dragging");
  }

  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);

  viewport.addEventListener("click", (event) => {
    if (moved) {
      moved = false;
      event.preventDefault();
      return;
    }
    const target = pickable(event.target);
    if (target !== null) {
      event.preventDefault();
      view.select(target);
    } else if (event.target instanceof Element && event.target.closest("a") !== null) {
      event.preventDefault();
    }
  });

  viewport.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      lastWheel = performance.now();
      view.zoomAt(
        Math.exp(-event.deltaY * 0.0015),
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
    },
    { passive: false },
  );

  viewport.addEventListener("mouseleave", () => {
    pointer = null;
    view.hover(null);
  });

  function zoomCenter(factor: number): void {
    const size = view.viewport();
    view.zoomAt(factor, size.width / 2, size.height / 2);
  }

  byId("sg-zoom-in").addEventListener("click", () => zoomCenter(1.25));
  byId("sg-zoom-out").addEventListener("click", () => zoomCenter(0.8));
  byId("sg-fit").addEventListener("click", () => view.fit());
  search.addEventListener("input", () => view.search(search.value));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) closePanel();
  });

  function resize(): void {
    rect = viewport.getBoundingClientRect();
    view.batch(() => {
      view.setViewport(viewport.clientWidth, viewport.clientHeight);
      view.fit();
    });
  }

  new ResizeObserver(resize).observe(viewport);
  view.batch(() => {
    view.setViewport(viewport.clientWidth, viewport.clientHeight);
    view.fit();
  });
  applyCamera();
  applyLod();
  if (culling) applyVisible();
}

start();
