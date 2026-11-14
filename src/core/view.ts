import { SELF_LOOP_HEIGHT, SELF_LOOP_WIDTH } from "../layout/shared";
import type {
  LaidOut,
  LaidOutEdge,
  LaidOutEntity,
  LaidOutGroup,
  LaidOutMessage,
  LaidOutNode,
  LaidOutParticipant,
  LaidOutRelation,
  LaidOutState,
  LaidOutTransition,
  LaidOutTreeEdge,
  LaidOutTreeNode,
} from "../layout/types";
import { createSpatialIndex, type Rect, type SpatialEntry } from "./spatial";

export type ItemKind =
  | "node"
  | "edge"
  | "group"
  | "participant"
  | "message"
  | "state"
  | "transition"
  | "entity"
  | "relation";
export type ItemRef = { kind: ItemKind; id: string };
export type Camera = { x: number; y: number; scale: number };
export type ViewOptions = {
  minScale?: number;
  maxScale?: number;
  padding?: number;
  labelMinPx?: number;
};
export type Lod = { labels: boolean; captions: boolean; edgeLabels: boolean };
export type Highlight = { focused: boolean; active: ReadonlySet<string> };
export type Change =
  | "camera"
  | "viewport"
  | "hover"
  | "selection"
  | "search"
  | "lod"
  | "visible";

export type ItemMap = {
  node: LaidOutNode | LaidOutTreeNode;
  edge: LaidOutEdge | LaidOutTreeEdge;
  group: LaidOutGroup;
  participant: LaidOutParticipant;
  message: LaidOutMessage;
  state: LaidOutState;
  transition: LaidOutTransition;
  entity: LaidOutEntity;
  relation: LaidOutRelation;
};

export const HOVERABLE: ReadonlySet<ItemKind> = new Set<ItemKind>([
  "node",
  "participant",
  "state",
  "entity",
]);

export function sceneItemCount(scene: LaidOut): number {
  switch (scene.kind) {
    case "graph":
      return scene.groups.length + scene.nodes.length + scene.edges.length;
    case "sequence":
      return scene.participants.length + scene.messages.length;
    case "state":
      return scene.states.length + scene.transitions.length;
    case "er":
      return scene.entities.length + scene.relations.length;
    case "tree":
      return scene.nodes.length + scene.edges.length;
    default:
      return unreachable(scene);
  }
}

function unreachable(value: never): never {
  throw new Error(`Unsupported scene: ${JSON.stringify(value)}`);
}

export interface View {
  readonly scene: LaidOut;
  camera(): Camera;
  viewport(): { width: number; height: number };
  setViewport(width: number, height: number): void;
  setCamera(camera: Camera): void;
  fit(): void;
  panBy(dx: number, dy: number): void;
  zoomAt(factor: number, screenX: number, screenY: number): void;
  screenToWorld(x: number, y: number): { x: number; y: number };
  worldToScreen(x: number, y: number): { x: number; y: number };
  hitTest(screenX: number, screenY: number): ItemRef | null;
  visible(): { items: readonly ItemRef[]; count: number };
  lod(): Lod;
  hover(ref: ItemRef | null): void;
  select(ref: ItemRef | null): void;
  search(query: string): void;
  hovered(): ItemRef | null;
  selected(): ItemRef | null;
  highlight(): Highlight;
  item<K extends ItemKind>(ref: { kind: K; id: string }): ItemMap[K] | undefined;
  subscribe(listener: (changes: ReadonlySet<Change>) => void): () => void;
  batch(fn: () => void): void;
}

const DEFAULT_MIN_SCALE = 0.05;
const DEFAULT_MAX_SCALE = 8;
const DEFAULT_LABEL_MIN_PX = 7;
const LABEL_FONT_SIZE = 14;
const CAPTION_FONT_SIZE = 11;
const EDGE_LABEL_FONT_SIZE = 12;
const HIT_PX = 4;
const CULL_MARGIN_PX = 100;
const EMPTY: ReadonlySet<string> = new Set();

