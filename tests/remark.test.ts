import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { remarkStandargraph, type RemarkStandargraphOptions } from "../src/remark";

const dir = mkdtempSync(join(tmpdir(), "standargraph-remark-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const VALID = JSON.stringify({
  version: 1,
  kind: "graph",
  nodes: [{ id: "a" }, { id: "b" }],
  edges: [{ from: "a", to: "b" }],
});

function fence(lang: string, body: string): string {
  return `# Title\n\n\`\`\`${lang}\n${body}\n\`\`\`\n`;
}

async function convert(markdown: string, options?: RemarkStandargraphOptions) {
  const file = await unified()
    .use(remarkParse)
    .use(remarkStandargraph, options)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeStringify)
    .process(markdown);
  return String(file);
}

describe("remarkStandargraph", () => {
  test("replaces a valid block with an inline SVG in a figure", async () => {
    const html = await convert(fence("standargraph", VALID));
    expect(html).toContain('<figure class="standargraph">');
    expect(html).toContain("<svg");
    expect(html).not.toContain("<code");
  });

  test("with outDir it writes the HTML page and links to it", async () => {
    const outDir = join(dir, "pages");
    const html = await convert(fence("standargraph", VALID), {
      outDir,
      publicPath: "/diagrams/",
    });
    const hash = createHash("sha256").update(VALID).digest("hex").slice(0, 12);
    expect(existsSync(join(outDir, `${hash}.html`))).toBe(true);
    expect(readFileSync(join(outDir, `${hash}.html`), "utf8")).toContain(
      "<!doctype html>",
    );
    expect(html).toContain(`<a href="/diagrams/${hash}.html">`);
  });

  test("keeps an invalid block and adds an error", async () => {
    const body = JSON.stringify({ version: 2, kind: "graph", nodes: [] });
    const html = await convert(fence("standargraph", body));
    expect(html).toContain("<code");
    expect(html).toContain('<pre class="standargraph-error">');
    expect(html).toContain("Missing or unsupported version");
    expect(html).not.toContain("<svg");
  });

  test("reports malformed JSON without throwing", async () => {
    const html = await convert(fence("standargraph", "{ nope"));
    expect(html).toContain('<pre class="standargraph-error">');
    expect(html).toContain("Invalid JSON");
  });

  test("gives each diagram on a page its own SVG ids", async () => {
    const other = JSON.stringify({
      version: 1,
      kind: "graph",
      nodes: [{ id: "x", meta: { coverage: 0.5 } }, { id: "y" }],
      edges: [{ from: "x", to: "y" }],
    });
    const html = await convert(
      `${fence("standargraph", VALID)}\n${fence("standargraph", other)}`,
    );
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
    expect(ids.length).toBeGreaterThan(4);
    expect(new Set(ids).size).toBe(ids.length);
    expect(html).not.toContain('id="sg-');
  });

  test("leaves other code blocks untouched", async () => {
    const html = await convert(fence("json", VALID));
    expect(html).toContain("<code");
    expect(html).not.toContain("standargraph");
  });
});
