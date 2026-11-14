import type { Document } from "../src/format";
import { mount, type Mounted } from "../src/html/mount";
import { layout } from "../src/layout";
import { toMermaid } from "../src/mermaid";
import { formatLoadErrors } from "../src/shared/errors";
import { renderSvg } from "../src/svg";
import { lightTheme } from "../src/svg/theme";
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
const buttons = {
  svg: element<HTMLButtonElement>("download-svg"),
  json: element<HTMLButtonElement>("download-json"),
  sg: element<HTMLButtonElement>("download-sg"),
  mmd: element<HTMLButtonElement>("download-mmd"),
};

let current: Document | undefined;
let mounted: Mounted | undefined;
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

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

async function refresh(): Promise<void> {
  const mine = ++generation;
  const loaded = loadSource(source.value);
  if (!loaded.ok) {
    showErrors(formatLoadErrors(loaded.errors).split("\n"));
    status.textContent = "Invalid";
    return;
  }
  status.textContent = "Rendering";
  try {
    mounted?.destroy();
    mounted = undefined;
    const next = await mount(preview, loaded.document);
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
  current = loaded.document;
  showErrors([]);
  status.textContent = "Rendered";
  setDownloads(true);
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
  const svg = renderSvg(await layout(current), { theme: lightTheme("light") });
  download(`${baseName()}.svg`, svg, "image/svg+xml");
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
