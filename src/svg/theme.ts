import type { LaidOut } from "../layout/types";
import { esc } from "./escape";

export type ThemeTokens = {
  bg: string;
  fg: string;
  muted: string;
  nodeFill: string;
  nodeStroke: string;
  unknownFill: string;
  groupFill: string;
  groupStroke: string;
  edge: string;
  labelBg: string;
  accent: string;
  lifeline: string;
  headerFill: string;
};

export type TypeStyle = { fill?: string; stroke?: string; text?: string };

export const THEME_NAMES = [
  "light",
  "dark",
  "nord",
  "solarized-light",
  "solarized-dark",
  "high-contrast",
] as const;

export type ThemeName = (typeof THEME_NAMES)[number];

export type PaletteEntry = { fill: string; stroke: string; text: string };

export type Palette = readonly PaletteEntry[];

export type Theme = {
  base?: ThemeName;
  tokens?: Partial<ThemeTokens>;
  types?: Record<string, TypeStyle>;
  palette?: false;
};

export type ThemeOption = ThemeName | Theme;

export type PageThemeOption =
  | ThemeName
  | "auto"
  | Theme
  | { light: Theme; dark: Theme };

const entry = (fill: string, stroke: string, text: string): PaletteEntry => ({ fill, stroke, text });

const LIGHT_PALETTE: Palette = [
  entry("#dbeafe", "#2563eb", "#1e3a8a"),
  entry("#dcfce7", "#16a34a", "#14532d"),
  entry("#fef3c7", "#d97706", "#78350f"),
  entry("#ffe4e6", "#e11d48", "#881337"),
  entry("#ede9fe", "#7c3aed", "#4c1d95"),
  entry("#ccfbf1", "#0d9488", "#134e4a"),
  entry("#ffedd5", "#ea580c", "#7c2d12"),
  entry("#cffafe", "#0891b2", "#164e63"),
  entry("#fce7f3", "#db2777", "#831843"),
  entry("#ecfccb", "#65a30d", "#365314"),
];

const DARK_PALETTE: Palette = [
  entry("#1e3a8a", "#60a5fa", "#dbeafe"),
  entry("#14532d", "#4ade80", "#dcfce7"),
  entry("#78350f", "#fbbf24", "#fef3c7"),
  entry("#881337", "#fb7185", "#ffe4e6"),
  entry("#4c1d95", "#a78bfa", "#ede9fe"),
  entry("#134e4a", "#2dd4bf", "#ccfbf1"),
  entry("#7c2d12", "#fb923c", "#ffedd5"),
  entry("#164e63", "#22d3ee", "#cffafe"),
  entry("#831843", "#f472b6", "#fce7f3"),
  entry("#365314", "#a3e635", "#ecfccb"),
];

const NORD_PALETTE: Palette = [
  entry("#5a424d", "#bf616a", "#eceff4"),
  entry("#5f4d4e", "#d08770", "#eceff4"),
  entry("#676157", "#ebcb8b", "#eceff4"),
  entry("#515d57", "#a3be8c", "#eceff4"),
  entry("#564f61", "#b48ead", "#eceff4"),
  entry("#4b5d65", "#8fbcbb", "#eceff4"),
  entry("#495e6b", "#88c0d0", "#eceff4"),
  entry("#475567", "#81a1c1", "#eceff4"),
  entry("#3c4b60", "#5e81ac", "#eceff4"),
];

const SOLARIZED_LIGHT_PALETTE: Palette = [
  entry("#eddeb1", "#b58900", "#073642"),
  entry("#f2d0b6", "#cb4b16", "#073642"),
  entry("#f6cbbb", "#dc322f", "#073642"),
  entry("#f4ccce", "#d33682", "#073642"),
  entry("#ddd9dc", "#6c71c4", "#073642"),
  entry("#cededf", "#268bd2", "#073642"),
  entry("#cfe3d3", "#2aa198", "#073642"),
  entry("#e3e2b1", "#859900", "#073642"),
];

