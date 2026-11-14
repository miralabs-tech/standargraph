import type { ItemRef, View } from "../core/view";
import type { Document, Meta } from "../format";

const DRAG_THRESHOLD = 4;
const UNSAFE_LINK = /^[\s\u0000-\u001f]*(javascript|data|vbscript):/i;

let scope: ParentNode | undefined;

export function withScope<T>(root: ParentNode, fn: () => T): T {
  const previous = scope;
  scope = root;
  try {
    return fn();
  } finally {
    scope = previous;
  }
}

export function part<T extends HTMLElement>(name: string): T {
  const element = (scope ?? document).querySelector(`.${name}`);
  if (element === null) throw new Error(`Missing element .${name}`);
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

export type PanelControl = { update(): void; destroy(): void };

export function createPanel(view: View, doc: Document, panel: HTMLElement): PanelControl {
  const edges = doc.kind === "graph" ? (doc.edges ?? []) : [];

  function edgeId(index: number): string {
    return edges[index]?.id ?? `e${index}`;
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

  const nodesById = new Map<string, number>();
  if (doc.kind === "graph") doc.nodes.forEach((node, index) => nodesById.set(node.id, index));
  let edgesById: Map<string, number> | undefined;

  function describe(kind: string, id: string): void {
    const list = element("dl");
    let title = id;
    let meta: Meta | undefined;
    if (kind === "node" && doc.kind === "graph") {
      const item = doc.nodes[nodesById.get(id) ?? -1];
      if (item === undefined) return;
      title = item.label ?? item.id;
      meta = item.meta;
      row(list, "Kind", "Node");
      if (item.type !== undefined) row(list, "Type", item.type);
      if (item.description !== undefined) row(list, "Description", item.description);
      if (item.link !== undefined) row(list, "Link", linkValue(item.link));
    } else if (kind === "edge" && doc.kind === "graph") {
      if (edgesById === undefined) {
        edgesById = new Map();
        edges.forEach((_, position) => {
          const key = edgeId(position);
          if (!edgesById!.has(key)) edgesById!.set(key, position);
        });
      }
      const item = edges[edgesById.get(id) ?? -1];
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
    close.addEventListener("click", () => view.select(null));
    panel.replaceChildren(close, element("h2", title), list);
    panel.hidden = false;
  }

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && !panel.hidden) view.select(null);
  };
  document.addEventListener("keydown", onKeydown);

  return {
    update() {
      const ref = view.selected();
      if (ref === null) {
        panel.hidden = true;
        panel.replaceChildren();
        return;
      }
      describe(ref.kind, ref.id);
    },
    destroy() {
      document.removeEventListener("keydown", onKeydown);
    },
  };
}

export type Interaction = {
  pointer: { x: number; y: number } | null;
  dragging: boolean;
  lastWheel: number;
  rect(): DOMRect;
  resize(): void;
  destroy(): void;
};

export type InteractionOptions = {
  view: View;
  viewport: HTMLElement;
  search: HTMLInputElement;
  pick(event: MouseEvent, x: number, y: number): ItemRef | null;
  onPointer(): void;
  onResize?(): void;
};

export function bindInteraction(options: InteractionOptions): Interaction {
  const { view, viewport, search } = options;
  let rect = viewport.getBoundingClientRect();
  const state: Interaction = {
    pointer: null,
    dragging: false,
    lastWheel: -Infinity,
    rect: () => rect,
    resize,
    destroy() {
      observer.disconnect();
    },
  };

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
        state.dragging = true;
        viewport.setPointerCapture(event.pointerId);
        viewport.classList.add("sg-dragging");
      }
      view.panBy(event.clientX - lastX, event.clientY - lastY);
      lastX = event.clientX;
      lastY = event.clientY;
      return;
    }
    if (pointerId !== null) return;
    state.pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    options.onPointer();
  });

  function endDrag(event: PointerEvent): void {
    if (pointerId !== event.pointerId) return;
    pointerId = null;
    state.dragging = false;
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
    const target = options.pick(event, event.clientX - rect.left, event.clientY - rect.top);
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
      state.lastWheel = performance.now();
      view.zoomAt(
        Math.exp(-event.deltaY * 0.0015),
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
    },
    { passive: false },
  );

  viewport.addEventListener("mouseleave", () => {
    state.pointer = null;
    view.hover(null);
  });

  function zoomCenter(factor: number): void {
    const size = view.viewport();
    view.zoomAt(factor, size.width / 2, size.height / 2);
  }

  part("sg-zoom-in").addEventListener("click", () => zoomCenter(1.25));
  part("sg-zoom-out").addEventListener("click", () => zoomCenter(0.8));
  part("sg-fit").addEventListener("click", () => view.fit());
  search.addEventListener("input", () => view.search(search.value));

  function resize(): void {
    rect = viewport.getBoundingClientRect();
    view.batch(() => {
      view.setViewport(viewport.clientWidth, viewport.clientHeight);
      view.fit();
    });
    options.onResize?.();
  }

  const observer = new ResizeObserver(resize);
  observer.observe(viewport);
  view.batch(() => {
    view.setViewport(viewport.clientWidth, viewport.clientHeight);
    view.fit();
  });

  return state;
}
