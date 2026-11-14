import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { cpus, platform, release, tmpdir, totalmem } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { generate } from "../scripts/generate";
import { renderHtml } from "../src/html";
import { layout } from "../src/layout";

const SIZES = process.env.BENCH_SIZES?.split(",").map(Number) ?? [100, 500, 1000, 2000, 5000, 10000];
const SCRIPT_MS = Number(process.env.BENCH_SCRIPT_MS ?? 10000);
const SVG_PROBE_LIMIT_MS = 1000;
const PASS_FPS = 50;
const VIEWPORT = { width: 1280, height: 800 };
const UNCAPPED_ARGS = ["--disable-gpu-vsync", "--disable-frame-rate-limit"];
const MOUNT_NODES = 2000;

type Mode = "capped" | "uncapped";
type Renderer = "svg" | "webgl";

type Cell = {
  n: number;
  renderer: Renderer;
  mode: Mode;
  skipped?: string;
  frames?: number;
  medianFps?: number;
  p5Fps?: number;
  longestFrameMs?: number;
};

type Prepared = {
  n: number;
  layoutMs: number;
  exportMs: Record<Renderer, number>;
  files: Record<Renderer, string>;
};

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function quantile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))]!;
}

function summarize(timestamps: number[]): Omit<Cell, "n" | "renderer" | "mode"> {
  const deltas: number[] = [];
  for (let index = 1; index < timestamps.length; index++) {
    deltas.push(timestamps[index]! - timestamps[index - 1]!);
  }
  const sorted = [...deltas].sort((a, b) => a - b);
  return {
    frames: timestamps.length,
    medianFps: round(1000 / quantile(sorted, 0.5)),
    p5Fps: round(1000 / quantile(sorted, 0.95)),
    longestFrameMs: round(sorted[sorted.length - 1]!),
  };
}

async function startRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = { stop: false, stamps: [] as number[] };
    (window as unknown as { __bench: typeof state }).__bench = state;
    const tick = (time: number) => {
      state.stamps.push(time);
      if (!state.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopRecorder(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const state = (window as unknown as { __bench: { stop: boolean; stamps: number[] } }).__bench;
    state.stop = true;
    return state.stamps;
  });
}

async function drive(page: Page, durationMs: number): Promise<void> {
  const centerX = VIEWPORT.width / 2;
  const centerY = VIEWPORT.height / 2 + 40;
  const begin = Date.now();
  const until = (share: number) => begin + durationMs * share;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  let angle = 0;
  while (Date.now() < until(0.3)) {
    angle += 0.12;
    await page.mouse.move(centerX + 160 * Math.cos(angle), centerY + 160 * Math.sin(angle));
  }
  await page.mouse.up();
  await page.mouse.move(centerX, centerY);
  let step = 0;
  while (Date.now() < until(0.6)) {
    step += 1;
    await page.mouse.wheel(0, Math.floor(step / 15) % 2 === 0 ? -90 : 90);
  }
  let t = 0;
  while (Date.now() < until(1)) {
    t += 0.07;
    await page.mouse.move(
      centerX + (VIEWPORT.width / 2.2) * Math.sin(t * 1.3),
      centerY + (VIEWPORT.height / 2.4) * Math.sin(t * 0.9),
    );
  }
}

async function runPage(
  browser: Browser,
  file: string,
  probe: boolean,
): Promise<{ timestamps?: number[]; skipped?: string; gpu?: string }> {
  const page = await browser.newPage({ viewport: VIEWPORT });
  try {
    try {
      await page.goto(pathToFileURL(file).href, { timeout: 120000 });
      await page.waitForSelector('#sg-app[data-sg-ready="1"]', { timeout: 120000 });
    } catch (error) {
      return { skipped: `did not load in 120 s (${(error as Error).name})` };
    }
    await page.waitForTimeout(500);
    const gpu = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      const info = gl?.getExtension("WEBGL_debug_renderer_info");
      return gl !== null && info != null
        ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
        : "unknown";
    });
    if (probe) {
      await startRecorder(page);
      await drive(page, 1500);
      const stamps = await stopRecorder(page);
      let longest = 0;
      for (let index = 1; index < stamps.length; index++) {
        longest = Math.max(longest, stamps[index]! - stamps[index - 1]!);
      }
      if (longest > SVG_PROBE_LIMIT_MS) {
        return {
          skipped: `single frame ${Math.round(longest)} ms exceeds ${SVG_PROBE_LIMIT_MS} ms`,
          gpu,
        };
      }
    }
    await startRecorder(page);
    await drive(page, SCRIPT_MS);
    return { timestamps: await stopRecorder(page), gpu };
  } finally {
    await page.close();
  }
}

