# Theming

A theme is a set of color tokens, plus optional colors per item `type`. The same object drives the SVG, the HTML page, `mount()`, the PNG and the PDF. Six named palettes come with the library, and a typed item gets a color from the palette of the theme without any declaration.

## Palettes

Pass a name wherever a theme is accepted: `theme: "nord"` in the API and in the `remark` plugin, `--theme nord` on the CLI, `base: "nord"` in a `Theme` object or a theme file.

| Name | Base | Look | Palette entries |
| --- | --- | --- | --- |
| `light` | light | white page, slate text (the default) | 10 |
| `dark` | dark | slate-blue page | 10 |
| `nord` | dark | the Nord blue-gray page with the aurora colors | 9 |
| `solarized-light` | light | Solarized base3 page | 8 |
| `solarized-dark` | dark | Solarized base03 page | 8 |
| `high-contrast` | dark | black page, white text and edges, bright strokes | 8 |

- `"auto"` keeps its meaning: `light` and `dark` chosen by the system (`prefers-color-scheme`), with a switch in the toolbar.
- A named theme is fixed: it does not follow the system and shows no switch. A `{ light, dark }` pair adapts, so `{ light: { base: "solarized-light" }, dark: { base: "solarized-dark" } }` gives Solarized by system.
- Each palette meets a contrast of at least 4.5:1 for the text on the page, on the node, group and header fills, and for the label text on every automatic palette entry. A test checks it.

## Automatic palette

A node, participant, state, entity or tree node that has a `type` and no entry for it in `theme.types` gets a color from the palette of its theme:

```
entry = palette[fnv1a(type) % palette.length]     // { fill, stroke, text }
```

- The hash is FNV-1a (32 bits) over the UTF-16 code units of the type, so a type keeps its color from one render to the next and from one document to another.
- The color is written in the presentation attributes (SVG, PNG, PDF) and in the CSS rules (HTML page, `mount()`, WebGL), in the light and in the dark block of an adaptive theme.
- An entry of `theme.types` wins as a whole: its missing keys fall back to the plain node colors, not to the palette.
- `meta.provenance.confidence` of `unknown` still wins over any type color.
- Only the types present in the document produce a rule, and a document without type is unchanged.
- Turn it off with `palette: false` in the `Theme` object, or `--no-palette` on the CLI. `--no-palette` applies to a named theme, to `auto`, to a theme file and to each theme of a pair.

```ts
renderSvg(scene, { theme: { base: "nord", palette: false } });
```

`PALETTES[name]` holds the entries and `paletteEntry(palette, type)` returns the one of a type.

## Light, dark and auto switch

The interactive HTML page and `mount()` show a button in the toolbar when the theme adapts (`"auto"` or a `{ light, dark }` pair). It cycles `auto`, `light` and `dark`, and its `aria-label` and `title` read `Color scheme: <mode>`.

- The mode is the `data-sg-scheme="light|dark"` attribute of `.sg-app`; `auto` has no attribute and follows the system. The stylesheet writes a block for each forced scheme after the media query, so a forced scheme wins over it.
- The choice is kept in `localStorage` under `standargraph-scheme` and applied when the page or `mount()` starts. Each instance changes on its own; the others pick the stored value up the next time they start. Without `localStorage`, the page follows the system.
- A fixed theme (a name, a single `Theme`) shows no button.
- The WebGL renderer reads its colors again when the mode changes.

## API

```ts
import {
  resolveTheme,
  THEMES,
  themeVariables,
  type PageThemeOption,
  type Theme,
  type ThemeOption,
  type ThemeTokens,
  type TypeStyle,
} from "@miralabs-tech/standargraph/svg";
```

`/html` and `/export` export the same names.

```ts
type ThemeTokens = {
  bg: string; fg: string; muted: string;
  nodeFill: string; nodeStroke: string; unknownFill: string;
  groupFill: string; groupStroke: string;
  edge: string; labelBg: string; accent: string; lifeline: string;
  headerFill: string;
};
type TypeStyle = { fill?: string; stroke?: string; text?: string };
type ThemeName = "light" | "dark" | "nord" | "solarized-light" | "solarized-dark" | "high-contrast";
type Theme = {
  base?: ThemeName;                       // default "light"
  tokens?: Partial<ThemeTokens>;
  types?: Record<string, TypeStyle>;      // keyed by item `type`
  palette?: false;                        // turns the automatic palette off
};
type ThemeOption = ThemeName | Theme;                                             // renderSvg, PNG, PDF
type PageThemeOption = ThemeName | "auto" | Theme | { light: Theme; dark: Theme };  // renderHtml, mount, exportDocument, remark, CLI
```

