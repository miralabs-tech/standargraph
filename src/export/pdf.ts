import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";
import { loadFonts } from "../shared/package-root";

export type PdfOptions = { width: number; height: number };

const FIXED_DATE = new Date("2000-01-01T00:00:00.000Z");

export function renderPdf(svg: string, options: PdfOptions): Promise<Uint8Array> {
  const fonts = loadFonts();
  const doc = new PDFDocument({
    size: [options.width, options.height],
    margin: 0,
    compress: true,
    info: {
      Producer: "standargraph",
      Creator: "standargraph",
      CreationDate: FIXED_DATE,
      ModDate: FIXED_DATE,
    },
  });
  doc.registerFont("Inter", Buffer.from(fonts.regular));
  doc.registerFont("Inter-SemiBold", Buffer.from(fonts.semibold));

  const chunks: Buffer[] = [];
  const done = new Promise<Uint8Array>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    doc.on("error", reject);
  });

  SVGtoPDF(doc, svg.replace(/font-weight="600"/g, 'font-weight="bold"'), 0, 0, {
    width: options.width,
    height: options.height,
    assumePt: true,
    fontCallback: (_family, bold) => (bold ? "Inter-SemiBold" : "Inter"),
    warningCallback: () => {},
  });
  doc.end();
  return done;
}
