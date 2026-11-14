declare module "svg-to-pdfkit" {
  type Options = {
    width?: number;
    height?: number;
    assumePt?: boolean;
    fontCallback?: (
      family: string,
      bold: boolean,
      italic: boolean,
      fontOptions: { fauxBold: boolean; fauxItalic: boolean },
    ) => string;
    warningCallback?: (message: string) => void;
  };
  export default function SVGtoPDF(
    doc: unknown,
    svg: string,
    x: number,
    y: number,
    options?: Options,
  ): void;
}
