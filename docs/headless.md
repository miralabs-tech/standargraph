# Headless core

`@miralabs-tech/standargraph/core` is the part of StandarGraph that never touches a browser. It validates a document, lays it out, and exposes a **view**: camera, hit testing, culling, level of detail, hover, selection and search. The SVG renderer and the HTML page are adapters on top of it. Anything else (a canvas, WebGL, a UI kit, a terminal) is another adapter, and it animates however it likes.

```ts
import { createView, layout, type ItemRef } from "@miralabs-tech/standargraph/core";
```

Nothing under `src/core`, `src/format` or `src/layout` uses `document`, `window` or `requestAnimationFrame`, so the core runs in Node, Bun, a worker or a browser. A test enforces it.

## What the core gives

- `layout(document)`: validates a graph or sequence document and returns the laid-out scene (`LaidOut`): positions and sizes for groups, nodes, participants, edge paths, message lines and label boxes. `validate`, the format types, `measureText` and the laid-out types are re-exported too.
- `createView(scene, options?)`: a deterministic, timer-free state machine over that scene.

A view holds:

- Camera: `camera()`, `setCamera()`, `fit()`, `panBy(dx, dy)`, `zoomAt(factor, screenX, screenY)`. A screen point is `world * scale + (x, y)`. `zoomAt` keeps the world point under the cursor fixed and clamps the scale to `minScale`..`maxScale` (0.05..8 by default).
- Geometry: `screenToWorld`, `worldToScreen`, `hitTest(screenX, screenY)` (nodes and participants first, then edges and messages within 4 screen pixels, then groups, else `null`).
- Culling: `visible()` lists the items that intersect the viewport plus a margin. It comes from a uniform grid index, so it stays cheap on thousands of items.
- Level of detail: `lod()` returns `{ labels, captions, edgeLabels }`. Each flag turns false once its font size times the scale falls under `labelMinPx` (7 by default), when text is unreadable anyway.
- Interaction state: `hover`, `select`, `search`, `hovered`, `selected`, and `highlight()` which returns `{ focused, active }` where `active` holds `"kind:id"` keys: hover gives the item, its incident edges or messages and their endpoints; without hover, the search matches.
- `item(ref)`: the laid-out item behind an `ItemRef`.
- `subscribe(listener)`: called synchronously, once per mutating call, with the set of changes that really happened: `camera`, `viewport`, `hover`, `selection`, `search`, `lod`, `visible`. `batch(fn)` coalesces several calls into one notification.

The `ItemRef` objects returned by `visible()`, `hitTest()` and `hovered()` are the same objects every time for a given item, so they work as `Map` keys.

The view does not know about pixels, devices or frames: call `setViewport(width, height)` with your surface size, and decide yourself when to redraw.

## A minimal canvas adapter

```ts
import { createView, layout } from "@miralabs-tech/standargraph/core";

const scene = await layout(await (await fetch("graph.json")).json());
const canvas = document.querySelector("canvas")!;
const ctx = canvas.getContext("2d")!;
const view = createView(scene);
view.setViewport(canvas.width, canvas.height);
view.fit();

function draw() {
  const { x, y, scale } = view.camera();
  const { active, focused } = view.highlight();
  const lod = view.lod();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, x, y);
  for (const ref of view.visible().items) {
    ctx.globalAlpha = focused && !active.has(`${ref.kind}:${ref.id}`) ? 0.25 : 1;
    if (ref.kind === "node") {
      const node = view.item({ kind: "node", id: ref.id })!;
      ctx.strokeRect(node.x, node.y, node.width, node.height);
      if (lod.labels) ctx.fillText(node.label, node.x + 8, node.y + node.height / 2);
    } else if (ref.kind === "edge") {
      const [first, ...rest] = view.item({ kind: "edge", id: ref.id })!.points;
      ctx.beginPath();
      ctx.moveTo(first!.x, first!.y);
      for (const point of rest) ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
  }
}

let frame = 0;
view.subscribe(() => (frame ||= requestAnimationFrame(() => ((frame = 0), draw()))));
canvas.addEventListener("wheel", (e) => (e.preventDefault(), view.zoomAt(Math.exp(-e.deltaY * 0.0015), e.offsetX, e.offsetY)), { passive: false });
canvas.addEventListener("pointermove", (e) =>
  e.buttons ? view.panBy(e.movementX, e.movementY) : view.hover(view.hitTest(e.offsetX, e.offsetY)));
draw();
```