const SOLARIZED_DARK_PALETTE: Palette = [
  entry("#364726", "#b58900", "#eee8d5"),
  entry("#3d352c", "#cb4b16", "#eee8d5"),
  entry("#422d34", "#dc322f", "#eee8d5"),
  entry("#3f2e4d", "#d33682", "#eee8d5"),
  entry("#204061", "#6c71c4", "#eee8d5"),
  entry("#0b4865", "#268bd2", "#eee8d5"),
  entry("#0d4e53", "#2aa198", "#eee8d5"),
  entry("#284c26", "#859900", "#eee8d5"),
];

const HIGH_CONTRAST_PALETTE: Palette = [
  entry("#002626", "#00ffff", "#ffffff"),
  entry("#262600", "#ffff00", "#ffffff"),
  entry("#260f26", "#ff66ff", "#ffffff"),
  entry("#0f260f", "#66ff66", "#ffffff"),
  entry("#261808", "#ffa033", "#ffffff"),
  entry("#0f1b26", "#66b3ff", "#ffffff"),
  entry("#260f0f", "#ff6666", "#ffffff"),
  entry("#1b2608", "#b3ff33", "#ffffff"),
];

export const THEMES: Readonly<Record<ThemeName, ThemeTokens>> = {
  light: {
    bg: "#ffffff",
    fg: "#1f2430",
    muted: "#6b7280",
    nodeFill: "#ffffff",
    nodeStroke: "#475569",
    unknownFill: "#f1f5f9",
    groupFill: "#f1f5f9",
    groupStroke: "#cbd5e1",
    edge: "#475569",
    labelBg: "#ffffff",
    accent: "#2563eb",
    lifeline: "#94a3b8",
    headerFill: "#e2e8f0",
  },
  dark: {
    bg: "#0f172a",
    fg: "#e2e8f0",
    muted: "#94a3b8",
    nodeFill: "#1e293b",
    nodeStroke: "#94a3b8",
    unknownFill: "#111827",
    groupFill: "#162033",
    groupStroke: "#334155",
    edge: "#94a3b8",
    labelBg: "#0f172a",
    accent: "#60a5fa",
    lifeline: "#475569",
    headerFill: "#273449",
  },
  nord: {
    bg: "#2e3440",
    fg: "#eceff4",
    muted: "#a3b1c7",
    nodeFill: "#3b4252",
    nodeStroke: "#81a1c1",
    unknownFill: "#343b49",
    groupFill: "#353c4a",
    groupStroke: "#4c566a",
    edge: "#81a1c1",
    labelBg: "#2e3440",
    accent: "#88c0d0",
    lifeline: "#4c566a",
    headerFill: "#434c5e",
  },
  "solarized-light": {
    bg: "#fdf6e3",
    fg: "#073642",
    muted: "#586e75",
    nodeFill: "#fdf6e3",
    nodeStroke: "#586e75",
    unknownFill: "#eee8d5",
    groupFill: "#f5eedb",
    groupStroke: "#93a1a1",
    edge: "#586e75",
    labelBg: "#fdf6e3",
    accent: "#268bd2",
    lifeline: "#93a1a1",
    headerFill: "#eee8d5",
  },
  "solarized-dark": {
    bg: "#002b36",
    fg: "#93a1a1",
    muted: "#839496",
    nodeFill: "#073642",
    nodeStroke: "#839496",
    unknownFill: "#00212b",
    groupFill: "#04323d",
    groupStroke: "#586e75",
    edge: "#839496",
    labelBg: "#002b36",
    accent: "#268bd2",
    lifeline: "#586e75",
    headerFill: "#0a3b48",
  },
  "high-contrast": {
    bg: "#000000",
    fg: "#ffffff",
    muted: "#d4d4d4",
    nodeFill: "#000000",
    nodeStroke: "#ffffff",
    unknownFill: "#1a1a1a",
    groupFill: "#0d0d0d",
    groupStroke: "#ffffff",
    edge: "#ffffff",
    labelBg: "#000000",
    accent: "#ffff00",
    lifeline: "#cccccc",
    headerFill: "#262626",
  },
};