- `THEMES` holds the tokens of each name, `THEME_NAMES` lists the names and `PALETTES` holds their automatic palettes.
- `resolveTheme(option)` returns `{ tokens, types, palette }` with `tokens = { ...THEMES[base], ...theme.tokens }` and `palette = PALETTES[base]`, or `undefined` when `palette` is `false`.
- `themeVariables(option)` returns the `--sg-*` custom properties of a theme as a CSS declaration list.

A color value is not validated, but it is escaped. WebGL only reads hexadecimal and `rgb()` colors.

## Where a theme applies

- Presentation attributes are always written from the resolved tokens, so a PNG or a PDF (rendered without the stylesheet) follows a custom theme.
- HTML pages and `mount()` write the variables of the light theme, then those of the dark theme under `@media (prefers-color-scheme:dark)`, then one block for each forced scheme (`.sg-app[data-sg-scheme=light]` and `[data-sg-scheme=dark]`).
  - `"auto"` uses the two built-in themes.
  - `{ light, dark }` uses the two given themes. A type colored only in the light theme falls back to the default node colors in dark mode.
  - A name or a single `Theme` gives a fixed theme.
- For SVG, PNG and PDF, `"auto"` and `{ light, dark }` give the light theme.
- CLI: `--theme auto|light|dark|nord|solarized-light|solarized-dark|high-contrast|<file.json>`, and `--no-palette`. A value that ends with `.json` is read as a `Theme` or a `{ light, dark }` pair; `base` takes any name and `palette` only `false`. An unreadable or invalid file exits with 2.

## Tokens, variables and classes

| Token | Variable | Classes that use it |
| --- | --- | --- |
| `bg` | `--sg-bg` | `.sg-bg`, cardinality circles |
| `fg` | `--sg-fg` | `.sg-text`, `.sg-pseudo` |
| `muted` | `--sg-muted` | `.sg-muted` (captions, ER keys and types) |
| `nodeFill` | `--sg-node-fill` | `.sg-node` |
| `nodeStroke` | `--sg-node-stroke` | `.sg-node`, `.sg-node-detail`, `.sg-divider` |
| `unknownFill` | `--sg-unknown-fill` | `.sg-node.sg-unknown` |
| `groupFill` | `--sg-group-fill` | `.sg-group` (groups, composites) |
| `groupStroke` | `--sg-group-stroke` | `.sg-group` |
| `edge` | `--sg-edge` | `.sg-edge`, arrowheads |
| `labelBg` | `--sg-label-bg` | `.sg-label-bg` |
| `accent` | `--sg-accent` | `.sg-accent`, selection |
| `lifeline` | `--sg-lifeline` | `.sg-lifeline` |
| `headerFill` | `--sg-header-fill` | `.sg-header` (light `#e2e8f0`, dark `#273449`) |

## Colors per type

For each `type` T in `theme.types`, then for each other type of the document when the automatic palette is on, the stylesheet gets, after the base rules:

```css
.sg-root [data-type="T"] .sg-node { fill: F; stroke: S; }
.sg-root [data-type="T"] .sg-label { fill: X; }
```

Only the keys you give are written. T is escaped for a quoted selector (`\` becomes `\\`, `"` becomes `\"`).

A last rule, `.sg-root [data-confidence="unknown"] .sg-node { fill: var(--sg-unknown-fill) }`, has the same specificity and comes after the type rules: the `unknown` confidence wins over the type color. The inline presentation attributes follow the same order.

In WebGL the fill of the type, explicit or from the palette, replaces `--sg-node-stroke` as the base of the node color mix. Nodes of a type with no fill keep the stroke-based color.

## Data attributes

Every rendered item carries `data-kind` and `data-id`, then, in this order:

| Where | Attributes |
| --- | --- |
| `<svg class="sg-root">` | `data-diagram` |
| any item `<g>` | `data-type` if the item has a `type`, `data-confidence` if `meta.provenance.confidence` is set |
| graph node | `data-shape`, `box` by default |
| group | `data-depth` |
| edge, message | `data-from`, `data-to` |
| graph edge | `data-directed="false"` only when undirected |
| message | `data-style` |

All values are escaped, and the order is fixed, so the SVG stays deterministic.

## Custom CSS

Put this in the page that includes the inline SVG, `mount()` or the exported HTML:

```css
.sg-root { --sg-accent: #e11d48; --sg-header-fill: #fde68a; }
.sg-root [data-type="database"] .sg-node { fill: #fef3c7; stroke: #b45309; }
.sg-root [data-shape="diamond"] .sg-node { stroke-width: 2; }
.sg-root [data-kind="edge"][data-confidence="inferred"] .sg-edge { stroke-dasharray: 2 2; }
```

PNG and PDF never see this CSS: use the `Theme` object for them.