async function mountCheck(directory: string): Promise<Record<string, unknown>> {
  const source = fileURLToPath(new URL("../src/html/mount.ts", import.meta.url)).replaceAll("\\", "/");
  const entry = join(directory, "mount-entry.ts");
  writeFileSync(
    entry,
    [
      `import { mount } from ${JSON.stringify(source)};`,
      `(window as any).mountIt = (doc: unknown, options: unknown) =>`,
      `  mount(document.getElementById("c")!, doc, options as never);`,
      "",
    ].join("\n"),
  );
  const built = await Bun.build({
    entrypoints: [entry],
    target: "browser",
    format: "iife",
    banner: "var __require;",
  });
  if (!built.success) throw new Error(built.logs.map(String).join("\n"));
  writeFileSync(join(directory, "mount-entry.js"), await built.outputs[0]!.text());
  const pagePath = join(directory, "mount.html");
  writeFileSync(
    pagePath,
    '<!doctype html><html><body style="margin:0"><div id="c" style="width:1000px;height:700px"></div><script src="mount-entry.js"></script></body></html>',
  );
  const input = generate({ nodes: MOUNT_NODES, seed: 1 });
  const browser = await chromium.launch({ channel: "msedge", headless: false });
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    await page.addInitScript(() => {
      const Original = window.Worker;
      (window as unknown as { Worker: unknown }).Worker = class extends Original {
        constructor(...args: ConstructorParameters<typeof Worker>) {
          super(...args);
          this.addEventListener("message", () => {
            (window as unknown as { __workerDone: number }).__workerDone = performance.now();
          });
        }
      };
    });
    await page.goto(pathToFileURL(pagePath).href);
    const result = await page.evaluate(async (document_) => {
      const stamps: number[] = [];
      let running = true;
      const tick = (time: number) => {
        stamps.push(time);
        if (running) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      const start = performance.now();
      const mounted = await (window as any).mountIt(document_, {});
      const total = performance.now() - start;
      await new Promise((resolve) => setTimeout(resolve, 600));
      running = false;
      const done = (window as unknown as { __workerDone?: number }).__workerDone ?? start;
      let longestDuringWorker = 0;
      let longestAfter = 0;
      for (let index = 1; index < stamps.length; index++) {
        const gap = stamps[index]! - stamps[index - 1]!;
        if (stamps[index]! <= done) longestDuringWorker = Math.max(longestDuringWorker, gap);
        else longestAfter = Math.max(longestAfter, gap);
      }
      return {
        mountMs: Math.round(total),
        workerMs: Math.round(done - start),
        longestFrameDuringWorkerMs: Math.round(longestDuringWorker),
        longestFrameAfterWorkerMs: Math.round(longestAfter),
        rendered: window.document.querySelector("#sg-app")?.getAttribute("data-sg-ready") === "1",
        scale: mounted.view.camera().scale as number,
      };
    }, input);
    return { nodes: MOUNT_NODES, ...result };
  } finally {
    await browser.close();
  }
}

function formatNumber(n: number): string {
  return n >= 1000 ? `${Math.floor(n / 1000)} ${String(n % 1000).padStart(3, "0")}` : String(n);
}

function cellText(cell: Cell | undefined): string {
  if (cell === undefined) return "-";
  if (cell.skipped !== undefined) return `skipped (${cell.skipped})`;
  return `${cell.medianFps} / ${cell.p5Fps} / ${cell.longestFrameMs}`;
}

