import type { Document, Meta } from "../format";

const MIN_SCALE = 0.05;
const MAX_SCALE = 8;
const DRAG_THRESHOLD = 4;
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
  const viewport = byId<HTMLDivElement>("sg-viewport");
  const stage = byId<HTMLDivElement>("sg-stage");
  const panel = byId<HTMLElement>("sg-panel");
  const search = byId<HTMLInputElement>("sg-search");
  const svg = stage.querySelector("svg");
  if (svg === null) return;

  const box = svg.viewBox.baseVal;
  const contentWidth = box.width || svg.clientWidth;
  const contentHeight = box.height || svg.clientHeight;

  let scale = 1;
  let tx = 0;
  let ty = 0;

  function apply(): void {
    stage.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  }

  function fit(): void {
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    if (width === 0 || height === 0) return;
    scale = Math.min(width / contentWidth, height / contentHeight, 1);
    tx = (width - contentWidth * scale) / 2;
    ty = (height - contentHeight * scale) / 2;
    apply();
  }

  function zoomAt(factor: number, cx: number, cy: number): void {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
    const ratio = next / scale;
    tx = cx - (cx - tx) * ratio;
    ty = cy - (cy - ty) * ratio;
    scale = next;
    apply();
  }

  function zoomCenter(factor: number): void {
    zoomAt(factor, viewport.clientWidth / 2, viewport.clientHeight / 2);
  }

  const elements = new Map<string, Element>();
  for (const item of svg.querySelectorAll("[data-kind]")) {
    elements.set(`${item.getAttribute("data-kind")}:${item.getAttribute("data-id")}`, item);
  }

  const edges = doc.kind === "graph" ? (doc.edges ?? []) : [];
  const messages = doc.kind === "sequence" ? doc.messages : [];

  function edgeId(index: number): string {
    return edges[index]?.id ?? `e${index}`;
  }

  function incident(kind: string, id: string): Element[] {
    const found: Element[] = [];
    const self = elements.get(`${kind}:${id}`);
    if (self !== undefined) found.push(self);
    if (kind === "node") {
      edges.forEach((edge, index) => {
        if (edge.from !== id && edge.to !== id) return;
        const item = elements.get(`edge:${edgeId(index)}`);
        if (item !== undefined) found.push(item);
      });
    } else if (kind === "participant") {
      messages.forEach((message, index) => {
        if (message.from !== id && message.to !== id) return;
        const item = elements.get(`message:${index}`);
        if (item !== undefined) found.push(item);
      });
    }
    return found;
  }

  let hovered: Element | null = null;
  let selected: Element | null = null;

  function matches(): Element[] {
    const query = search.value.trim().toLowerCase();
    if (query === "") return [];
    const found: Element[] = [];
    const items: { id: string; label?: string }[] =
      doc.kind === "graph" ? doc.nodes : doc.participants;
    const kind = doc.kind === "graph" ? "node" : "participant";
    for (const item of items) {
      const label = item.label ?? item.id;
      if (label.toLowerCase().includes(query) || item.id.toLowerCase().includes(query)) {
        const target = elements.get(`${kind}:${item.id}`);
        if (target !== undefined) found.push(target);
      }
    }
    return found;
  }

  function refresh(): void {
    for (const item of elements.values()) {
      item.classList.remove("sg-dim", "sg-hl");
    }
    let active: Element[] = [];
    if (hovered !== null) {
      active = incident(
        hovered.getAttribute("data-kind") ?? "",
        hovered.getAttribute("data-id") ?? "",
      );
    } else if (search.value.trim() !== "") {
      active = matches();
    }
    const focused = hovered !== null || search.value.trim() !== "";
    svg!.classList.toggle("sg-focus", focused);
    if (!focused) return;
    const keep = new Set(active);
    for (const item of elements.values()) {
      item.classList.add(keep.has(item) ? "sg-hl" : "sg-dim");
    }
  }

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
    panel.hidden = true;
    panel.replaceChildren();
    selected?.classList.remove("sg-selected");
    selected = null;
  }

  function select(target: Element): void {
    selected?.classList.remove("sg-selected");
    selected = target;
    target.classList.add("sg-selected");
    describe(target.getAttribute("data-kind") ?? "", target.getAttribute("data-id") ?? "");
  }

  function pickable(target: EventTarget | null): Element | null {
    if (!(target instanceof Element)) return null;
    const found = target.closest("[data-kind]");
    if (found === null || found.getAttribute("data-kind") === "group") return null;
    return found;
  }

  let pointerId: number | null = null;
  let originX = 0;
  let originY = 0;
  let startTx = 0;
  let startTy = 0;
  let moved = false;

  viewport.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    pointerId = event.pointerId;
    originX = event.clientX;
    originY = event.clientY;
    startTx = tx;
    startTy = ty;
    moved = false;
  });

  viewport.addEventListener("pointermove", (event) => {
    if (pointerId !== event.pointerId) return;
    const dx = event.clientX - originX;
    const dy = event.clientY - originY;
    if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!moved) {
      moved = true;
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add("sg-dragging");
    }
    tx = startTx + dx;
    ty = startTy + dy;
    apply();
  });

  function endDrag(event: PointerEvent): void {
    if (pointerId !== event.pointerId) return;
    pointerId = null;
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
      select(target);
    } else if (event.target instanceof Element && event.target.closest("a") !== null) {
      event.preventDefault();
    }
  });

  viewport.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      zoomAt(
        Math.exp(-event.deltaY * 0.0015),
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
    },
    { passive: false },
  );

  viewport.addEventListener("mouseover", (event) => {
    const target = pickable(event.target);
    const kind = target?.getAttribute("data-kind");
    const next = kind === "node" || kind === "participant" ? target : null;
    if (next === hovered) return;
    hovered = next;
    refresh();
  });

  viewport.addEventListener("mouseleave", () => {
    if (hovered === null) return;
    hovered = null;
    refresh();
  });

  byId("sg-zoom-in").addEventListener("click", () => zoomCenter(1.25));
  byId("sg-zoom-out").addEventListener("click", () => zoomCenter(0.8));
  byId("sg-fit").addEventListener("click", fit);
  search.addEventListener("input", refresh);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) closePanel();
  });

  new ResizeObserver(fit).observe(viewport);
  fit();
}

start();
