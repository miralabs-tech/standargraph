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

export type Theme = {
  base?: "light" | "dark";
  tokens?: Partial<ThemeTokens>;
  types?: Record<string, TypeStyle>;
};

export type ThemeOption = "light" | "dark" | Theme;

export type PageThemeOption =
  | "light"
  | "dark"
  | "auto"
  | Theme
  | { light: Theme; dark: Theme };

export const THEMES: Readonly<Record<"light" | "dark", ThemeTokens>> = {
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
};

export type ResolvedTheme = { tokens: ThemeTokens; types: Record<string, TypeStyle> };

export function resolveTheme(option: ThemeOption | undefined): ResolvedTheme {
  if (option === undefined || typeof option === "string") {
    return { tokens: THEMES[option ?? "light"], types: {} };
  }
  return {
    tokens: { ...THEMES[option.base ?? "light"], ...option.tokens },
    types: option.types ?? {},
  };
}

function escapeValues<T extends object>(record: T): T {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      typeof value === "string" ? esc(value) : value,
    ]),
  ) as T;
}

export function escapedTheme({ tokens, types }: ResolvedTheme): ResolvedTheme {
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

export function lightTheme(option: PageThemeOption | undefined): ThemeOption {
  if (option === undefined || option === "auto") return "light";
  return isPair(option) ? option.light : option;
}

const DEFAULT_TYPE_STYLE: Required<TypeStyle> = {
  fill: "var(--sg-node-fill)",
  stroke: "var(--sg-node-stroke)",
  text: "var(--sg-fg)",
};

function darkTypes(light: ThemeOption, dark: ThemeOption): Record<string, TypeStyle> {
  const types: Record<string, TypeStyle> = { ...resolveTheme(dark).types };
  for (const [type, style] of Object.entries(resolveTheme(light).types)) {
    const own = types[type] ?? {};
    const reset: TypeStyle = { ...own };
    for (const key of ["fill", "stroke", "text"] as const) {
      if (style[key] !== undefined && own[key] === undefined) reset[key] = DEFAULT_TYPE_STYLE[key];
    }
    types[type] = reset;
  }
  return types;
}

export function themeStyle(option: PageThemeOption): string {
  const selector = ".sg-app,.sg-app .sg-root";
  const scope = ".sg-app .sg-root";
  const block = (theme: ThemeOption, types = resolveTheme(theme).types): string =>
    `${selector}{${themeVariables(theme)}}${typeRules(types, scope)}`;
  const adaptive = (light: ThemeOption, dark: ThemeOption): string =>
    `${block(light)}@media (prefers-color-scheme:dark){${block(dark, darkTypes(light, dark))}}`;
  if (option === "auto") return adaptive("light", "dark");
  if (isPair(option)) return adaptive(option.light, option.dark);
  return block(option);
}