Each `subscribe` callback only marks the frame dirty; the drawing runs once per animation frame whatever the number of input events. The bundled HTML runtime works the same way and applies only the changes listed in the notification.

## Animating

The view changes state instantly and never schedules anything, so animation belongs to the adapter.

- Camera: tween an object `{ x, y, scale }` with any library (GSAP, Motion, a hand-written easing) and call `view.setCamera(value)` on each update. `setCamera` clamps the scale and notifies like any other mutation, so `lod()` and `visible()` follow the animation. Start from `view.camera()` and aim at a target computed with `worldToScreen` or `fit()`.
- Items: the scene is plain data. To move nodes, keep your own animated positions and draw with them. The view indexes the geometry it was created with: when the movement ends, build a new view with `createView(nextScene)` so `hitTest` and `visible` use the final positions.
- Highlight: `highlight().active` only says which items are emphasised. Fading them in and out is a rendering concern of the adapter.

## The WebGL adapter

`@miralabs-tech/standargraph/webgl` renders a graph with [Sigma.js](https://www.sigmajs.org) (WebGL) and a 2D canvas for the groups, as a second adapter on the same view. The HTML export picks it above `WEBGL_THRESHOLD` nodes (exported from `@miralabs-tech/standargraph/core`, a plain constant); `renderer: "svg" | "webgl" | "auto"` on `renderHtml` and `--renderer` on the CLI override the choice. Sequence diagrams are always drawn as SVG.

**The view stays the source of truth.** Sigma's mouse and touch captors are killed, and Sigma's camera is never read back. The pointer, wheel, toolbar and keyboard handlers are the same ones the SVG page uses (`src/html/ui.ts`) and call `panBy`, `zoomAt`, `fit`, `hover`, `select` and `search` on the view. Each `camera` change from the view is written to Sigma's camera synchronously (`view.camera()` is converted to a Sigma camera state through a calibration read once from `sigma.graphToViewport`, so scale and translation match exactly), and Sigma renders on its own animation frame. The groups canvas is redrawn in Sigma's `afterRender` from `view.camera()` and `view.visible()`, so both layers always show the same camera.

- Hover, selection, search: `view.hover`, `view.select` and `view.search` change `view.highlight()` and `view.selected()`. A single `sigma.refresh` per animation frame re-runs Sigma's `nodeReducer` and `edgeReducer`, which read those values (dimmed items get a lower opacity, the selected node a backdrop in the accent color, the selected edge the accent color).
- Hit testing: `view.hitTest`, not Sigma's GPU picking, so hover and click cost the same as in the SVG page.
- Level of detail: Sigma's `renderLabels` follows `view.lod().labels`; group captions follow `view.lod().edgeLabels`.
- Colors come from the light or dark theme variables of the page (`--sg-*`), read once at start. `meta.provenance.confidence` of `unknown` gives a muted node fill and a faded edge, `inferred` a lighter node fill and a half-faded edge. Dash patterns are not used.
- Not drawn in WebGL: node type captions, edge labels and arrowheads.

## Mounting in an application

`mount(container, input, options?)` from `@miralabs-tech/standargraph/html` validates a document, builds the scene and renders the SVG or WebGL adapter inside `container`. When every node has a `position`, the scene comes from the precomputed path without running ELK. Otherwise the layout runs in a Web Worker created from an inline Blob, so the main thread stays free during the layout. It returns a promise of `{ view, destroy() }`. One mounted graph per document is supported, because the toolbar and panel use fixed element ids.
