import type { Document } from "../src/format";
import { mount, type Mounted } from "../src/html/mount";
import { currentScheme, type Scheme, setScheme } from "../src/html/ui";
import { layout } from "../src/layout";
import { toMermaid } from "../src/mermaid";
import { formatLoadErrors } from "../src/shared/errors";
import { renderSvg } from "../src/svg";
import {
  lightTheme,
  type PageThemeOption,
  resolveTheme,
  type Theme,
  THEME_NAMES,
  type ThemeName,
  type ThemeTokens,
  THEMES,
  type TypeStyle,
  withPalette,
} from "../src/svg/theme";
import { loadSource, print } from "../src/text";

type Example = { name: string; title: string; source: string };

declare global {
  interface Window {
    SG_EXAMPLES: Example[];
  }
}

const DEBOUNCE_MS = 300;

function element<T extends HTMLElement>(id: string): T {
  const found = globalThis.document.getElementById(id);
  if (found === null) throw new Error(`Missing element #${id}`);
  return found as T;
}

const examples = window.SG_EXAMPLES;
const select = element<HTMLSelectElement>("example");
const source = element<HTMLTextAreaElement>("source");
const errors = element<HTMLUListElement>("errors");
const preview = element<HTMLDivElement>("preview");
const status = element<HTMLSpanElement>("status");
const pages = element<HTMLElement>("pages");
const paletteSelect = element<HTMLSelectElement>("palette");
const schemeSelect = element<HTMLSelectElement>("scheme");
const paletteOff = element<HTMLInputElement>("palette-off");
const tokensBox = element<HTMLDivElement>("tokens");
const typesBox = element<HTMLDivElement>("types");
const buttons = {
  svg: element<HTMLButtonElement>("download-svg"),
  json: element<HTMLButtonElement>("download-json"),
  sg: element<HTMLButtonElement>("download-sg"),
  mmd: element<HTMLButtonElement>("download-mmd"),
  theme: element<HTMLButtonElement>("download-theme"),
};

let current: Document | undefined;
let mounted: Mounted | undefined;
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let themeTimer: ReturnType<typeof setTimeout> | undefined;

type Overrides = { tokens: Partial<ThemeTokens>; types: Record<string, TypeStyle> };

const overrides = new Map<ThemeName, Overrides>();
const TOKEN_KEYS = Object.keys(THEMES.light) as (keyof ThemeTokens)[];
const STYLE_KEYS = ["fill", "stroke", "text"] as const;
let typeKey = "";

function slotTheme(slot: ThemeName): Theme {
  const own = overrides.get(slot);
  const theme: Theme = { base: slot };
  if (own !== undefined && Object.keys(own.tokens).length > 0) theme.tokens = own.tokens;
  if (own !== undefined && Object.keys(own.types).length > 0) theme.types = own.types;
  if (paletteOff.checked) theme.palette = false;
  return theme;
}

function selectedPalette(): "auto" | ThemeName {
  return paletteSelect.value === "auto" ? "auto" : (paletteSelect.value as ThemeName);
}

function buildTheme(): Exclude<PageThemeOption, "auto" | ThemeName> {
  const palette = selectedPalette();
  return palette === "auto"
    ? { light: slotTheme("light"), dark: slotTheme("dark") }
    : slotTheme(palette);
}

function activeApp(): HTMLElement | null {
  return preview.querySelector<HTMLElement>(".sg-app");
}

function activeScheme(): Scheme {
  const app = activeApp();
  return app === null ? "auto" : currentScheme(app);
}

