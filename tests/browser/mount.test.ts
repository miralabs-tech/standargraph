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

describe("mount() with a state machine", () => {
  const errors: string[] = [];
  let page: Page;

  beforeAll(async () => {
    page = await open(await bundle("state", "{}"), errors);
    await page.evaluate(async (doc) => {
      const w = window as any;
      w.m1 = await w.mountInto("a", doc);
    }, example("order-state"));
  }, 60000);

  afterAll(async () => {
    await page?.close();
  });

  test("the layout runs in the worker and the SVG is drawn", async () => {
    const state = await page.evaluate(() => ({
      ready: document.querySelector("#a .sg-app")?.getAttribute("data-sg-ready"),
      diagram: document.querySelector("#a svg")?.getAttribute("data-diagram"),
      states: document.querySelectorAll("#a [data-kind=state]").length,
      transitions: document.querySelectorAll("#a [data-kind=transition]").length,
    }));
    expect(state).toEqual({ ready: "1", diagram: "state", states: 10, transitions: 10 });
  });

  test("clicking a composite selects it and opens its panel", async () => {
    await page.evaluate(() => (window as any).m1.view.fit());
    const point = await page.evaluate(() => {
      const rect = document.querySelector("#a [data-id=fulfilment] rect")!.getBoundingClientRect();
      return { x: rect.left + 6, y: rect.bottom - 6 };
    });
    await page.mouse.click(point.x, point.y);
    expect(await page.evaluate(() => (window as any).m1.view.selected())).toEqual({
      kind: "state",
      id: "fulfilment",
    });
    expect(await page.evaluate(() => document.querySelector("#a .sg-panel h2")?.textContent)).toBe(
      "Fulfilment",
    );
  });

  test("hovering a composite highlights nothing, hovering a state does", async () => {
    const composite = await page.evaluate(() => {
      const rect = document.querySelector("#a [data-id=fulfilment] rect")!.getBoundingClientRect();
      return { x: rect.left + 6, y: rect.bottom - 6 };
    });
    await page.mouse.move(composite.x, composite.y);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as any).m1.view.hovered())).toBeNull();
    const state = await page.evaluate(() => {
      const rect = document.querySelector("#a [data-id=paid] rect")!.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await page.mouse.move(state.x, state.y);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as any).m1.view.hovered())).toEqual({
      kind: "state",
      id: "paid",
    });
  });

  test("no page errors", () => {
    expect(errors).toEqual([]);
  });
});

describe("mount() with an ER diagram", () => {
  const errors: string[] = [];
  let page: Page;

  beforeAll(async () => {
    page = await open(await bundle("er", "{}"), errors);
    await page.evaluate(async (doc) => {
      const w = window as any;
      w.m1 = await w.mountInto("a", doc);
    }, example("shop-er"));
  }, 60000);

  afterAll(async () => {
    await page?.close();
  });

  test("the layout runs in the worker and the SVG is drawn", async () => {
    const state = await page.evaluate(() => ({
      ready: document.querySelector("#a .sg-app")?.getAttribute("data-sg-ready"),
      diagram: document.querySelector("#a svg")?.getAttribute("data-diagram"),
      entities: document.querySelectorAll("#a [data-kind=entity]").length,
      relations: document.querySelectorAll("#a [data-kind=relation]").length,
      rows: document.querySelectorAll("#a .sg-attr").length,
    }));
    expect(state).toEqual({ ready: "1", diagram: "er", entities: 4, relations: 3, rows: 12 });
  });

  test("clicking an entity selects it and lists its attributes in the panel", async () => {
    await page.evaluate(() => (window as any).m1.view.fit());
    const point = await page.evaluate(() => {
      const rect = document.querySelector("#a [data-id=customer] rect.sg-node")!.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + 6 };
    });
    await page.mouse.click(point.x, point.y);
    expect(await page.evaluate(() => (window as any).m1.view.selected())).toEqual({
      kind: "entity",
      id: "customer",
    });
    const panel = await page.evaluate(() => ({
      title: document.querySelector("#a .sg-panel h2")?.textContent,
      rows: document.querySelectorAll("#a .sg-panel table.sg-data tr").length,
    }));
    expect(panel).toEqual({ title: "Customer", rows: 4 });
  });

  test("selecting a relation shows its cardinality in the panel", async () => {
    await page.evaluate(() => (window as any).m1.view.select({ kind: "relation", id: "r0" }));
    const panel = await page.evaluate(() => ({
      title: document.querySelector("#a .sg-panel h2")?.textContent,
      text: document.querySelector("#a .sg-panel dl")?.textContent,
    }));
    expect(panel.title).toBe("places");
    expect(panel.text).toMatch(/Connectioncustomer\W+order/);
    expect(panel.text).toMatch(/Cardinality1\W+0\.\.\*/);
    expect(panel.text).toContain("Identifyingno");
    await page.evaluate(() => (window as any).m1.view.select(null));
  });

  test("hovering an entity highlights it", async () => {
    const point = await page.evaluate(() => {
      const rect = document.querySelector("#a [data-id=product] rect.sg-node")!.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as any).m1.view.hovered())).toEqual({
      kind: "entity",
      id: "product",
    });
  });

  test("no page errors", () => {
    expect(errors).toEqual([]);
  });
});

