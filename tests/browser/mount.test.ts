import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";

const root = resolve(import.meta.dir, "..", "..");
const channel = process.env.STANDARGRAPH_BROWSER_CHANNEL;

const KEYDOWN_COUNTER =
  "window.__live=0;const add=document.addEventListener.bind(document),rem=document.removeEventListener.bind(document);const set=new Set();" +
  "document.addEventListener=function(t,l,o){if(t==='keydown'&&!set.has(l)){set.add(l);window.__live++}return add(t,l,o)};" +
  "document.removeEventListener=function(t,l,o){if(t==='keydown'&&set.has(l)){set.delete(l);window.__live--}return rem(t,l,o)};";

function example(name: string): unknown {
  return JSON.parse(readFileSync(join(root, "examples", `${name}.json`), "utf8"));
}

let directory = "";
let browser: Browser;

async function bundle(name: string, options: string): Promise<string> {
  const entry = join(directory, `${name}-entry.ts`);
  writeFileSync(
    entry,
    [
      `import { mount } from ${JSON.stringify(join(root, "src", "html", "mount.ts").replaceAll("\\", "/"))};`,
      `(window as any).mountInto = (id: string, doc: unknown) => mount(document.getElementById(id)!, doc, ${options});`,
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
  writeFileSync(join(directory, `${name}-entry.js`), await built.outputs[0]!.text());
  const pagePath = join(directory, `${name}.html`);
  writeFileSync(
    pagePath,
    '<!doctype html><html><body style="margin:0">' +
      '<div id="a" style="width:600px;height:500px"></div><div id="b" style="width:600px;height:500px"></div>' +
      `<script>${KEYDOWN_COUNTER}</script><script src="${name}-entry.js"></script></body></html>`,
  );
  return pathToFileURL(pagePath).href;
}

async function open(url: string, errors: string[]): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(url);
  return page;
}

async function mountBoth(page: Page, a: unknown, b: unknown): Promise<void> {
  await page.evaluate(
    async ([first, second]) => {
      const w = window as any;
      w.m1 = await w.mountInto("a", first);
      w.m2 = await w.mountInto("b", second);
    },
    [a, b],
  );
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "standargraph-browser-"));
  browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
}, 60000);

afterAll(async () => {
  await browser?.close();
  if (directory !== "") rmSync(directory, { recursive: true, force: true });
});

describe("mount() with the SVG renderer", () => {
  const errors: string[] = [];
  let page: Page;
  let before = 0;

  beforeAll(async () => {
    page = await open(await bundle("svg", "{}"), errors);
    before = await page.evaluate(() => (window as any).__live as number);
    await mountBoth(page, example("architecture"), example("protocol"));
  }, 60000);

  afterAll(async () => {
    await page?.close();
  });

  test("two instances are ready", async () => {
    const ready = await page.evaluate(() => ({
      a: document.querySelector("#a .sg-app")?.getAttribute("data-sg-ready"),
      b: document.querySelector("#b .sg-app")?.getAttribute("data-sg-ready"),
      apps: document.querySelectorAll(".sg-app").length,
    }));
    expect(ready).toEqual({ a: "1", b: "1", apps: 2 });
  });

  test("each instance registers its own keydown listener", async () => {
    const during = await page.evaluate(() => (window as any).__live as number);
    expect(during).toBe(before + 2);
  });

  test("zoom on one instance leaves the other untouched", async () => {
    const zoom = await page.evaluate(async () => {
      const w = window as any;
      const s1 = w.m1.view.camera().scale as number;
      const s2 = w.m2.view.camera().scale as number;
      (document.querySelector("#b .sg-zoom-in") as HTMLElement).click();
      await new Promise((resolveWait) => setTimeout(resolveWait, 300));
      return {
        s1,
        s2,
        s1After: w.m1.view.camera().scale as number,
        s2After: w.m2.view.camera().scale as number,
      };
    });
    expect(zoom.s1After).toBe(zoom.s1);
    expect(zoom.s2After).not.toBe(zoom.s2);
  });

  test("keydown listeners return to the baseline after destroy", async () => {
    const after = await page.evaluate(() => {
      const w = window as any;
      w.m1.destroy();
      w.m2.destroy();
      return w.__live as number;
    });
    expect(after).toBe(before);
    expect(await page.evaluate(() => document.querySelectorAll(".sg-app").length)).toBe(0);
  });

  test("no page errors", () => {
    expect(errors).toEqual([]);
  });
});

describe("mount() with the WebGL renderer", () => {
  const errors: string[] = [];
  let page: Page;
  let before = 0;

  beforeAll(async () => {
    page = await open(await bundle("webgl", '{ renderer: "webgl" }'), errors);
    before = await page.evaluate(() => (window as any).__live as number);
    await mountBoth(page, example("architecture"), example("architecture"));
    await page.waitForFunction(
      () => document.querySelectorAll('.sg-app[data-sg-ready="1"]').length === 2,
      null,
      { timeout: 30000 },
    );
  }, 60000);

  afterAll(async () => {
    await page?.close();
  });

  test("two instances are ready with a canvas each", async () => {
    const state = await page.evaluate(() => ({
      a: document.querySelectorAll("#a .sg-gl canvas").length,
      b: document.querySelectorAll("#b .sg-gl canvas").length,
      apps: document.querySelectorAll('.sg-app[data-sg-ready="1"]').length,
    }));
    expect(state.apps).toBe(2);
    expect(state.a).toBeGreaterThan(0);
    expect(state.b).toBeGreaterThan(0);
  });

  test("destroy empties the DOM and restores the keydown baseline", async () => {
    const after = await page.evaluate(() => {
      const w = window as any;
      w.m1.destroy();
      w.m2.destroy();
      return w.__live as number;
    });
    expect(after).toBe(before);
    expect(await page.evaluate(() => document.querySelectorAll(".sg-gl, .sg-app, canvas").length)).toBe(0);
  });

  test("no page errors", () => {
    expect(errors).toEqual([]);
  });
});

describe("mount() with the WebGL renderer and node shapes", () => {
  const errors: string[] = [];
  let page: Page;

  beforeAll(async () => {
    page = await open(await bundle("webgl-shapes", '{ renderer: "webgl" }'), errors);
    await page.evaluate(async (doc) => {
      const w = window as any;
      w.m1 = await w.mountInto("a", doc);
    }, example("deploy-flowchart"));
    await page.waitForFunction(
      () => document.querySelectorAll('.sg-app[data-sg-ready="1"]').length === 1,
      null,
      { timeout: 30000 },
    );
  }, 60000);

  afterAll(async () => {
    await page?.close();
  });

  test("a graph with diamond and circle nodes draws on a canvas", async () => {
    expect(await page.evaluate(() => document.querySelectorAll("#a .sg-gl canvas").length)).toBeGreaterThan(0);
  });

  test("no page errors", () => {
    expect(errors).toEqual([]);
  });
});