const RECT = 0;
const SEGMENT = 1;
const LABEL = 2;
const EXTENT = 3;

type Shape = {
  entry: number;
  role: number;
  box: Rect;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

type Entry = {
  ref: ItemRef;
  key: string;
  depth: number;
  container: boolean;
  item: unknown;
};

function keyOf(kind: string, id: string): string {
  return `${kind}:${id}`;
}

function distanceToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function contains(box: Rect, x: number, y: number): boolean {
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}

function sameItems(a: Int32Array, b: Int32Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

export function createView(scene: LaidOut, options: ViewOptions = {}): View {
  const minScale = options.minScale ?? DEFAULT_MIN_SCALE;
  const maxScale = options.maxScale ?? DEFAULT_MAX_SCALE;
  const padding = options.padding ?? 0;
  const labelMinPx = options.labelMinPx ?? DEFAULT_LABEL_MIN_PX;
  const sceneWidth = Math.max(1, scene.width);
  const sceneHeight = Math.max(1, scene.height);

  const entries: Entry[] = [];
  const byKey = new Map<string, number>();
  const shapes: SpatialEntry<Shape>[] = [];
  const neighbors = new Map<string, Set<string>>();
  const searchable: { index: number; label: string; id: string }[] = [];

  function addEntry(
    kind: ItemKind,
    id: string,
    item: unknown,
    depth = 0,
    container = false,
  ): number {
    const index = entries.length;
    const key = keyOf(kind, id);
    entries.push({ ref: { kind, id }, key, depth, container, item });
    byKey.set(key, index);
    return index;
  }

  function addShape(
    entry: number,
    role: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): void {
    const box = {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    };
    shapes.push({ box, value: { entry, role, box, x1, y1, x2, y2 } });
  }

  function addRect(entry: number, x: number, y: number, width: number, height: number): void {
    addShape(entry, RECT, x, y, x + width, y + height);
  }

  function addPath(entry: number, points: readonly { x: number; y: number }[]): void {
    const first = points[0];
    if (first === undefined) return;
    if (points.length === 1) addShape(entry, SEGMENT, first.x, first.y, first.x, first.y);
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1]!;
      const b = points[index]!;
      addShape(entry, SEGMENT, a.x, a.y, b.x, b.y);
    }
  }

  function link(a: string, b: string): void {
    let set = neighbors.get(a);
    if (set === undefined) neighbors.set(a, (set = new Set()));
    set.add(b);
  }

  switch (scene.kind) {
  case "graph": {
    for (const group of scene.groups) {
      const index = addEntry("group", group.id, group, group.depth, true);
      addRect(index, group.x, group.y, group.width, group.height);
    }
    const edgeIndexes: number[] = [];
    for (const edge of scene.edges) {
      const index = addEntry("edge", edge.id, edge);
      edgeIndexes.push(index);
      addPath(index, edge.points);
      if (edge.labelBox !== undefined) {
        const box = edge.labelBox;
        addShape(index, LABEL, box.x, box.y, box.x + box.width, box.y + box.height);
      }
    }
    for (const node of scene.nodes) {
      const index = addEntry("node", node.id, node);
      addRect(index, node.x, node.y, node.width, node.height);
      searchable.push({ index, label: node.label.toLowerCase(), id: node.id.toLowerCase() });
    }
    scene.edges.forEach((edge, position) => {
      const edgeKey = entries[edgeIndexes[position]!]!.key;
      const from = keyOf("node", edge.from);
      const to = keyOf("node", edge.to);
      for (const [self, other] of [[from, to], [to, from]] as const) {
        if (!byKey.has(self)) continue;
        link(self, edgeKey);
        if (byKey.has(other)) link(self, other);
      }
      if (byKey.has(from)) link(edgeKey, from);
      if (byKey.has(to)) link(edgeKey, to);
    });
    break;
  }
  case "sequence": {
    for (const participant of scene.participants) {
      const index = addEntry("participant", participant.id, participant);
      addRect(index, participant.x, participant.y, participant.width, participant.height);
      addShape(
        index,
        EXTENT,
        participant.lifelineX,
        participant.y + participant.height,
        participant.lifelineX,
        scene.lifelineBottom,
      );
      searchable.push({
        index,
        label: participant.label.toLowerCase(),
        id: participant.id.toLowerCase(),
      });
    }
    for (const message of scene.messages) {
      const id = String(message.index);
      const index = addEntry("message", id, message);
      if (message.self) {
        const right = message.x1 + SELF_LOOP_WIDTH;
        const bottom = message.y + SELF_LOOP_HEIGHT;
        addPath(index, [
          { x: message.x1, y: message.y },
          { x: right, y: message.y },
          { x: right, y: bottom },
          { x: message.x1, y: bottom },
        ]);
      } else {
        addPath(index, [
          { x: message.x1, y: message.y },
          { x: message.x2, y: message.y },
        ]);
      }
      if (message.labelBox !== undefined) {
        const box = message.labelBox;
        addShape(index, LABEL, box.x, box.y, box.x + box.width, box.y + box.height);
      }
      const messageKey = entries[index]!.key;
      const from = keyOf("participant", message.from);
      const to = keyOf("participant", message.to);
      for (const [self, other] of [[from, to], [to, from]] as const) {
        if (!byKey.has(self)) continue;
        link(self, messageKey);
        if (byKey.has(other)) link(self, other);
      }
      if (byKey.has(from)) link(messageKey, from);
      if (byKey.has(to)) link(messageKey, to);
    }
    break;
  }
  case "state": {
    const addState = (state: LaidOutState): void => {
      const index = addEntry("state", state.id, state, state.depth, state.composite);
      addRect(index, state.x, state.y, state.width, state.height);
      searchable.push({ index, label: state.label.toLowerCase(), id: state.id.toLowerCase() });
    };
    scene.states
      .filter((state) => state.composite)
      .sort((a, b) => a.depth - b.depth)
      .forEach(addState);
    const transitionIndexes: number[] = [];
    for (const transition of scene.transitions) {
      const index = addEntry("transition", transition.id, transition);
      transitionIndexes.push(index);
      addPath(index, transition.points);
      if (transition.labelBox !== undefined) {
        const box = transition.labelBox;
        addShape(index, LABEL, box.x, box.y, box.x + box.width, box.y + box.height);
      }
    }
    scene.states.filter((state) => !state.composite).forEach(addState);
    scene.transitions.forEach((transition, position) => {
      const transitionKey = entries[transitionIndexes[position]!]!.key;
      const from = keyOf("state", transition.from);
      const to = keyOf("state", transition.to);
      for (const [self, other] of [[from, to], [to, from]] as const) {
        if (!byKey.has(self)) continue;
        link(self, transitionKey);
        if (byKey.has(other)) link(self, other);
      }
      if (byKey.has(from)) link(transitionKey, from);
      if (byKey.has(to)) link(transitionKey, to);
    });
    break;
  }
  case "er":
  case "tree":
    break;
  default:
    unreachable(scene);
  }

  const grid = createSpatialIndex(shapes);
  const itemCount = entries.length;
  const mark = new Int32Array(itemCount);
  let markStamp = 0;

  let camera: Camera = { x: 0, y: 0, scale: 1 };
  let viewportSize = { width: 0, height: 0 };
  let hoveredIndex = -1;
  let selectedIndex = -1;
  let query = "";
  let matchKeys: ReadonlySet<string> = EMPTY;
  let highlightState: Highlight = { focused: false, active: EMPTY };
  let visibleIndexes: Int32Array = computeVisible();
  let visibleItems: ItemRef[] | null = null;
  let lodState: Lod = computeLod(1);

  let depth = 0;
  let pending = new Set<Change>();
  let stale = false;
  const listeners = new Set<(changes: ReadonlySet<Change>) => void>();

  function computeLod(scale: number): Lod {
    return {
      labels: LABEL_FONT_SIZE * scale >= labelMinPx,
      captions: CAPTION_FONT_SIZE * scale >= labelMinPx,
      edgeLabels: EDGE_LABEL_FONT_SIZE * scale >= labelMinPx,
    };
  }

  function lowerBound(): number {
    const { width, height } = viewportSize;
    if (width <= 0 || height <= 0) return minScale;
    const fitScale = Math.min(
      Math.max(1, width - 2 * padding) / sceneWidth,
      Math.max(1, height - 2 * padding) / sceneHeight,
    );
    return Math.min(minScale, fitScale);
  }

  function clampScale(scale: number): number {
    return Math.min(maxScale, Math.max(lowerBound(), scale));
  }

  function assignCamera(next: Camera): void {
    if (next.x === camera.x && next.y === camera.y && next.scale === camera.scale) return;
    camera = next;
    pending.add("camera");
    stale = true;
  }

  function computeVisible(): Int32Array {
    const { width, height } = viewportSize;
    if (width <= 0 || height <= 0) {
      const all = new Int32Array(itemCount);
      for (let position = 0; position < itemCount; position++) all[position] = position;
      return all;
    }
    const margin = CULL_MARGIN_PX / camera.scale;
    const found = grid.query({
      x: -camera.x / camera.scale - margin,
      y: -camera.y / camera.scale - margin,
      width: width / camera.scale + 2 * margin,
      height: height / camera.scale + 2 * margin,
    });
    markStamp += 1;
    const list: number[] = [];
    for (const shape of found) {
      if (mark[shape.entry] === markStamp) continue;
      mark[shape.entry] = markStamp;
      list.push(shape.entry);
    }
    return Int32Array.from(list).sort();
  }

  function refresh(): void {
    if (!stale) return;
    stale = false;
    const nextLod = computeLod(camera.scale);
    if (
      nextLod.labels !== lodState.labels ||
      nextLod.captions !== lodState.captions ||
      nextLod.edgeLabels !== lodState.edgeLabels
    ) {
      lodState = nextLod;
      pending.add("lod");
    }
    const nextVisible = computeVisible();
    if (!sameItems(nextVisible, visibleIndexes)) {
      visibleIndexes = nextVisible;
      visibleItems = null;
      pending.add("visible");
    }
  }

  function flush(): void {
    refresh();
    if (pending.size === 0) return;
    const changes = pending;
    pending = new Set();
    for (const listener of [...listeners]) listener(changes);
  }

  function run(fn: () => void): void {
    depth += 1;
    try {
      fn();
    } finally {
      depth -= 1;
      if (depth === 0) flush();
    }
  }

  function recomputeHighlight(): void {
    if (hoveredIndex >= 0) {
      const entry = entries[hoveredIndex]!;
      const active = new Set<string>([entry.key]);
      for (const key of neighbors.get(entry.key) ?? []) active.add(key);
      highlightState = { focused: true, active };
    } else if (query !== "") {
      highlightState = { focused: true, active: matchKeys };
    } else {
      highlightState = { focused: false, active: EMPTY };
    }
  }

  function lookup(ref: ItemRef | null): number {
    if (ref === null) return -1;
    return byKey.get(keyOf(ref.kind, ref.id)) ?? -1;
  }

  const view: View = {
    scene,
    camera: () => ({ ...camera }),
    viewport: () => ({ ...viewportSize }),
    setViewport(width, height) {
      if (width === viewportSize.width && height === viewportSize.height) return;
      run(() => {
        viewportSize = { width, height };
        pending.add("viewport");
        stale = true;
      });
    },
    setCamera(next) {
      if (![next.x, next.y, next.scale].every(Number.isFinite) || next.scale <= 0) return;
      run(() => assignCamera({ x: next.x, y: next.y, scale: clampScale(next.scale) }));
    },
    fit() {
      const { width, height } = viewportSize;
      if (width <= 0 || height <= 0) return;
      run(() => {
        const available = Math.min(
          Math.max(1, width - 2 * padding) / sceneWidth,
          Math.max(1, height - 2 * padding) / sceneHeight,
        );
        const scale = clampScale(Math.min(available, 1));
        assignCamera({
          scale,
          x: (width - scene.width * scale) / 2,
          y: (height - scene.height * scale) / 2,
        });
      });
    },
    panBy(dx, dy) {
      if (dx === 0 && dy === 0) return;
      run(() => assignCamera({ x: camera.x + dx, y: camera.y + dy, scale: camera.scale }));
    },
    zoomAt(factor, screenX, screenY) {
      if (!Number.isFinite(factor) || factor <= 0) return;
      run(() => {
        const next = clampScale(camera.scale * factor);
        const ratio = next / camera.scale;
        assignCamera({
          scale: next,
          x: screenX - (screenX - camera.x) * ratio,
          y: screenY - (screenY - camera.y) * ratio,
        });
      });
    },
    screenToWorld: (x, y) => ({
      x: (x - camera.x) / camera.scale,
      y: (y - camera.y) / camera.scale,
    }),
    worldToScreen: (x, y) => ({
      x: x * camera.scale + camera.x,
      y: y * camera.scale + camera.y,
    }),
    hitTest(screenX, screenY) {
      const px = (screenX - camera.x) / camera.scale;
      const py = (screenY - camera.y) / camera.scale;
      const tolerance = HIT_PX / camera.scale;
      const near = grid.query({
        x: px - tolerance,
        y: py - tolerance,
        width: 2 * tolerance,
        height: 2 * tolerance,
      });
      let top = -1;
      let line = -1;
      let lineDistance = Infinity;
      let group = -1;
      let groupDepth = -1;
      for (const shape of near) {
        const entry = entries[shape.entry]!;
        if (shape.role === RECT) {
          if (!contains(shape.box, px, py)) continue;
          if (entry.container) {
            if (entry.depth > groupDepth || (entry.depth === groupDepth && shape.entry > group)) {
              group = shape.entry;
              groupDepth = entry.depth;
            }
          } else if (shape.entry > top) {
            top = shape.entry;
          }
        } else if (shape.role === SEGMENT || shape.role === LABEL) {
          const distance =
            shape.role === LABEL
              ? contains(shape.box, px, py)
                ? 0
                : Infinity
              : distanceToSegment(px, py, shape.x1, shape.y1, shape.x2, shape.y2);
          if (
            distance <= tolerance &&
            (distance < lineDistance || (distance === lineDistance && shape.entry > line))
          ) {
            line = shape.entry;
            lineDistance = distance;
          }
        }
      }
      const found = top >= 0 ? top : line >= 0 ? line : group;
      return found >= 0 ? entries[found]!.ref : null;
    },
    visible() {
      if (visibleItems === null) {
        visibleItems = Array.from(visibleIndexes, (position) => entries[position]!.ref);
      }
      return { items: visibleItems, count: visibleIndexes.length };
    },
    lod: () => lodState,
    hover(ref) {
      const next = lookup(ref);
      if (next === hoveredIndex) return;
      run(() => {
        hoveredIndex = next;
        recomputeHighlight();
        pending.add("hover");
      });
    },
    select(ref) {
      const next = lookup(ref);
      if (next === selectedIndex) return;
      run(() => {
        selectedIndex = next;
        pending.add("selection");
      });
    },
    search(text) {
      const next = text.trim().toLowerCase();
      if (next === query) return;
      run(() => {
        query = next;
        if (next === "") {
          matchKeys = EMPTY;
        } else {
          const keys = new Set<string>();
          for (const entry of searchable) {
            if (entry.label.includes(next) || entry.id.includes(next)) {
              keys.add(entries[entry.index]!.key);
            }
          }
          matchKeys = keys;
        }
        recomputeHighlight();
        pending.add("search");
      });
    },
    hovered: () => (hoveredIndex >= 0 ? entries[hoveredIndex]!.ref : null),
    selected: () => (selectedIndex >= 0 ? entries[selectedIndex]!.ref : null),
    highlight: () => highlightState,
    item(ref) {
      const found = lookup(ref);
      return found >= 0 ? (entries[found]!.item as never) : undefined;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    batch: run,
  };
  return view;
}