describe("mount() with a text source", () => {
  const errors: string[] = [];
  let page: Page;

  beforeAll(async () => {
    page = await open(await bundle("text", "{}"), errors);
  }, 60000);

  afterAll(async () => {
    await page?.close();
  });

  test("a string in the text syntax is parsed and drawn", async () => {
    const source = readFileSync(join(root, "examples", "architecture.sg"), "utf8");
    const state = await page.evaluate(async (text) => {
      const w = window as any;
      w.m1 = await w.mountInto("a", text);
      return {
        ready: document.querySelector("#a .sg-app")?.getAttribute("data-sg-ready"),
        nodes: document.querySelectorAll("#a [data-kind=node]").length,
      };
    }, source);
    expect(state.ready).toBe("1");
    expect(state.nodes).toBeGreaterThan(0);
  });

  test("a text error is thrown with its line and column", async () => {
    const message = await page.evaluate(async () => {
      const w = window as any;
      try {
        await w.mountInto("b", "graph" + String.fromCharCode(10, 10) + "a %");
        return "";
      } catch (error) {
        return String(error);
      }
    });
    expect(message).toContain("Invalid document:");
    expect(message).toContain("3:3: Unexpected character");
    expect(message).toContain("[E_TOKEN]");
  });

  test("no page errors", () => {
    expect(errors).toEqual([]);
  });
});

