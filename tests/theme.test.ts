import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli";
import { exportDocument } from "../src/export";
import { renderHtml } from "../src/html";
import { layout } from "../src/layout";
import { renderSvg } from "../src/svg";
import {
  lightTheme,
  resolveTheme,
  THEMES,
  themeStyle,
  themeVariables,
  typeRules,
} from "../src/svg/theme";

const doc = {
  version: 1,
  kind: "graph",
  nodes: [
    { id: "db", label: "DB", type: "database" },
    { id: "svc", label: "Service", type: "service" },
    {
      id: "gone",
      label: "Gone",
      type: "database",
      meta: { provenance: { source: "s", confidence: "unknown" } },
    },
  ],
  edges: [{ from: "svc", to: "db" }],
};

function section(svg: string, id: string): string {
  const start = svg.indexOf(`data-kind="node" data-id="${id}"`);
  expect(start).toBeGreaterThan(-1);
  return svg.slice(start, svg.indexOf("</g>", start));
}

describe("resolveTheme", () => {
  test("names and a missing option resolve to the built-in tokens", () => {
    expect(resolveTheme(undefined)).toEqual({ tokens: THEMES.light, types: {} });
    expect(resolveTheme("dark")).toEqual({ tokens: THEMES.dark, types: {} });
  });

  test("a theme object overrides the tokens of its base", () => {
    const resolved = resolveTheme({
      base: "dark",
      tokens: { accent: "#e11d48" },
      types: { database: { fill: "#fef3c7" } },
    });
    expect(resolved.tokens).toEqual({ ...THEMES.dark, accent: "#e11d48" });
    expect(resolved.types).toEqual({ database: { fill: "#fef3c7" } });
    expect(resolveTheme({ tokens: { bg: "#000000" } }).tokens.fg).toBe(THEMES.light.fg);
  });

  test("the variables carry the header fill and escape their values", () => {
    expect(themeVariables("light")).toContain("--sg-header-fill:#e2e8f0");
    expect(themeVariables("dark")).toContain("--sg-header-fill:#273449");
    expect(themeVariables({ tokens: { bg: '"><x>' } })).toContain("--sg-bg:&quot;&gt;&lt;x&gt;");
  });
});

describe("lightTheme", () => {
  test("auto and a pair give the light theme", () => {
    expect(lightTheme(undefined)).toBe("light");
    expect(lightTheme("auto")).toBe("light");
    expect(lightTheme("dark")).toBe("dark");
    const light = { tokens: { bg: "#fff" } };
    expect(lightTheme({ light, dark: { base: "dark" as const } })).toBe(light);
    expect(lightTheme(light)).toBe(light);
  });
});

describe("renderSvg with a custom theme", () => {
  const theme = {
    tokens: { bg: "#fffbeb", nodeFill: "#ffffff", headerFill: "#fde68a" },
    types: {
      database: { fill: "#fef3c7", stroke: "#b45309", text: "#78350f" },
      service: { stroke: "#2563eb" },
    },
  };

  test("tokens reach the variables and the presentation attributes", async () => {
    const svg = renderSvg(await layout(doc), { theme });
    expect(svg).toContain("--sg-bg:#fffbeb");
    expect(svg).toContain("--sg-header-fill:#fde68a");
    expect(svg).toContain('<rect class="sg-bg" x="0" y="0"');
    expect(svg).toContain('fill="#fffbeb"/>');
  });

  test("types color the attributes, and unknown confidence wins over the type fill", async () => {
    const svg = renderSvg(await layout(doc), { theme, styles: false });
    const db = section(svg, "db");
    expect(db).toContain('fill="#fef3c7" stroke="#b45309"');
    expect(db).toContain('fill="#78350f">DB</text>');
    const service = section(svg, "svc");
    expect(service).toContain('fill="#ffffff" stroke="#2563eb"');
    const gone = section(svg, "gone");
    expect(gone).toContain(`fill="${THEMES.light.unknownFill}" stroke="#b45309"`);
  });

  test("types produce the rules in order, the unknown rule last", async () => {
    const svg = renderSvg(await layout(doc), { theme });
    const database = svg.indexOf('.sg-root [data-type="database"] .sg-node{fill:#fef3c7;stroke:#b45309}');
    const text = svg.indexOf('.sg-root [data-type="database"] .sg-label{fill:#78350f}');
    const service = svg.indexOf('.sg-root [data-type="service"] .sg-node{stroke:#2563eb}');
    const unknown = svg.indexOf('.sg-root [data-confidence="unknown"] .sg-node{fill:var(--sg-unknown-fill)}');
    expect(database).toBeGreaterThan(svg.indexOf(".sg-lifeline{"));
    expect(text).toBeGreaterThan(database);
    expect(service).toBeGreaterThan(text);
    expect(unknown).toBeGreaterThan(service);
  });

  test("without types no type rule is emitted", async () => {
    const svg = renderSvg(await layout(doc));
    expect(svg).not.toContain("data-type=\"database\"] .sg-node");
    expect(svg).not.toContain('[data-confidence="unknown"] .sg-node');
  });

  test("hostile values and type names stay escaped", async () => {
    const hostile = `"><script>`;
    const svg = renderSvg(await layout({ version: 1, kind: "graph", nodes: [{ id: "a", type: 'a"b\\c' }] }), {
      theme: { tokens: { fg: hostile }, types: { 'a"b\\c': { fill: hostile } } },
    });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain('[data-type="a\\&quot;b\\\\c"]');
  });

  test("the type selector escapes quotes and backslashes", () => {
    expect(typeRules({ 'a"b\\c': { fill: "red" } }, ".sg-root")).toContain(
      '[data-type="a\\&quot;b\\\\c"] .sg-node{fill:red}',
    );
  });
});

