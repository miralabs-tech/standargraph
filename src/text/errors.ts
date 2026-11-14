export type TextErrorCode =
  | "E_HEADER"
  | "E_TOKEN"
  | "E_STRING"
  | "E_ESCAPE"
  | "E_EXPECTED"
  | "E_OPERATOR"
  | "E_ATTR"
  | "E_VALUE"
  | "E_DUPLICATE"
  | "E_REGION"
  | "E_BLOCK"
  | "E_INDENT"
  | "E_ROOT"
  | "E_VALIDATE";

export type TextError = {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  code: TextErrorCode;
  message: string;
};

export type Range = { start: number; end: number };

export const STOP = Symbol("too many errors");

const MAX_ERRORS = 50;

export class LineMap {
  private readonly starts: number[] = [0];

  constructor(source: string) {
    for (let index = 0; index < source.length; index++) {
      if (source.charCodeAt(index) === 10) this.starts.push(index + 1);
    }
  }

  line(offset: number): number {
    let low = 0;
    let high = this.starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (this.starts[middle]! <= offset) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  }

  position(offset: number): { line: number; column: number } {
    const line = this.line(offset);
    return { line, column: offset - this.starts[line - 1]! + 1 };
  }

  error(code: TextErrorCode, range: Range, message: string): TextError {
    const start = this.position(range.start);
    const end = this.position(range.end);
    return {
      line: start.line,
      column: start.column,
      endLine: end.line,
      endColumn: end.column,
      code,
      message,
    };
  }
}

export class Sink {
  readonly errors: TextError[] = [];
  muted = 0;

  constructor(readonly lines: LineMap) {}

  lineOf(offset: number): number {
    return this.lines.line(offset);
  }

  report(code: TextErrorCode, range: Range, message: string): void {
    if (this.muted > 0) return;
    if (this.errors.length >= MAX_ERRORS) {
      this.errors.push(this.lines.error("E_TOKEN", range, "Too many errors"));
      throw STOP;
    }
    this.errors.push(this.lines.error(code, range, message));
  }

  sorted(): TextError[] {
    return this.errors
      .map((error, order) => ({ error, order }))
      .sort(
        (a, b) =>
          a.error.line - b.error.line ||
          a.error.column - b.error.column ||
          a.order - b.order,
      )
      .map(({ error }) => error);
  }
}
