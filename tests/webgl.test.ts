import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { generate } from "../scripts/generate";
import { run } from "../src/cli";
import { WEBGL_THRESHOLD } from "../src/core";
import { renderHtml } from "../src/html";
import { layout } from "../src/layout";
import { renderWebglHtml } from "../src/webgl";

function example(name: string): any {
  return JSON.parse(readFileSync(new URL(`../examples/${name}.json`, import.meta.url), "utf8"));
}

function embeddedScene(html: string): any {
  const match = /<script type="application\/json" id="standargraph-scene">([\s\S]*?)<\/script>/.exec(html);
  expect(match).not.toBeNull();
  return JSON.parse(match![1]!);
}

test("renderWebglHtml is one self-contained file", async () => {
  const doc = example("architecture");
  const laid = await layout(doc);
  const html = renderWebglHtml(doc, laid);
  expect(html.startsWith("<!doctype html>")).toBe(true);
  expect(html).toContain('class="sg-gl"');
  expect(html).toContain('class="sg-groups"');
  expect(html).not.toMatch(/(?:src|href)=["']https?:/);
  expect(html).not.toMatch(/url\(["']?https?:/);
  expect(html).toContain("rgb(");
  expect(embeddedScene(html)).toEqual(laid);
});

test("renderWebglHtml escapes a closing script tag in the data", async () => {
  const doc = example("architecture");
  doc.nodes[0].label = "</script><script>alert(1)</script>";
  const html = renderWebglHtml(doc, await layout(doc));
  expect(html).not.toContain("</script><script>alert(1)");
  expect(html.match(/<\/script>/g)!.length).toBe(3);
  expect(embeddedScene(html).nodes[0].label).toBe("</script><script>alert(1)</script>");
});

test("auto picks WebGL above the threshold and SVG below it and for sequences", async () => {
  const small = example("architecture");
  const smallHtml = renderHtml(small, await layout(small));
  expect(smallHtml).toContain('class="sg-stage"');
  expect(smallHtml).not.toContain('class="sg-gl"');

  const large = generate({ nodes: WEBGL_THRESHOLD + 1, seed: 1, groups: 3 });
  for (const node of large.nodes) {
    const index = Number(node.id.slice(1));
    node.position = { x: (index % 100) * 200, y: Math.floor(index / 100) * 80 };
  }
  const largeLaid = await layout(large);
  expect(renderHtml(large, largeLaid)).toContain('class="sg-gl"');
  expect(renderHtml(large, largeLaid, { renderer: "svg" })).toContain('class="sg-stage"');
  expect(renderHtml(small, await layout(small), { renderer: "webgl" })).toContain('class="sg-gl"');

  const sequence = example("protocol");
  const sequenceLaid = await layout(sequence);
  expect(renderHtml(sequence, sequenceLaid, { renderer: "webgl" })).toContain('class="sg-stage"');
});

test("the CLI accepts svg, webgl and auto and rejects anything else with 2", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "standargraph-"));
  try {
    for (const renderer of ["svg", "webgl", "auto"]) {
      const code = await run([
        "export",
        "examples/architecture.json",
        "--format",
        "html",
        "--renderer",
        renderer,
        "--out",
        dir,
      ]);
      expect(code).toBe(0);
    }
    expect(
      await run(["export", "examples/architecture.json", "--format", "html", "--renderer", "canvas", "--out", dir]),
    ).toBe(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
