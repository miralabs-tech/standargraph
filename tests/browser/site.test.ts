import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { buildSite } from "../../scripts/site";

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
