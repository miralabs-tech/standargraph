import { type Document, validate } from "../format";
import { renderHtml } from "../html/render";
import { layout } from "../layout";
import { round } from "../layout/shared";
import { formatErrors } from "../shared/errors";
import { renderSvg } from "../svg/render";
import { lightTheme, type PageThemeOption } from "../svg/theme";
import { renderPdf } from "./pdf";
import { renderPng } from "./png";

export { VERSION } from "../version";
export {
  type PageThemeOption,
  resolveTheme,
  THEMES,
  type Theme,
  type ThemeOption,
  type ThemeTokens,
  themeVariables,
  type TypeStyle,
} from "../svg/theme";
export { type PdfOptions, renderPdf } from "./pdf";
export { type PngOptions, renderPng } from "./png";

export const EXPORT_FORMATS = ["svg", "html", "png", "pdf"] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export type ExportOptions = {
  formats?: readonly ExportFormat[];
  theme?: PageThemeOption;
  scale?: number;
  title?: string;
  renderer?: "auto" | "svg" | "webgl";
};

export type ExportResult = { [K in ExportFormat]?: K extends "svg" | "html" ? string : Uint8Array };

export async function exportDocument(
  input: unknown,
  options: ExportOptions = {},
): Promise<ExportResult> {
  const result = validate(input);
  if (!result.ok) {
    throw new Error(`Invalid document:\n${formatErrors(result.errors)}`);
  }
  const document: Document = result.document;
  const laidOut = await layout(document);
  const theme = options.theme ?? "auto";
  const flatTheme = lightTheme(theme);
  const formats = options.formats ?? ["svg", "html"];
  const output: ExportResult = {};
  for (const format of formats) {
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
  return output;
}
