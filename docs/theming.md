# Theming

A theme is a set of color tokens, plus optional colors per item `type`. The same object drives the SVG, the HTML page, `mount()`, the PNG and the PDF.

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
type Theme = {
  base?: "light" | "dark";                // default "light"
  tokens?: Partial<ThemeTokens>;
  types?: Record<string, TypeStyle>;      // keyed by item `type`
};
type ThemeOption = "light" | "dark" | Theme;                                      // renderSvg, PNG, PDF
type PageThemeOption = "light" | "dark" | "auto" | Theme | { light: Theme; dark: Theme };  // renderHtml, mount, exportDocument, CLI
```

- `THEMES` holds the built-in `light` and `dark` tokens.
- `resolveTheme(option)` returns `{ tokens, types }` with `tokens = { ...THEMES[base], ...theme.tokens }`.
- `themeVariables(option)` returns the `--sg-*` custom properties of a theme as a CSS declaration list.

A color value is not validated, but it is escaped. WebGL only reads hexadecimal and `rgb()` colors.

## Where a theme applies

- Presentation attributes are always written from the resolved tokens, so a PNG or a PDF (rendered without the stylesheet) follows a custom theme.
- HTML pages and `mount()` write the variables of the light theme, then those of the dark theme under `@media (prefers-color-scheme:dark)`.
  - `"auto"` uses the two built-in themes.
  - `{ light, dark }` uses the two given themes. A type colored only in the light theme falls back to the default node colors in dark mode.
  - `"light"`, `"dark"` or a single `Theme` gives a fixed theme.
- For SVG, PNG and PDF, `"auto"` and `{ light, dark }` give the light theme.
- CLI: `--theme light|dark|auto|<file.json>`. A value that ends with `.json` is read as a `Theme` or a `{ light, dark }` pair. An unreadable or invalid file exits with 2.

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

For each `type` T in `theme.types`, the stylesheet gets, after the base rules:

```css
.sg-root [data-type="T"] .sg-node { fill: F; stroke: S; }
.sg-root [data-type="T"] .sg-label { fill: X; }
```

Only the keys you give are written. T is escaped for a quoted selector (`\` becomes `\\`, `"` becomes `\"`).

A last rule, `.sg-root [data-confidence="unknown"] .sg-node { fill: var(--sg-unknown-fill) }`, has the same specificity and comes after the type rules: the `unknown` confidence wins over the type color. The inline presentation attributes follow the same order.

In WebGL the fill of the type replaces `--sg-node-stroke` as the base of the node color mix. Nodes of a type with no fill keep the stroke-based color.

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