describe("mount() with a mindmap", () => {
  const errors: string[] = [];
  let page: Page;

  beforeAll(async () => {
    page = await open(await bundle("tree", "{}"), errors);
    await page.evaluate(async (doc) => {
      const w = window as any;
      w.m1 = await w.mountInto("a", doc);
    }, example("roadmap-mindmap"));
  }, 60000);

  afterAll(async () => {
    await page?.close();
  });

  test("the tree is laid out on the main thread and the SVG is drawn", async () => {
    const state = await page.evaluate(() => ({
      ready: document.querySelector("#a .sg-app")?.getAttribute("data-sg-ready"),
      diagram: document.querySelector("#a svg")?.getAttribute("data-diagram"),
      layout: document.querySelector("#a svg")?.getAttribute("data-layout"),
      nodes: document.querySelectorAll("#a [data-kind=node]").length,
      edges: document.querySelectorAll("#a [data-kind=edge]").length,
      left: document.querySelectorAll("#a [data-side=left]").length,
    }));
    expect(state).toEqual({
      ready: "1",
      diagram: "tree",
      layout: "mindmap",
      nodes: 12,
      edges: 11,
      left: 4,
    });
  });

  test("clicking a node selects it and the panel shows its parent and depth", async () => {
    await page.evaluate(() => (window as any).m1.view.fit());
    const point = await page.evaluate(() => {
      const rect = document.querySelector("#a [data-id=webgl] rect.sg-node")!.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await page.mouse.click(point.x, point.y);
    expect(await page.evaluate(() => (window as any).m1.view.selected())).toEqual({
      kind: "node",
      id: "webgl",
    });
    const panel = await page.evaluate(() => ({
      title: document.querySelector("#a .sg-panel h2")?.textContent,
      text: document.querySelector("#a .sg-panel dl")?.textContent,
    }));
    expect(panel.title).toBe("WebGL");
    expect(panel.text).toContain("KindNode");
    expect(panel.text).toContain("ParentRendering");
    expect(panel.text).toContain("Depth2");
    expect(panel.text).toContain("DescriptionSigma.js above 2000 nodes");
    await page.evaluate(() => (window as any).m1.view.select(null));
  });

  test("hovering a node highlights it", async () => {
    const point = await page.evaluate(() => {
      const rect = document.querySelector("#a [data-id=github] rect.sg-node")!.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as any).m1.view.hovered())).toEqual({
      kind: "node",
      id: "github",
    });
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

describe("mount() with the WebGL renderer and typed colors", () => {
  const errors: string[] = [];
  let page: Page;

  beforeAll(async () => {
    page = await open(
      await bundle(
        "webgl-types",
        '{ renderer: "webgl", theme: { types: { database: { fill: "#ff0000", stroke: "#880000" } } } }',
      ),
      errors,
    );
    await page.evaluate(async (doc) => {
      const w = window as any;
      w.m1 = await w.mountInto("a", doc);
    }, example("architecture"));
    await page.waitForFunction(
      () => document.querySelectorAll('.sg-app[data-sg-ready="1"]').length === 1,
      null,
      { timeout: 30000 },
    );
  }, 60000);

  afterAll(async () => {
    await page?.close();
  });

  test("the type rule reaches an SVG node inside the app and no probe is left behind", async () => {
    const state = await page.evaluate(() => {
      const app = document.querySelector("#a .sg-app")!;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "sg-root");
      const holder = document.createElementNS("http://www.w3.org/2000/svg", "g");
      holder.setAttribute("data-type", "database");
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("class", "sg-node");
      holder.append(rect);
      svg.append(holder);
      app.append(svg);
      const style = getComputedStyle(rect);
      const result = { fill: style.fill, stroke: style.stroke };
      svg.remove();
      return { ...result, left: document.querySelectorAll("#a .sg-root").length };
    });
    expect(state).toEqual({ fill: "rgb(255, 0, 0)", stroke: "rgb(136, 0, 0)", left: 0 });
  });

  test("no page errors", () => {
    expect(errors).toEqual([]);
  });
});

async function background(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.querySelector("#a .sg-app")!).backgroundColor);
}

describe("mount() with the color scheme switch", () => {
  const errors: string[] = [];
  let page: Page;
  let url = "";

  beforeAll(async () => {
    url = await bundle("scheme", "{}");
    page = await open(url, errors);
    await page.emulateMedia({ colorScheme: "light" });
    await mountBoth(page, example("architecture"), example("protocol"));
  }, 60000);

  afterAll(async () => {
    await page?.close();
  });

  test("the button cycles auto, light and dark and the forced scheme wins over the media query", async () => {
    const label = () => page.getAttribute("#a .sg-scheme", "aria-label");
    expect(await label()).toBe("Color scheme: auto");
    expect(await page.getAttribute("#a .sg-app", "data-sg-scheme")).toBeNull();
    expect(await background(page)).toBe("rgb(255, 255, 255)");

    await page.click("#a .sg-scheme");
    expect(await label()).toBe("Color scheme: light");
    expect(await page.getAttribute("#a .sg-scheme", "title")).toBe("Color scheme: light");
    expect(await page.getAttribute("#a .sg-app", "data-sg-scheme")).toBe("light");
    expect(await background(page)).toBe("rgb(255, 255, 255)");

    await page.click("#a .sg-scheme");
    expect(await label()).toBe("Color scheme: dark");
    expect(await page.getAttribute("#a .sg-app", "data-sg-scheme")).toBe("dark");
    expect(await background(page)).toBe("rgb(15, 23, 42)");

    await page.emulateMedia({ colorScheme: "dark" });
    await page.click("#a .sg-scheme");
    expect(await page.getAttribute("#a .sg-app", "data-sg-scheme")).toBeNull();
    expect(await background(page)).toBe("rgb(15, 23, 42)");
    await page.click("#a .sg-scheme");
    expect(await page.getAttribute("#a .sg-app", "data-sg-scheme")).toBe("light");
    expect(await background(page)).toBe("rgb(255, 255, 255)");
    await page.emulateMedia({ colorScheme: "light" });
  });

  test("a change updates only its own instance", async () => {
    expect(await page.getAttribute("#a .sg-app", "data-sg-scheme")).toBe("light");
    expect(await page.getAttribute("#b .sg-app", "data-sg-scheme")).toBeNull();
    expect(await page.getAttribute("#b .sg-scheme", "aria-label")).toBe("Color scheme: auto");
  });

  test("the choice is kept in localStorage and applied again after a reload", async () => {
    await page.click("#a .sg-scheme");
    expect(await page.evaluate(() => localStorage.getItem("standargraph-scheme"))).toBe("dark");
    await page.reload();
    await mountBoth(page, example("architecture"), example("protocol"));
    expect(await page.getAttribute("#a .sg-app", "data-sg-scheme")).toBe("dark");
    expect(await page.getAttribute("#b .sg-app", "data-sg-scheme")).toBe("dark");
    expect(await page.getAttribute("#a .sg-scheme", "aria-label")).toBe("Color scheme: dark");
    expect(await background(page)).toBe("rgb(15, 23, 42)");
  });

  test("a broken localStorage leaves the page on the system scheme", async () => {
    const broken = await open(url, errors);
    await broken.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new Error("denied");
        },
      });
    });
    await broken.reload();
    await mountBoth(broken, example("architecture"), example("protocol"));
    expect(await broken.getAttribute("#a .sg-app", "data-sg-scheme")).toBeNull();
    await broken.click("#a .sg-scheme");
    expect(await broken.getAttribute("#a .sg-app", "data-sg-scheme")).toBe("light");
    await broken.close();
  });

  test("a typed node follows the palette of the forced scheme", async () => {
    await page.click("#a .sg-scheme");
    const fills = await page.evaluate(() => {
      const fill = () => getComputedStyle(document.querySelector('#a [data-type="database"] .sg-node')!).fill;
      const app = document.querySelector("#a .sg-app")!;
      app.setAttribute("data-sg-scheme", "light");
      const light = fill();
      app.setAttribute("data-sg-scheme", "dark");
      return { light, dark: fill() };
    });
    expect(fills.light).not.toBe(fills.dark);
  });

  test("no page errors", () => {
    expect(errors).toEqual([]);
  });
});

