import { type Document, validate } from "../format";
import { renderHtml } from "../html/render";
import { layout } from "../layout";
import { round } from "../layout/shared";
import { toMermaid } from "../mermaid";
import { formatErrors, formatLoadErrors } from "../shared/errors";
import { renderSvg } from "../svg/render";
import { lightTheme, type PageThemeOption } from "../svg/theme";
import { loadSource } from "../text";
import { renderPdf } from "./pdf";
import { renderPng } from "./png";

export { VERSION } from "../version";
export {
  type PageThemeOption,
  type Palette,
  PALETTES,
  type PaletteEntry,
  paletteEntry,
  resolveTheme,
  THEME_NAMES,
  THEMES,
  type Theme,
  type ThemeName,
  type ThemeOption,
  type ThemeTokens,
  themeVariables,
  type EdgeDash,
  type EdgeTypeStyle,
  type TypeStyle,
} from "../svg/theme";
export { type PdfOptions, renderPdf } from "./pdf";
export { type PngOptions, renderPng } from "./png";

export const EXPORT_FORMATS = ["svg", "html", "png", "pdf", "mermaid"] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export type ExportOptions = {
  formats?: readonly ExportFormat[];
  theme?: PageThemeOption;
  scale?: number;
  title?: string;
  renderer?: "auto" | "svg" | "webgl";
};

export type ExportResult = {
  [K in ExportFormat]?: K extends "svg" | "html" | "mermaid" ? string : Uint8Array;
};

export async function exportDocument(
  input: unknown,
  options: ExportOptions = {},
): Promise<ExportResult> {
  let document: Document;
  if (typeof input === "string") {
    const loaded = loadSource(input);
    if (!loaded.ok) {
      throw new Error(`Invalid document:\n${formatLoadErrors(loaded.errors)}`);
    }
    document = loaded.document;
  } else {
    const result = validate(input);
    if (!result.ok) {
      throw new Error(`Invalid document:\n${formatErrors(result.errors)}`);
    }
    document = result.document;
  }
  const theme = options.theme ?? "auto";
  const flatTheme = lightTheme(theme);
  const formats = options.formats ?? ["svg", "html"];
  const rendered = formats.filter(
    (format): format is Exclude<ExportFormat, "mermaid"> => format !== "mermaid",
  );
  const output: ExportResult = {};
  if (rendered.length > 0) {
    const laidOut = await layout(document);
    for (const format of rendered) {
      if (format === "svg") {
        output.svg = renderSvg(laidOut, { theme: flatTheme });
      } else if (format === "html") {
        output.html = renderHtml(document, laidOut, {
          theme,
          title: options.title,
          renderer: options.renderer,
        });
      } else {
        const svg = renderSvg(laidOut, { theme: flatTheme, styles: false });
        output[format] =
          format === "png"
            ? await renderPng(svg, { scale: options.scale })
            : await renderPdf(svg, {
                width: round(laidOut.width),
                height: round(laidOut.height),
              });
      }
    }
  }
  if (rendered.length < formats.length) {
    output.mermaid = toMermaid(document, theme === "auto" ? {} : { theme: flatTheme }).text;
  }
  return output;
}
