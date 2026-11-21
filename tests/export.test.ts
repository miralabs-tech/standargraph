import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { exportDocument } from "../src/export";
import { RUNTIME_JS } from "../src/html/runtime.generated";
import { layout } from "../src/layout";

function example(name: string): Record<string, any> {
  return JSON.parse(
    readFileSync(new URL(`../examples/${name}.json`, import.meta.url), "utf8"),
  );
}

function embeddedDocument(html: string): any {
  const match = /<script type="application\/json" id="standargraph-document">([\s\S]*?)<\/script>/.exec(
    html,
  );
  expect(match).not.toBeNull();
  return JSON.parse(match![1]!);
}

describe("png", () => {
  test("has a PNG signature and a size matching the scale", async () => {
    const doc = example("architecture");
    const laid = await layout(doc);
    for (const scale of [1, 2]) {
      const { png } = await exportDocument(doc, { formats: ["png"], scale });
      const bytes = png as Uint8Array;
      expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      expect(Math.abs(view.getUint32(16) - laid.width * scale)).toBeLessThanOrEqual(2);
      expect(Math.abs(view.getUint32(20) - laid.height * scale)).toBeLessThanOrEqual(2);
    }
  });
});

describe("pdf", () => {
  test("starts with the PDF header", async () => {
    const { pdf } = await exportDocument(example("protocol"), { formats: ["pdf"] });
    const bytes = pdf as Uint8Array;
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  test("a typed, weighted graph with links and descriptions exports", async () => {
    const doc = {
      version: 1,
      kind: "graph",
      nodes: [{ id: "a", description: "A" }, { id: "b" }],
      edges: [
        { from: "a", to: "b", type: "calls", weight: 3, link: "https://x", description: "d" },
        { from: "b", to: "a", type: "calls", weight: 1 },
      ],
    };
    const { pdf } = await exportDocument(doc, {
      formats: ["pdf"],
      theme: { edgeTypes: { calls: { stroke: "#123456", dash: "dashed" } } },
    });
    expect(new TextDecoder().decode((pdf as Uint8Array).slice(0, 5))).toBe("%PDF-");
  });

  test("two exports of the same document are byte-identical", async () => {
    const doc = example("architecture");
    const first = (await exportDocument(doc, { formats: ["pdf"] })).pdf as Uint8Array;
    const second = (await exportDocument(doc, { formats: ["pdf"] })).pdf as Uint8Array;
    expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true);
  });
});

describe("html", () => {
  test("is one self-contained file", async () => {
    const { html } = await exportDocument(example("architecture"), {
      formats: ["html"],
    });
    const page = html as string;
    expect(page.startsWith("<!doctype html>")).toBe(true);
    expect(page).toContain("<svg ");
    expect(page).toContain('id="standargraph-document"');
    expect(page).toContain(RUNTIME_JS);
    expect(page).toContain("@font-face");
    expect(page).not.toMatch(/<(script|link|img)\b[^>]*\b(src|href)\s*=\s*["']?https?:/i);
    expect(page).not.toMatch(/url\(\s*["']?https?:/i);
  });

  test("embeds the document with a position on every node", async () => {
    const original = example("architecture");
    const { html } = await exportDocument(original, { formats: ["html"] });
    const embedded = embeddedDocument(html as string);
    expect(embedded.nodes.length).toBe(original.nodes.length);
    for (const node of embedded.nodes) {
      expect(typeof node.position.x).toBe("number");
      expect(typeof node.position.y).toBe("number");
    }
  });

  test("a closing script tag inside a label is escaped", async () => {
    const hostile = "</script><img src=x onerror=alert(1)>";
    const { html } = await exportDocument(
      {
        version: 1,
        kind: "graph",
        title: hostile,
        nodes: [{ id: "a", label: hostile }, { id: "b" }],
        edges: [{ from: "a", to: "b" }],
      },
      { formats: ["html"] },
    );
    const page = html as string;
    expect(page).not.toContain(hostile);
    expect(page.split("</script>").length - 1).toBe(3);
    expect(embeddedDocument(page).nodes[0].label).toBe(hostile);
  });

  test("the theme option selects the colors", async () => {
    const doc = example("protocol");
    const auto = (await exportDocument(doc, { formats: ["html"] })).html as string;
    const dark = (await exportDocument(doc, { formats: ["html"], theme: "dark" })).html as string;
    expect(auto).toContain("prefers-color-scheme:dark");
    expect(dark).not.toContain("prefers-color-scheme");
  });
});

describe("exportDocument", () => {
  test("defaults to svg and html", async () => {
    const result = await exportDocument(example("agent-output"));
    expect(Object.keys(result).sort()).toEqual(["html", "svg"]);
  });

  test("rejects an invalid document", async () => {
    await expect(exportDocument({ version: 2 })).rejects.toThrow("Invalid document");
  });
});