type Results = {
  date: string;
  machine: Record<string, unknown>;
  prepare: { n: number; layoutMs: number; exportMs: Record<Renderer, number> }[];
  cells: Cell[];
  mount: Record<string, unknown>;
  threshold: number;
};

function report(results: Results): string {
  const find = (n: number, renderer: Renderer, mode: Mode) =>
    results.cells.find((c) => c.n === n && c.renderer === renderer && c.mode === mode);
  const rows = (mode: Mode) =>
    SIZES.map(
      (n) => `| ${formatNumber(n)} | ${cellText(find(n, "svg", mode))} | ${cellText(find(n, "webgl", mode))} |`,
    ).join("\n");
  const gate = (mode: Mode) => {
    const cell = find(10000, "webgl", mode);
    return `10 000 nodes, WebGL: median ${cell?.medianFps} FPS, p5 ${cell?.p5Fps} FPS`;
  };
  const machine = results.machine;
  const mount = results.mount;
  const smallCapped = find(SIZES[0]!, "webgl", "capped")?.medianFps ?? 0;
  const smallUncapped = find(SIZES[0]!, "webgl", "uncapped")?.medianFps ?? 0;
  const capNote =
    smallCapped > 1.5 * smallUncapped
      ? `
- On this machine the uncapped flags did not lift the frame limit: the ${formatNumber(SIZES[0]!)}-node WebGL page settled at ${smallUncapped} FPS median, while the default run followed the display refresh at ${smallCapped} FPS. Read the capped table as the real headroom and the uncapped table as a second sample.`
      : "";
  return `# Benchmark

Measured on ${results.date}. Raw numbers: \`bench/results/${results.date}.json\`. Regenerate with \`bun run bench\`: Playwright drives the installed Microsoft Edge, headed, so the real GPU is used.

## Machine

| | |
| --- | --- |
| CPU | ${machine.cpu} (${machine.cores} threads) |
| Memory | ${machine.memoryGb} GB |
| GPU | ${machine.gpu} |
| OS | ${machine.os} |
| Browser | Microsoft Edge ${machine.edge} |

## Method

- Graphs come from \`scripts/generate.ts\` (seed 1, about 1.25 edges per node, one group per 100 nodes), laid out once by \`layout()\` (ELK layered) and rendered to a self-contained HTML page with the SVG renderer and with the WebGL renderer.
- Each page opens in a ${VIEWPORT.width}x${VIEWPORT.height} window. Once the page signals that the fit is done, a fixed ${SCRIPT_MS / 1000} s script of real mouse input runs: 3 s of pan circles, 3 s of wheel zoom in and out, 4 s of hover sweeps.
- Frame times come from \`requestAnimationFrame\` in the page. Median FPS is 1000 over the median frame time, p5 FPS is 1000 over the 95th percentile frame time, the longest frame is in milliseconds.
- Two runs per page: capped (default Edge, vsync) and uncapped (\`--disable-gpu-vsync --disable-frame-rate-limit\`).
- SVG pages from 2 000 nodes up get a 1.5 s probe first and are skipped when a single frame exceeds 1 s.
- Cells read: median FPS / p5 FPS / longest frame (ms).${capNote}

## Layout and page generation time

| Nodes | layout() (ms) | SVG page (ms) | WebGL page (ms) |
| --- | --- | --- | --- |
${results.prepare.map((p) => `| ${formatNumber(p.n)} | ${p.layoutMs} | ${p.exportMs.svg} | ${p.exportMs.webgl} |`).join("\n")}

## Capped (display refresh)

| Nodes | SVG | WebGL |
| --- | --- | --- |
${rows("capped")}

## Uncapped

| Nodes | SVG | WebGL |
| --- | --- | --- |
${rows("uncapped")}

## Threshold

The HTML export picks the WebGL renderer automatically above **${results.threshold} nodes** (\`WEBGL_THRESHOLD\`): the largest measured size where the SVG renderer keeps a p5 of ${PASS_FPS} FPS or more in the capped run.

## v1 gate

${gate("capped")} (capped run).

${gate("uncapped")} (uncapped run).

## Browser layout worker

\`mount()\` on a ${mount.nodes}-node document without positions: layout in the worker took ${mount.workerMs} ms, the longest frame on the main thread while the worker ran was ${mount.longestFrameDuringWorkerMs} ms, the longest frame after the worker answered (scene transfer, view and renderer start) was ${mount.longestFrameAfterWorkerMs} ms, and \`mount()\` resolved after ${mount.mountMs} ms.
`;
}

