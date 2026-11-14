import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { buildSite } from "../../scripts/site";
import { run } from "../../src/cli";

const channel = process.env.STANDARGRAPH_BROWSER_CHANNEL;

const SMALL_GRAPH = ['graph "Typed in the playground"', "", 'alpha "Alpha"', 'beta "Beta"', "alpha -> beta", ""].join("\n");

let directory = "";
let site = "";
let browser: Browser;

async function open(url: string, errors: string[]): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(url);
  return page;
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "standargraph-site-"));
  site = resolve(directory, "site");
  await buildSite(site);
  browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
}, 120000);

afterAll(async () => {
  await browser?.close();
  if (directory !== "") rmSync(directory, { recursive: true, force: true });
});

describe("the built site playground", () => {
  const errors: string[] = [];
  let page: Page;

  beforeAll(async () => {
    page = await open(pathToFileURL(join(site, "index.html")).href, errors);
    await page.waitForSelector('#preview .sg-app[data-sg-ready="1"]', { timeout: 30000 });
  }, 60000);

  afterAll(async () => {
    await page?.close();
  });

  test("the first example is rendered on load and the downloads are enabled", async () => {
    const state = await page.evaluate(() => ({
      nodes: document.querySelectorAll("#preview [data-kind=node]").length,
      disabled: (document.getElementById("download-svg") as HTMLButtonElement).disabled,
      options: document.querySelectorAll("#example option").length,
    }));
    expect(state.nodes).toBeGreaterThan(0);
    expect(state.disabled).toBe(false);
    expect(state.options).toBe(8);
  });

  test("a small .sg graph typed in the textarea is rendered", async () => {
    await page.fill("#source", SMALL_GRAPH);
    await page.waitForFunction(
      () => document.querySelectorAll("#preview [data-kind=node]").length === 2,
      null,
      { timeout: 30000 },
    );
    const state = await page.evaluate(() => ({
      ready: document.querySelector("#preview .sg-app")?.getAttribute("data-sg-ready"),
      ids: [...document.querySelectorAll("#preview [data-kind=node]")].map((node) =>
        node.getAttribute("data-id"),
      ),
      errors: document.querySelectorAll("#errors li").length,
    }));
    expect(state.ready).toBe("1");
    expect(state.ids).toEqual(["alpha", "beta"]);
    expect(state.errors).toBe(0);
  });

  test("the editor overlay gives a -> and a string their classes and keeps the textarea metrics", async () => {
    await page.fill("#source", SMALL_GRAPH);
    await page.waitForFunction(() => document.querySelector("#highlight .tk-operator") !== null, null, {
      timeout: 10000,
    });
    const state = await page.evaluate(() => {
      const text = (selector: string) => [...document.querySelectorAll(selector)].map((node) => node.textContent);
      const style = (id: string) => {
        const computed = getComputedStyle(document.getElementById(id)!);
        return [computed.fontFamily, computed.fontSize, computed.lineHeight, computed.paddingLeft, computed.paddingTop, computed.tabSize];
      };
      return {
        operators: text("#highlight .tk-operator"),
        strings: text("#highlight .tk-string"),
        keywords: text("#highlight .tk-keyword"),
        declarations: text("#highlight .tk-variable.tk-declaration"),
        same: JSON.stringify(style("highlight")) === JSON.stringify(style("source")),
      };
    });
    expect(state.operators).toEqual(["->"]);
    expect(state.strings).toEqual(["\"Typed in the playground\"", "\"Alpha\"", "\"Beta\""]);
    expect(state.keywords).toEqual(["graph"]);
    expect(state.declarations).toEqual(["alpha", "beta"]);
    expect(state.same).toBe(true);
  });

  test("the overlay follows the scroll of the textarea", async () => {
    const lines = ["graph", "", ...Array.from({ length: 120 }, (_, index) => `n${index} -> n${index + 1} "a long label that goes past the right edge of the editor pane when written in full ${index}"`)];
    await page.fill("#source", lines.join("\n"));
    await page.waitForFunction(() => document.querySelectorAll("#highlight .tk-operator").length === 120, null, {
      timeout: 10000,
    });
    await page.evaluate(() => {
      const area = document.getElementById("source")!;
      area.scrollTop = 400;
      area.scrollLeft = 120;
    });
    await page.waitForFunction(() => document.getElementById("highlight")!.scrollTop > 0, null, { timeout: 5000 });
    const scroll = await page.evaluate(() => {
      const area = document.getElementById("source")!;
      const layer = document.getElementById("highlight")!;
      return { top: [area.scrollTop, layer.scrollTop], left: [area.scrollLeft, layer.scrollLeft] };
    });
    expect(scroll.top[1]).toBe(scroll.top[0]);
    expect(scroll.left[1]).toBe(scroll.left[0]);
    await page.fill("#source", SMALL_GRAPH);
  });

  test("a syntax error is listed with its line and column", async () => {
    await page.fill("#source", `graph${String.fromCharCode(10, 10)}a %`);
    await page.waitForFunction(() => document.querySelectorAll("#errors li").length > 0, null, {
      timeout: 10000,
    });
    const text = await page.evaluate(() => document.querySelector("#errors li")?.textContent);
    expect(text).toContain("3:3: Unexpected character");
  });

  test("no page errors", () => {
    expect(errors).toEqual([]);
  });
});