export const THEME_BASES: Readonly<Record<ThemeName, "light" | "dark">> = {
  light: "light",
  dark: "dark",
  nord: "dark",
  "solarized-light": "light",
  "solarized-dark": "dark",
  "high-contrast": "dark",
};

export const PALETTES: Readonly<Record<ThemeName, Palette>> = {
  light: LIGHT_PALETTE,
  dark: DARK_PALETTE,
  nord: NORD_PALETTE,
  "solarized-light": SOLARIZED_LIGHT_PALETTE,
  "solarized-dark": SOLARIZED_DARK_PALETTE,
  "high-contrast": HIGH_CONTRAST_PALETTE,
};

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === "string" && (THEME_NAMES as readonly string[]).includes(value);
}

export function typeHash(type: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < type.length; index++) {
    hash = Math.imul(hash ^ type.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash;
}

export function paletteEntry(palette: Palette, type: string): PaletteEntry {
  return palette[typeHash(type) % palette.length]!;
}

export type ResolvedTheme = {
  tokens: ThemeTokens;
  types: Record<string, TypeStyle>;
  palette: Palette | undefined;
};

export type EffectiveTheme = Pick<ResolvedTheme, "tokens" | "types">;

export function resolveTheme(option: ThemeOption | undefined): ResolvedTheme {
  if (option === undefined || typeof option === "string") {
    const name = option ?? "light";
    return { tokens: THEMES[name], types: {}, palette: PALETTES[name] };
  }
  const base = option.base ?? "light";
  return {
    tokens: { ...THEMES[base], ...option.tokens },
    types: option.types ?? {},
    palette: option.palette === false ? undefined : PALETTES[base],
  };
}

export function withPalette(resolved: ResolvedTheme, typeNames: readonly string[]): ResolvedTheme {
  const { palette } = resolved;
  if (palette === undefined) return resolved;
  const added = typeNames
    .filter((type) => !Object.hasOwn(resolved.types, type))
    .map((type) => [type, paletteEntry(palette, type)] as const);
  if (added.length === 0) return resolved;
  return { ...resolved, types: Object.fromEntries([...Object.entries(resolved.types), ...added]) };
}

export function typesPresent(laidOut: LaidOut): string[] {
  const items: readonly { type?: string }[] =
    laidOut.kind === "sequence"
      ? laidOut.participants
      : laidOut.kind === "state"
        ? laidOut.states
        : laidOut.kind === "er"
          ? laidOut.entities
          : laidOut.nodes;
  return [...new Set(items.flatMap((item) => (item.type === undefined ? [] : [item.type])))];
}

function escapeValues<T extends object>(record: T): T {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      typeof value === "string" ? esc(value) : value,
    ]),
  ) as T;
}

export function escapedTheme({ tokens, types }: EffectiveTheme): EffectiveTheme {
  return {
    tokens: escapeValues(tokens),
    types: Object.fromEntries(
      Object.entries(types).map(([type, style]) => [type, escapeValues(style)]),
    ),
  };
}

function variables(tokens: ThemeTokens): string {
  return [
    ["bg", tokens.bg],
    ["fg", tokens.fg],
    ["muted", tokens.muted],
    ["node-fill", tokens.nodeFill],
    ["node-stroke", tokens.nodeStroke],
    ["unknown-fill", tokens.unknownFill],
    ["group-fill", tokens.groupFill],
    ["group-stroke", tokens.groupStroke],
    ["edge", tokens.edge],
    ["label-bg", tokens.labelBg],
    ["accent", tokens.accent],
    ["lifeline", tokens.lifeline],
    ["header-fill", tokens.headerFill],
  ]
    .map(([name, value]) => `--sg-${name}:${esc(value!)}`)
    .join(";");
}