async function main(): Promise<void> {
  const directory = process.env.BENCH_OUT ?? mkdtempSync(join(tmpdir(), "standargraph-bench-"));
  mkdirSync(directory, { recursive: true });
  const prepared: Prepared[] = [];
  for (const n of SIZES) {
    const document = generate({ nodes: n, seed: 1 });
    let start = performance.now();
    const laidOut = await layout(document);
    const layoutMs = Math.round(performance.now() - start);
    const exportMs = { svg: 0, webgl: 0 };
    const files = { svg: join(directory, `${n}-svg.html`), webgl: join(directory, `${n}-webgl.html`) };
    for (const renderer of ["svg", "webgl"] as const) {
      start = performance.now();
      const html = renderHtml(document, laidOut, { renderer });
      exportMs[renderer] = Math.round(performance.now() - start);
      writeFileSync(files[renderer], html);
    }
    prepared.push({ n, layoutMs, exportMs, files });
    console.log(`prepared ${n}: layout ${layoutMs} ms`);
  }

  const cells: Cell[] = [];
  let gpu = "unknown";
  let edgeVersion = "unknown";
  for (const mode of ["capped", "uncapped"] as const) {
    const browser = await chromium.launch({
      channel: "msedge",
      headless: false,
      args: mode === "uncapped" ? UNCAPPED_ARGS : [],
    });
    edgeVersion = browser.version();
    try {
      for (const entry of prepared) {
        for (const renderer of ["svg", "webgl"] as const) {
          const outcome = await runPage(browser, entry.files[renderer], renderer === "svg" && entry.n >= 2000);
          if (outcome.gpu !== undefined) gpu = outcome.gpu;
          const cell: Cell = { n: entry.n, renderer, mode };
          if (outcome.timestamps === undefined) cell.skipped = outcome.skipped ?? "no data";
          else Object.assign(cell, summarize(outcome.timestamps));
          cells.push(cell);
          console.log(JSON.stringify(cell));
        }
      }
    } finally {
      await browser.close();
    }
  }

  const mount = await mountCheck(directory);
  console.log(JSON.stringify(mount));

  const passing = SIZES.filter((n) => {
    const cell = cells.find((c) => c.n === n && c.renderer === "svg" && c.mode === "capped");
    return cell?.p5Fps !== undefined && cell.p5Fps >= PASS_FPS;
  });
  const threshold = passing.length === 0 ? SIZES[0]! : Math.max(...passing);
  const date = new Date().toISOString().slice(0, 10);
  const results: Results = {
    date,
    machine: {
      cpu: cpus()[0]?.model.trim() ?? "unknown",
      cores: cpus().length,
      memoryGb: Math.round(totalmem() / 2 ** 30),
      gpu,
      os: `${platform()} ${release()}`,
      edge: edgeVersion,
    },
    prepare: prepared.map(({ n, layoutMs, exportMs }) => ({ n, layoutMs, exportMs })),
    cells,
    mount,
    threshold,
  };
  mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
  writeFileSync(
    new URL(`./results/${date}.json`, import.meta.url),
    `${JSON.stringify({ ...results, method: { sizes: SIZES, scriptMs: SCRIPT_MS, viewport: VIEWPORT, uncappedArgs: UNCAPPED_ARGS } }, null, 2)}\n`,
  );
  writeFileSync(new URL("../docs/bench.md", import.meta.url), report(results));
  console.log(`threshold ${threshold}`);
  if (process.env.BENCH_OUT === undefined) rmSync(directory, { recursive: true, force: true });
}

await main();
process.exit(0);
