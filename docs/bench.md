# Benchmark

Measured on 2026-11-14. Raw numbers: `bench/results/2026-11-14.json`. Regenerate with `bun run bench`: Playwright drives the installed Microsoft Edge, headed, so the real GPU is used.

## Machine

| | |
| --- | --- |
| CPU | Intel(R) Core(TM) i7-14700KF (28 threads) |
| Memory | 32 GB |
| GPU | ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Ti SUPER (0x00002705) Direct3D11 vs_5_0 ps_5_0, D3D11) |
| OS | win32 10.0.26300 |
| Browser | Microsoft Edge 157.0.4341.46 |

## Method

- Graphs come from `scripts/generate.ts` (seed 1, about 1.25 edges per node, one group per 100 nodes), laid out once by `layout()` (ELK layered) and rendered to a self-contained HTML page with the SVG renderer and with the WebGL renderer.
- Each page opens in a 1280x800 window. Once the page signals that the fit is done, a fixed 10 s script of real mouse input runs: 3 s of pan circles, 3 s of wheel zoom in and out, 4 s of hover sweeps.
- Frame times come from `requestAnimationFrame` in the page. Median FPS is 1000 over the median frame time, p5 FPS is 1000 over the 95th percentile frame time, the longest frame is in milliseconds.
- Two runs per page: capped (default Edge, vsync) and uncapped (`--disable-gpu-vsync --disable-frame-rate-limit`).
- SVG pages from 2 000 nodes up get a 1.5 s probe first and are skipped when a single frame exceeds 1 s.
- Cells read: median FPS / p5 FPS / longest frame (ms).
- On this machine the uncapped flags did not lift the frame limit: the 100-node WebGL page settled at 58.5 FPS median, while the default run followed the display refresh at 303 FPS. Read the capped table as the real headroom and the uncapped table as a second sample.

## Layout and page generation time

| Nodes | layout() (ms) | SVG page (ms) | WebGL page (ms) |
| --- | --- | --- | --- |
| 100 | 204 | 4 | 1 |
| 500 | 702 | 4 | 2 |
| 1 000 | 1282 | 7 | 2 |
| 2 000 | 3748 | 11 | 3 |
| 5 000 | 13084 | 34 | 8 |
| 10 000 | 44034 | 99 | 19 |

## Layout time at 10 000 nodes

`layout()` takes 44034 ms (about 44 s) on 10 000 nodes, against 99 ms for the SVG page and 19 ms for the WebGL page: the layout dominates by far. For large graphs, compute it once and keep the result. `standargraph export` lays the graph out once and writes the positions into the HTML page, which never lays anything out again when opened; in your own code, store the laid-out `x` and `y` of every node as its `position` in the document, and `layout()`, `mount()` and the exports then skip ELK. A faster layout for large graphs is coming soon.

## Capped (display refresh)

| Nodes | SVG | WebGL |
| --- | --- | --- |
| 100 | 303 / 294.1 / 53.3 | 303 / 294.1 / 8.2 |
| 500 | 303 / 294.1 / 486.6 | 303 / 294.1 / 10.1 |
| 1 000 | 303 / 294.1 / 103.4 | 303 / 294.1 / 16.7 |
| 2 000 | 303 / 294.1 / 396.7 | 303 / 294.1 / 30 |
| 5 000 | 294.1 / 59.9 / 540 | 303 / 294.1 / 50 |
| 10 000 | skipped (single frame 1833 ms exceeds 1000 ms) | 303 / 285.7 / 10.2 |

## Uncapped

| Nodes | SVG | WebGL |
| --- | --- | --- |
| 100 | 58.5 / 54.1 / 19 | 58.5 / 54.6 / 19.1 |
| 500 | 58.5 / 54.9 / 435.7 | 58.5 / 55.2 / 19.2 |
| 1 000 | 58.5 / 54.6 / 19 | 58.5 / 54.6 / 19.1 |
| 2 000 | 58.5 / 54.9 / 1542.1 | 58.5 / 54.9 / 34.3 |
| 5 000 | 57.8 / 35.6 / 1148.8 | 58.5 / 54.9 / 19.2 |
| 10 000 | 55.6 / 7.2 / 2320.2 | 58.1 / 54.3 / 19.2 |

## Threshold

The HTML export picks the WebGL renderer automatically above **2000 nodes** (`WEBGL_THRESHOLD`): the largest measured size where the SVG renderer keeps its full frame rate with no sustained stalls. At 5 000 nodes the SVG renderer still reports a high per-frame p5, but it averages about 58 FPS over the run with frames up to 540 ms, so it is not used there.

## v1 gate

10 000 nodes, WebGL: median 303 FPS, p5 285.7 FPS (capped run).

10 000 nodes, WebGL: median 58.1 FPS, p5 54.3 FPS (uncapped run).

## Browser layout worker

`mount()` on a 2000-node document without positions: layout in the worker took 3335 ms, the longest frame on the main thread while the worker ran was 20 ms, the longest frame after the worker answered (scene transfer, view and renderer start) was 657 ms, and `mount()` resolved after 3994 ms.