describe("themeStyle", () => {
  test("auto writes the default themes, the dark one under the media query", () => {
    const style = themeStyle("auto");
    expect(style).toBe(
      `.sg-app,.sg-app .sg-root{${themeVariables("light")}}@media (prefers-color-scheme:dark){.sg-app,.sg-app .sg-root{${themeVariables("dark")}}}`,
    );
  });

  test("a name or a theme object is fixed", () => {
    expect(themeStyle("dark")).not.toContain("@media");
    const style = themeStyle({ tokens: { accent: "#e11d48" }, types: { db: { fill: "#fef3c7" } } });
    expect(style).not.toContain("@media");
    expect(style).toContain("--sg-accent:#e11d48");
    expect(style).toContain('.sg-app .sg-root [data-type="db"] .sg-node{fill:#fef3c7}');
  });

  test("a pair writes the light theme, then the dark theme under the media query", () => {
    const style = themeStyle({
      light: { tokens: { accent: "#111111" } },
      dark: { base: "dark", tokens: { accent: "#222222" } },
    });
    const media = style.indexOf("@media (prefers-color-scheme:dark)");
    expect(media).toBeGreaterThan(0);
    expect(style.indexOf("--sg-accent:#111111")).toBeLessThan(media);
    expect(style.indexOf("--sg-accent:#222222")).toBeGreaterThan(media);
  });

  test("a type colored only in the light theme falls back to the default colors in dark mode", () => {
    const style = themeStyle({
      light: { types: { database: { fill: "#ff0000", text: "#00ff00" }, cache: { fill: "#0000ff" } } },
      dark: { base: "dark", types: { cache: { fill: "#000080" } } },
    });
    const dark = style.slice(style.indexOf("@media (prefers-color-scheme:dark)"));
    expect(dark).toContain('[data-type="database"] .sg-node{fill:var(--sg-node-fill)}');
    expect(dark).toContain('[data-type="database"] .sg-label{fill:var(--sg-fg)}');
    expect(dark).toContain('[data-type="cache"] .sg-node{fill:#000080}');
    expect(dark).not.toContain("#ff0000");
  });
});

describe("pages and exports", () => {
  test("renderHtml and exportDocument accept a theme object and a pair", async () => {
    const laid = await layout(doc);
    const theme = { types: { database: { fill: "#fef3c7" } } };
    const page = renderHtml(doc as never, laid, { theme });
    expect(page).toContain('.sg-app .sg-root [data-type="database"] .sg-node{fill:#fef3c7}');
    expect(page).not.toContain("prefers-color-scheme");
    const pair = (await exportDocument(doc, {
      formats: ["html"],
      theme: { light: theme, dark: { base: "dark" } },
    })).html as string;
    expect(pair).toContain("prefers-color-scheme:dark");
  });

  test("png and pdf follow a custom theme", async () => {
    const result = await exportDocument(doc, {
      formats: ["svg", "png", "pdf"],
      theme: { tokens: { bg: "#fffbeb" } },
    });
    expect(result.svg).toContain('fill="#fffbeb"');
    expect((result.png as Uint8Array).length).toBeGreaterThan(0);
    expect((result.pdf as Uint8Array).length).toBeGreaterThan(0);
  });
});

describe("--theme <file.json>", () => {
  function withDirectory(body: (dir: string) => Promise<void>): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), "standargraph-"));
    return body(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
  }

  test("a theme file colors the export", () =>
    withDirectory(async (dir) => {
      const file = join(dir, "theme.json");
      writeFileSync(file, JSON.stringify({ tokens: { bg: "#fffbeb" } }));
      expect(
        await run(["export", "examples/architecture.json", "--format", "svg", "--out", dir, "--theme", file]),
      ).toBe(0);
      expect(readFileSync(join(dir, "architecture.svg"), "utf8")).toContain("--sg-bg:#fffbeb");
    }));

  test("a light and dark pair is accepted", () =>
    withDirectory(async (dir) => {
      const file = join(dir, "pair.json");
      writeFileSync(file, JSON.stringify({ light: {}, dark: { base: "dark" } }));
      expect(
        await run(["export", "examples/architecture.json", "--format", "html", "--out", dir, `--theme=${file}`]),
      ).toBe(0);
      expect(readFileSync(join(dir, "architecture.html"), "utf8")).toContain("prefers-color-scheme:dark");
    }));

  test("invalid JSON, a wrong shape or a missing file exit with 2", () =>
    withDirectory(async (dir) => {
      const broken = join(dir, "broken.json");
      writeFileSync(broken, "{ not json");
      const shape = join(dir, "shape.json");
      writeFileSync(shape, JSON.stringify({ tokens: { bg: 3 } }));
      const unknownToken = join(dir, "token.json");
      writeFileSync(unknownToken, JSON.stringify({ tokens: { nope: "#fff" } }));
      for (const file of [broken, shape, unknownToken, join(dir, "missing.json")]) {
        expect(
          await run(["export", "examples/architecture.json", "--out", dir, "--theme", file]),
        ).toBe(2);
      }
      expect(existsSync(join(dir, "architecture.svg"))).toBe(false);
    }));

  test("an unknown theme name still exits with 2", async () => {
    expect(await run(["export", "examples/architecture.json", "--theme", "sepia"])).toBe(2);
  });
});