describe("mount() with a fixed theme", () => {
  const errors: string[] = [];
  let page: Page;

  beforeAll(async () => {
    page = await open(await bundle("fixed", '{ theme: "nord" }'), errors);
    await mountBoth(page, example("architecture"), example("protocol"));
  }, 60000);

  afterAll(async () => {
    await page?.close();
  });

  test("the switch is not shown and the palette name sets the background", async () => {
    expect(await page.evaluate(() => document.querySelectorAll(".sg-scheme").length)).toBe(0);
    expect(await background(page)).toBe("rgb(46, 52, 64)");
  });

  test("no page errors", () => {
    expect(errors).toEqual([]);
  });
});

describe("mount() with the WebGL renderer and the color scheme switch", () => {
  const errors: string[] = [];
  let page: Page;

  beforeAll(async () => {
    page = await open(await bundle("webgl-scheme", '{ renderer: "webgl" }'), errors);
    await page.emulateMedia({ colorScheme: "light" });
    await page.evaluate(async (doc) => {
      const w = window as any;
      w.m1 = await w.mountInto("a", doc);
    }, example("architecture"));
    await page.waitForFunction(
      () => document.querySelectorAll('.sg-app[data-sg-ready="1"]').length === 1,
      null,
      { timeout: 30000 },
    );
  }, 60000);

  afterAll(async () => {
    await page?.close();
  });

  test("switching to dark recolors the app and the canvas keeps drawing", async () => {
    await page.click("#a .sg-scheme");
    await page.click("#a .sg-scheme");
    expect(await page.getAttribute("#a .sg-app", "data-sg-scheme")).toBe("dark");
    expect(await background(page)).toBe("rgb(15, 23, 42)");
    expect(await page.evaluate(() => document.querySelectorAll("#a .sg-gl canvas").length)).toBeGreaterThan(0);
  });

  test("no page errors", () => {
    expect(errors).toEqual([]);
  });
});