export function themeVariables(option: ThemeOption): string {
  return variables(resolveTheme(option).tokens);
}

export function typeRules(types: Record<string, TypeStyle>, scope: string): string {
  const entries = Object.entries(types);
  if (entries.length === 0) return "";
  const rules = entries.flatMap(([type, style]) => {
    const selector = `${scope} [data-type="${esc(type.replace(/\\/g, "\\\\").replace(/"/g, '\\"'))}"]`;
    const node = [
      style.fill === undefined ? "" : `fill:${esc(style.fill)}`,
      style.stroke === undefined ? "" : `stroke:${esc(style.stroke)}`,
    ].filter((declaration) => declaration !== "");
    return [
      node.length === 0 ? "" : `${selector} .sg-node{${node.join(";")}}`,
      style.text === undefined ? "" : `${selector} .sg-label{fill:${esc(style.text)}}`,
    ];
  });
  rules.push(`${scope} [data-confidence="unknown"] .sg-node{fill:var(--sg-unknown-fill)}`);
  return rules.join("");
}

function isPair(option: PageThemeOption): option is { light: Theme; dark: Theme } {
  return typeof option === "object" && "light" in option && "dark" in option;
}

export function isAdaptive(option: PageThemeOption | undefined): boolean {
  return option === undefined || option === "auto" || isPair(option);
}

export function withoutPalette(option: PageThemeOption): PageThemeOption {
  if (isPair(option)) {
    return { light: withoutPalette(option.light) as Theme, dark: withoutPalette(option.dark) as Theme };
  }
  if (option === "auto") return { light: { palette: false }, dark: { base: "dark", palette: false } };
  if (typeof option === "string") return { base: option, palette: false };
  return { ...option, palette: false };
}

export function lightTheme(option: PageThemeOption | undefined): ThemeOption {
  if (option === undefined || option === "auto") return "light";
  return isPair(option) ? option.light : option;
}

const DEFAULT_TYPE_STYLE: Required<TypeStyle> = {
  fill: "var(--sg-node-fill)",
  stroke: "var(--sg-node-stroke)",
  text: "var(--sg-fg)",
};

function withResets(
  own: Record<string, TypeStyle>,
  other: Record<string, TypeStyle>,
): Record<string, TypeStyle> {
  const types: Record<string, TypeStyle> = { ...own };
  for (const [type, style] of Object.entries(other)) {
    const current = types[type] ?? {};
    const reset: TypeStyle = { ...current };
    for (const key of ["fill", "stroke", "text"] as const) {
      if (style[key] !== undefined && current[key] === undefined) reset[key] = DEFAULT_TYPE_STYLE[key];
    }
    types[type] = reset;
  }
  return types;
}

export function themeStyle(option: PageThemeOption, typeNames: readonly string[] = []): string {
  const block = (theme: ThemeOption, types: Record<string, TypeStyle>, app: string): string =>
    `${app},${app} .sg-root{${themeVariables(theme)}}${typeRules(types, `${app} .sg-root`)}`;
  const adaptive = (light: ThemeOption, dark: ThemeOption): string => {
    const lightTypes = withPalette(resolveTheme(light), typeNames).types;
    const darkTypes = withPalette(resolveTheme(dark), typeNames).types;
    const darkWithResets = withResets(darkTypes, lightTypes);
    const lightWithResets = withResets(lightTypes, darkTypes);
    return [
      block(light, lightTypes, ".sg-app"),
      `@media (prefers-color-scheme:dark){${block(dark, darkWithResets, ".sg-app")}}`,
      block(light, lightWithResets, ".sg-app[data-sg-scheme=light]"),
      block(dark, darkWithResets, ".sg-app[data-sg-scheme=dark]"),
    ].join("");
  };
  if (option === "auto") return adaptive("light", "dark");
  if (isPair(option)) return adaptive(option.light, option.dark);
  return block(option, withPalette(resolveTheme(option), typeNames).types, ".sg-app");
}