function activeSlot(): ThemeName {
  const palette = selectedPalette();
  if (palette !== "auto") return palette;
  const scheme = activeScheme();
  if (scheme !== "auto") return scheme;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function documentTypes(document: Document | undefined): string[] {
  if (document === undefined) return [];
  const items: readonly { type?: string }[] =
    document.kind === "sequence"
      ? document.participants
      : document.kind === "state"
        ? document.states
        : document.kind === "er"
          ? document.entities
          : document.nodes;
  return [...new Set(items.flatMap((item) => (item.type === undefined ? [] : [item.type])))];
}

function effectiveTypeStyle(type: string): Required<TypeStyle> {
  const resolved = withPalette(resolveTheme(slotTheme(activeSlot())), [type]);
  const style = resolved.types[type] ?? {};
  return {
    fill: style.fill ?? resolved.tokens.nodeFill,
    stroke: style.stroke ?? resolved.tokens.nodeStroke,
    text: style.text ?? resolved.tokens.fg,
  };
}

function colorInput(value: string, label: string): HTMLInputElement {
  const input = globalThis.document.createElement("input");
  input.type = "color";
  input.value = value;
  input.setAttribute("aria-label", label);
  return input;
}

function scheduleTheme(): void {
  clearTimeout(themeTimer);
  themeTimer = setTimeout(() => void refresh(true), 60);
}

function rebuildInputs(): void {
  const slot = activeSlot();
  const tokens = resolveTheme(slotTheme(slot)).tokens;
  tokensBox.replaceChildren(
    ...TOKEN_KEYS.map((key) => {
      const label = globalThis.document.createElement("label");
      const input = colorInput(tokens[key], key);
      input.dataset.token = key;
      input.addEventListener("input", () => {
        const own = overrides.get(slot) ?? { tokens: {}, types: {} };
        own.tokens[key] = input.value;
        overrides.set(slot, own);
        scheduleTheme();
      });
      label.append(key, input);
      return label;
    }),
  );
  const names = documentTypes(current);
  typeKey = names.join("\n");
  typesBox.replaceChildren(
    ...names.map((type) => {
      const row = globalThis.document.createElement("div");
      row.className = "type-row";
      const name = globalThis.document.createElement("b");
      name.textContent = type;
      row.append(name);
      const style = effectiveTypeStyle(type);
      for (const key of STYLE_KEYS) {
        const label = globalThis.document.createElement("label");
        const input = colorInput(style[key], `${type} ${key}`);
        input.dataset.type = type;
        input.dataset.key = key;
        input.addEventListener("input", () => {
          const own = overrides.get(slot) ?? { tokens: {}, types: {} };
          own.types[type] = { ...effectiveTypeStyle(type), ...own.types[type], [key]: input.value };
          overrides.set(slot, own);
          scheduleTheme();
        });
        label.append(key, input);
        row.append(label);
      }
      return row;
    }),
  );
}

function syncScheme(): void {
  const fixed = selectedPalette() !== "auto";
  schemeSelect.disabled = fixed || activeApp()?.querySelector(".sg-scheme") === null;
  schemeSelect.value = fixed ? "auto" : activeScheme();
}

for (const name of ["auto", ...THEME_NAMES]) {
  const option = globalThis.document.createElement("option");
  option.value = name;
  option.textContent = name;
  paletteSelect.append(option);
}

for (const example of examples) {
  const option = globalThis.document.createElement("option");
  option.value = example.name;
  option.textContent = example.title;
  select.append(option);
  const link = globalThis.document.createElement("a");
  link.href = `examples/${example.name}.html`;
  link.textContent = example.title;
  pages.append(link);
}

function showErrors(lines: string[]): void {
  errors.replaceChildren(
    ...lines.map((line) => {
      const item = globalThis.document.createElement("li");
      item.textContent = line;
      return item;
    }),
  );
}

function setDownloads(enabled: boolean): void {
  for (const button of Object.values(buttons)) button.disabled = !enabled;
}

async function refresh(reuse = false): Promise<void> {
  const mine = ++generation;
  let document: Document;
  if (reuse && current !== undefined) {
    document = current;
  } else {
    const loaded = loadSource(source.value);
    if (!loaded.ok) {
      showErrors(formatLoadErrors(loaded.errors).split("\n"));
      status.textContent = "Invalid";
      return;
    }
    document = loaded.document;
  }
  status.textContent = "Rendering";
  try {
    mounted?.destroy();
    mounted = undefined;
    const next = await mount(preview, document, { theme: buildTheme() });
    if (mine !== generation) {
      next.destroy();
      return;
    }
    mounted = next;
  } catch (error) {
    if (mine !== generation) return;
    showErrors([error instanceof Error ? error.message : String(error)]);
    status.textContent = "Failed";
    return;
  }
  current = document;
  showErrors([]);
  status.textContent = "Rendered";
  setDownloads(true);
  syncScheme();
  if (documentTypes(document).join("\n") !== typeKey) rebuildInputs();
}

function schedule(): void {
  clearTimeout(timer);
  timer = setTimeout(() => void refresh(), DEBOUNCE_MS);
}

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = globalThis.document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function baseName(): string {
  return select.value === "" ? "diagram" : select.value;
}

buttons.json.addEventListener("click", () => {
  if (current) download(`${baseName()}.json`, `${JSON.stringify(current, null, 2)}\n`, "application/json");
});
buttons.sg.addEventListener("click", () => {
  if (current) download(`${baseName()}.sg`, print(current), "text/plain");
});
buttons.mmd.addEventListener("click", () => {
  if (current) download(`${baseName()}.mmd`, toMermaid(current).text, "text/plain");
});
buttons.svg.addEventListener("click", async () => {
  if (!current) return;
  const svg = renderSvg(await layout(current), { theme: lightTheme(buildTheme()) });
  download(`${baseName()}.svg`, svg, "image/svg+xml");
});

buttons.theme.addEventListener("click", () => {
  download("theme.json", `${JSON.stringify(buildTheme(), null, 2)}\n`, "application/json");
});
paletteSelect.addEventListener("change", () => {
  syncScheme();
  rebuildInputs();
  void refresh(true);
});
paletteOff.addEventListener("change", () => {
  rebuildInputs();
  void refresh(true);
});
schemeSelect.addEventListener("change", () => {
  const app = activeApp();
  if (app !== null) setScheme(app, schemeSelect.value as Scheme);
});
preview.addEventListener("sg-scheme", () => {
  syncScheme();
  rebuildInputs();
});
element<HTMLButtonElement>("theme-reset").addEventListener("click", () => {
  overrides.clear();
  paletteSelect.value = "auto";
  paletteOff.checked = false;
  syncScheme();
  rebuildInputs();
  void refresh(true);
});

select.addEventListener("change", () => {
  const example = examples.find((item) => item.name === select.value);
  if (!example) return;
  source.value = example.source;
  clearTimeout(timer);
  void refresh();
});
source.addEventListener("input", schedule);

const first = examples.find((item) => item.name === "architecture") ?? examples[0];
if (first) {
  select.value = first.name;
  source.value = first.source;
}
void refresh();
