import { describe, expect, test } from "bun:test";
import { exportDocument } from "../src/export";
import { renderHtml } from "../src/html";
import { layout } from "../src/layout";
import { remarkStandargraph } from "../src/remark";
import { renderSvg } from "../src/svg";
import {
  isAdaptive,
  isThemeName,
  lightTheme,
  PALETTES,
  paletteEntry,
  resolveTheme,
  THEME_BASES,
  THEME_NAMES,
  THEMES,
  themeStyle,
  typeHash,
  typesPresent,
  withoutPalette,
  withPalette,
} from "../src/svg/theme";

function channel(value: string, offset: number): number {
  const unit = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
  return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

function luminance(color: string): number {
  return 0.2126 * channel(color, 1) + 0.7152 * channel(color, 3) + 0.0722 * channel(color, 5);
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

const MINIMUM = 4.5;

const doc = {
  version: 1,
  kind: "graph",
  nodes: [
    { id: "db", label: "DB", type: "database" },
    { id: "svc", label: "Service", type: "service" },
    { id: "plain", label: "Plain" },
    {
      id: "gone",
      label: "Gone",
      type: "database",
      meta: { provenance: { source: "s", confidence: "unknown" } },
    },
  ],
  edges: [{ from: "svc", to: "db", type: "calls" }],
};

function section(svg: string, id: string): string {
  const start = svg.indexOf(`data-kind="node" data-id="${id}"`);
  expect(start).toBeGreaterThan(-1);
  return svg.slice(start, svg.indexOf("</g>", start));
}

describe("named palettes", () => {
  test("the six names are known and each has tokens, a base and 8 to 10 palette entries", () => {
    expect([...THEME_NAMES]).toEqual([
      "light",
      "dark",
      "nord",
      "solarized-light",
      "solarized-dark",
      "high-contrast",
    ]);
    for (const name of THEME_NAMES) {
      expect(isThemeName(name)).toBe(true);
      expect(Object.keys(THEMES[name]).sort()).toEqual(Object.keys(THEMES.light).sort());
      expect(["light", "dark"]).toContain(THEME_BASES[name]);
      expect(PALETTES[name].length).toBeGreaterThanOrEqual(8);
      expect(PALETTES[name].length).toBeLessThanOrEqual(10);
    }
    expect(isThemeName("sepia")).toBe(false);
    expect(isThemeName("auto")).toBe(false);
  });

  for (const name of THEME_NAMES) {
    test(`${name}: text, node fills and every auto palette entry reach ${MINIMUM}:1`, () => {
      const tokens = THEMES[name];
      expect(contrast(tokens.fg, tokens.bg)).toBeGreaterThanOrEqual(MINIMUM);
      expect(contrast(tokens.fg, tokens.nodeFill)).toBeGreaterThanOrEqual(MINIMUM);
      expect(contrast(tokens.fg, tokens.unknownFill)).toBeGreaterThanOrEqual(MINIMUM);
      expect(contrast(tokens.fg, tokens.groupFill)).toBeGreaterThanOrEqual(MINIMUM);
      expect(contrast(tokens.fg, tokens.headerFill)).toBeGreaterThanOrEqual(MINIMUM);
      expect(contrast(tokens.fg, tokens.labelBg)).toBeGreaterThanOrEqual(MINIMUM);
      expect(contrast(tokens.muted, tokens.bg)).toBeGreaterThanOrEqual(MINIMUM);
      for (const { fill, text } of PALETTES[name]) {
        expect(contrast(text, fill)).toBeGreaterThanOrEqual(MINIMUM);
      }
    });
  }

  test("a name resolves to its tokens and palette, and base accepts a name", () => {
    expect(resolveTheme("nord")).toEqual({
      tokens: THEMES.nord,
      types: {},
      edgeTypes: {},
      palette: PALETTES.nord,
    });
    const resolved = resolveTheme({ base: "solarized-dark", tokens: { accent: "#ff0000" } });
    expect(resolved.tokens).toEqual({ ...THEMES["solarized-dark"], accent: "#ff0000" });
    expect(resolved.palette).toBe(PALETTES["solarized-dark"]);
  });

  test("a named theme colors the SVG", async () => {
    const svg = renderSvg(await layout(doc), { theme: "nord" });
    expect(svg).toContain(`--sg-bg:${THEMES.nord.bg}`);
    expect(svg).toContain(`fill="${THEMES.nord.bg}"/>`);
  });
});

describe("automatic palette", () => {
  test("the hash is FNV-1a and stays stable", () => {
    expect(typeHash("")).toBe(0x811c9dc5);
    expect(typeHash("a")).toBe(0xe40c292c);
    expect(typeHash("database")).toBe(typeHash("database"));
    expect(typeHash("database")).not.toBe(typeHash("service"));
    expect(paletteEntry(PALETTES.light, "database")).toBe(
      PALETTES.light[typeHash("database") % PALETTES.light.length]!,
    );
  });

  test("a typed node gets the palette entry in the attributes and in the rules", async () => {
    const entry = paletteEntry(PALETTES.light, "database");
    const svg = renderSvg(await layout(doc));
    expect(section(svg, "db")).toContain(`fill="${entry.fill}" stroke="${entry.stroke}"`);
    expect(section(svg, "db")).toContain(`fill="${entry.text}">DB</text>`);
    expect(svg).toContain(
      `.sg-root [data-type="database"] .sg-node{fill:${entry.fill};stroke:${entry.stroke}}`,
    );
    expect(svg).toContain(`.sg-root [data-type="database"] .sg-label{fill:${entry.text}}`);
  });

  test("an untyped node keeps the plain colors and an edge type gets no node rule", async () => {
    const svg = renderSvg(await layout(doc));
    expect(section(svg, "plain")).toContain(`fill="${THEMES.light.nodeFill}"`);
    expect(svg).not.toContain('.sg-root [data-type="calls"]');
  });

  test("a typed graph edge gets a palette stroke rule and no dash", async () => {
    const entry = paletteEntry(PALETTES.light, "calls");
    const svg = renderSvg(await layout(doc));
    expect(svg).toContain(
      `.sg-root [data-kind="edge"][data-type="calls"] .sg-edge{stroke:${entry.stroke}}`,
    );
    expect(svg).not.toContain("stroke-dasharray:6 4");
  });

  test("the same type name on a node and an edge produces independent rules", async () => {
    const shared = {
      version: 1,
      kind: "graph",
      nodes: [
        { id: "a", label: "A", type: "calls" },
        { id: "b", label: "B" },
      ],
      edges: [{ from: "a", to: "b", type: "calls" }],
    };
    const svg = renderSvg(await layout(shared), {
      theme: { types: { calls: { fill: "#111111" } }, edgeTypes: { calls: { stroke: "#222222" } } },
    });
    expect(svg).toContain('.sg-root [data-type="calls"] .sg-node{fill:#111111}');
    expect(svg).toContain('.sg-root [data-kind="edge"][data-type="calls"] .sg-edge{stroke:#222222}');
  });

  test("palette: false gives no automatic edge rule", async () => {
    const svg = renderSvg(await layout(doc), { theme: { palette: false } });
    expect(svg).not.toContain('[data-kind="edge"][data-type=');
  });

  test("an explicit edgeTypes entry wins over the palette", async () => {
    const svg = renderSvg(await layout(doc), {
      theme: { edgeTypes: { calls: { stroke: "#123456" } } },
    });
    expect(svg).toContain('[data-kind="edge"][data-type="calls"] .sg-edge{stroke:#123456}');
    expect(svg).not.toContain(paletteEntry(PALETTES.light, "calls").stroke);
  });

  test("adaptive blocks carry the edge rules and the resets", () => {
    const style = themeStyle(
      { light: { edgeTypes: { calls: { stroke: "#111111", dash: "dashed" } } }, dark: {} },
      [],
      ["calls"],
    );
    const media = style.slice(style.indexOf("@media"));
    expect(style).toContain(
      '.sg-app .sg-root [data-kind="edge"][data-type="calls"] .sg-edge{stroke:#111111;stroke-dasharray:6 4}',
    );
    expect(media).toContain('[data-kind="edge"][data-type="calls"] .sg-edge{stroke:');
    expect(style).toContain(
      '.sg-app[data-sg-scheme=dark] .sg-root [data-kind="edge"][data-type="calls"] .sg-edge{stroke:',
    );
    const reset = themeStyle(
      { light: { palette: false, edgeTypes: { x: { text: "#111111", dash: "dashed" } } }, dark: { palette: false } },
      [],
      [],
    );
    const dark = reset.slice(reset.indexOf("@media"));
    expect(dark).toContain('[data-type="x"] .sg-edge{stroke-dasharray:none}');
    expect(dark).toContain('[data-type="x"] .sg-edge-label.sg-text{fill:var(--sg-fg)}');
  });

  test("the dark theme uses the dark palette", async () => {
    const entry = paletteEntry(PALETTES.dark, "service");
    const svg = renderSvg(await layout(doc), { theme: "dark" });
    expect(section(svg, "svc")).toContain(`fill="${entry.fill}" stroke="${entry.stroke}"`);
  });

  test("an explicit types entry wins as a whole", async () => {
    const svg = renderSvg(await layout(doc), {
      theme: { types: { service: { stroke: "#123456" } } },
    });
    expect(section(svg, "svc")).toContain(`fill="${THEMES.light.nodeFill}" stroke="#123456"`);
    const entry = paletteEntry(PALETTES.light, "database");
    expect(section(svg, "db")).toContain(`fill="${entry.fill}"`);
  });

  test("palette: false turns it off", async () => {
    const svg = renderSvg(await layout(doc), { theme: { palette: false } });
    expect(section(svg, "db")).toContain(`fill="${THEMES.light.nodeFill}"`);
    expect(svg).not.toContain("[data-type=");
    expect(resolveTheme({ palette: false }).palette).toBeUndefined();
  });

  test("unknown confidence wins over the palette fill", async () => {
    const svg = renderSvg(await layout(doc));
    const entry = paletteEntry(PALETTES.light, "database");
    expect(section(svg, "gone")).toContain(`fill="${THEMES.light.unknownFill}" stroke="${entry.stroke}"`);
    expect(svg.lastIndexOf('[data-confidence="unknown"] .sg-node')).toBeGreaterThan(
      svg.lastIndexOf('[data-type="database"] .sg-node'),
    );
  });

  test("withPalette adds only the missing types and keeps the explicit ones first", () => {
    const resolved = resolveTheme({ types: { database: { fill: "#111111" } } });
    const merged = withPalette(resolved, ["service", "database"]);
    expect(Object.keys(merged.types)).toEqual(["database", "service"]);
    expect(merged.types.database).toEqual({ fill: "#111111" });
    expect(merged.types.service).toEqual(paletteEntry(PALETTES.light, "service"));
    expect(withPalette(resolveTheme({ palette: false }), ["service"]).types).toEqual({});
  });

  test("typesPresent lists the types of the items of every kind, once", async () => {
    expect(typesPresent(await layout(doc as never))).toEqual(["database", "service"]);
    expect(
      typesPresent(
        await layout({
          version: 1,
          kind: "sequence",
          participants: [
            { id: "a", type: "client" },
            { id: "b", type: "client" },
          ],
          messages: [],
        } as never),
      ),
    ).toEqual(["client"]);
    expect(
      typesPresent(
        await layout({
          version: 1,
          kind: "tree",
          nodes: [{ id: "r", label: "R", type: "root" }],
        } as never),
      ),
    ).toEqual(["root"]);
  });

  test("the HTML page writes the palette in the light and in the dark blocks", async () => {
    const page = renderHtml(doc as never, await layout(doc));
    const light = paletteEntry(PALETTES.light, "database");
    const dark = paletteEntry(PALETTES.dark, "database");
    const media = page.indexOf("@media (prefers-color-scheme:dark)");
    expect(media).toBeGreaterThan(0);
    const lightRule = `.sg-app .sg-root [data-type="database"] .sg-node{fill:${light.fill};stroke:${light.stroke}}`;
    const darkRule = `.sg-app .sg-root [data-type="database"] .sg-node{fill:${dark.fill};stroke:${dark.stroke}}`;
    expect(page.indexOf(lightRule)).toBeGreaterThan(0);
    expect(page.indexOf(lightRule)).toBeLessThan(media);
    expect(page.indexOf(darkRule)).toBeGreaterThan(media);
  });

  test("a palette-less theme writes no type rule in the page", async () => {
    const page = renderHtml(doc as never, await layout(doc), { theme: { palette: false } });
    expect(page).not.toContain('.sg-app .sg-root [data-type=');
  });

  test("a type colored only by the palette in dark does not reset in dark", () => {
    const style = themeStyle("auto", ["database"]);
    const media = style.slice(
      style.indexOf("@media (prefers-color-scheme:dark)"),
      style.indexOf(".sg-app[data-sg-scheme=light]"),
    );
    expect(media).toContain(paletteEntry(PALETTES.dark, "database").fill);
    expect(media).not.toContain("var(--sg-node-fill)}");
  });
});

describe("the scheme blocks", () => {
  test("an adaptive theme writes the forced light and dark blocks after the media query", () => {
    const style = themeStyle("auto", ["database"]);
    const media = style.indexOf("@media (prefers-color-scheme:dark)");
    const light = style.indexOf(".sg-app[data-sg-scheme=light],.sg-app[data-sg-scheme=light] .sg-root{");
    const dark = style.indexOf(".sg-app[data-sg-scheme=dark],.sg-app[data-sg-scheme=dark] .sg-root{");
    expect(media).toBeGreaterThan(0);
    expect(light).toBeGreaterThan(media);
    expect(dark).toBeGreaterThan(light);
    const forcedDark = paletteEntry(PALETTES.dark, "database");
    expect(style).toContain(
      `.sg-app[data-sg-scheme=dark] .sg-root [data-type="database"] .sg-node{fill:${forcedDark.fill};stroke:${forcedDark.stroke}}`,
    );
  });

  test("a fixed theme writes no scheme block", () => {
    expect(themeStyle("nord", ["database"])).not.toContain("data-sg-scheme");
    expect(themeStyle({ palette: false })).not.toContain("data-sg-scheme");
  });

  test("a pair forces its own light and dark themes", () => {
    const style = themeStyle({
      light: { tokens: { accent: "#111111" } },
      dark: { base: "nord", tokens: { accent: "#222222" } },
    });
    const forced = style.slice(style.indexOf(".sg-app[data-sg-scheme=light]"));
    expect(forced).toContain("--sg-accent:#111111");
    expect(forced).toContain(`--sg-bg:${THEMES.nord.bg}`);
  });

  test("a dark-only explicit type is reset in the forced light block", () => {
    const style = themeStyle(
      { light: { palette: false }, dark: { base: "dark", palette: false, types: { cache: { fill: "#000080" } } } },
      ["cache"],
    );
    const forcedLight = style.slice(
      style.indexOf(".sg-app[data-sg-scheme=light]"),
      style.indexOf(".sg-app[data-sg-scheme=dark]"),
    );
    expect(forcedLight).toContain('[data-type="cache"] .sg-node{fill:var(--sg-node-fill)}');
  });

  test("the page shows the switch only for an adaptive theme", async () => {
    const laid = await layout(doc);
    expect(renderHtml(doc as never, laid)).toContain('class="sg-scheme"');
    expect(renderHtml(doc as never, laid, { theme: { light: {}, dark: { base: "dark" } } })).toContain(
      'class="sg-scheme"',
    );
    expect(renderHtml(doc as never, laid, { theme: "nord" })).not.toContain('class="sg-scheme"');
    expect(renderHtml(doc as never, laid, { theme: "dark" })).not.toContain('class="sg-scheme"');
    expect(renderHtml(doc as never, laid, { theme: { palette: false } })).not.toContain(
      'class="sg-scheme"',
    );
  });

  test("isAdaptive, lightTheme and withoutPalette", () => {
    expect(isAdaptive("auto")).toBe(true);
    expect(isAdaptive({ light: {}, dark: {} })).toBe(true);
    expect(isAdaptive("light")).toBe(false);
    expect(isAdaptive({})).toBe(false);
    expect(lightTheme("solarized-light")).toBe("solarized-light");
    expect(withoutPalette("nord")).toEqual({ base: "nord", palette: false });
    expect(withoutPalette("auto")).toEqual({
      light: { palette: false },
      dark: { base: "dark", palette: false },
    });
    expect(withoutPalette({ tokens: { bg: "#fff" } })).toEqual({ tokens: { bg: "#fff" }, palette: false });
  });
});

describe("names in the API", () => {
  test("exportDocument accepts a palette name and no-palette", async () => {
    const result = await exportDocument(doc, { formats: ["svg", "html"], theme: "nord" });
    expect(result.svg).toContain(`--sg-bg:${THEMES.nord.bg}`);
    expect(result.html).toContain(`--sg-bg:${THEMES.nord.bg}`);
    expect(result.html).not.toContain("prefers-color-scheme");
    const plain = await exportDocument(doc, { formats: ["svg"], theme: withoutPalette("nord") });
    expect(plain.svg).not.toContain("[data-type=");
  });

  test("the remark plugin accepts a palette name", async () => {
    const tree = {
      type: "root",
      children: [{ type: "code", lang: "standargraph", value: JSON.stringify(doc) }],
    };
    await remarkStandargraph({ theme: "solarized-dark" })(tree as never);
    const html = (tree.children[0] as unknown as { value: string }).value;
    expect(html).toContain(`--sg-bg:${THEMES["solarized-dark"].bg}`);
  });
});