describe("a built example page", () => {
  const errors: string[] = [];
  let page: Page;

  beforeAll(async () => {
    page = await open(pathToFileURL(join(site, "examples", "architecture.html")).href, errors);
    await page.waitForSelector('.sg-app[data-sg-ready="1"]', { timeout: 30000 });
  }, 60000);

  afterAll(async () => {
    await page?.close();
  });

  test("the interactive viewer is drawn", async () => {
    const state = await page.evaluate(() => ({
      diagram: document.querySelector("svg[data-diagram]")?.getAttribute("data-diagram"),
      nodes: document.querySelectorAll("[data-kind=node]").length,
    }));
    expect(state.diagram).toBe("graph");
    expect(state.nodes).toBeGreaterThan(0);
  });

  test("no page errors", () => {
    expect(errors).toEqual([]);
  });
});

describe("the playground theme panel", () => {
  const errors: string[] = [];
  let page: Page;

  const fill = (type: string) =>
    page.evaluate(
      (name) =>
        (() => {
          const node = document.querySelector(`#preview [data-type="${name}"] .sg-node`);
          return node === null ? "" : getComputedStyle(node).fill;
        })(),
      type,
    );
  const background = () =>
    page.evaluate(() => {
      const app = document.querySelector("#preview .sg-app");
      return app === null ? "" : getComputedStyle(app).backgroundColor;
    });
  async function waitFor(expected: string, read: () => Promise<string>): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((await read()) === expected) return;
      await page.waitForTimeout(100);
    }
    expect(await read()).toBe(expected);
  }

  beforeAll(async () => {
    page = await open(pathToFileURL(join(site, "index.html")).href, errors);
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForSelector('#preview .sg-app[data-sg-ready="1"]', { timeout: 30000 });
    await page.click("#theme summary");
  }, 60000);

  afterAll(async () => {
    await page?.close();
  });

  test("the palette select lists auto and the six names, with a color input per token and per type", async () => {
    const state = await page.evaluate(() => ({
      palettes: [...document.querySelectorAll("#palette option")].map((option) => (option as HTMLOptionElement).value),
      tokens: document.querySelectorAll("#tokens input[type=color]").length,
      types: [...document.querySelectorAll('#types input[data-key="fill"]')].map((input) => (input as HTMLInputElement).dataset.type),
    }));
    expect(state.palettes).toEqual(["auto", "light", "dark", "nord", "solarized-light", "solarized-dark", "high-contrast"]);
    expect(state.tokens).toBe(13);
    expect(state.types).toContain("database");
    expect(state.types).toContain("service");
  });

  test("a palette name re-renders the preview and a fixed palette hides the scheme switch", async () => {
    await page.selectOption("#palette", "nord");
    await waitFor("rgb(46, 52, 64)", background);
    expect(await page.evaluate(() => document.querySelectorAll("#preview .sg-scheme").length)).toBe(0);
    expect(await page.evaluate(() => (document.getElementById("scheme") as HTMLSelectElement).disabled)).toBe(true);
  });

  test("a type color input changes the node fill", async () => {
    await page.fill('#types input[data-type="database"][data-key="fill"]', "#ff0000");
    await waitFor("rgb(255, 0, 0)", () => fill("database"));
  });

  test("palette off removes the automatic type colors", async () => {
    await page.click("#theme-reset");
    await waitFor("rgb(255, 255, 255)", background);
    const colored = await fill("service");
    await page.check("#palette-off");
    await waitFor("rgb(255, 255, 255)", () => fill("service"));
    expect(colored).not.toBe("rgb(255, 255, 255)");
    await page.uncheck("#palette-off");
    await waitFor(colored, () => fill("service"));
  });

  test("the scheme select forces dark on an auto palette", async () => {
    await page.selectOption("#scheme", "dark");
    await waitFor("rgb(15, 23, 42)", background);
    expect(await page.getAttribute("#preview .sg-app", "data-sg-scheme")).toBe("dark");
    expect(await page.getAttribute("#preview .sg-scheme", "aria-label")).toBe("Color scheme: dark");
    await page.selectOption("#scheme", "auto");
    await waitFor("rgb(255, 255, 255)", background);
  });

  test("Download theme.json gives a file the CLI accepts", async () => {
    await page.selectOption("#palette", "nord");
    await waitFor("rgb(46, 52, 64)", background);
    await page.fill('#types input[data-type="database"][data-key="fill"]', "#ff0000");
    await waitFor("rgb(255, 0, 0)", () => fill("database"));
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#download-theme")]);
    expect(download.suggestedFilename()).toBe("theme.json");
    const file = join(directory, "theme.json");
    await download.saveAs(file);
    const theme = JSON.parse(readFileSync(file, "utf8"));
    expect(theme.base).toBe("nord");
    expect(theme.types.database.fill).toBe("#ff0000");
    expect(await run(["export", "examples/architecture.json", "--format", "svg", "--out", directory, "--theme", file])).toBe(0);
    const svg = readFileSync(join(directory, "architecture.svg"), "utf8");
    expect(svg).toContain("--sg-bg:#2e3440");
    expect(svg).toContain("#ff0000");
  });

  test("the auto palette downloads a light and dark pair the CLI accepts", async () => {
    await page.selectOption("#palette", "auto");
    await page.check("#palette-off");
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#download-theme")]);
    const file = join(directory, "pair.json");
    await download.saveAs(file);
    const theme = JSON.parse(readFileSync(file, "utf8"));
    expect(theme.light.base).toBe("light");
    expect(theme.dark.base).toBe("dark");
    expect(theme.light.palette).toBe(false);
    expect(await run(["export", "examples/architecture.json", "--format", "html", "--out", directory, "--theme", file])).toBe(0);
  });

  test("no page errors", () => {
    expect(errors).toEqual([]);
  });
});
