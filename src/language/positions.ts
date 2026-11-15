import { normalize } from "../text/lexer";
import type { Position } from "./format";

export type Converter = {
  text: string;
  position(offset: number): Position;
  offset(position: Position): number;
};

function clamp(value: number, low: number, high: number): number {
  if (!(value > low)) return low;
  return value < high ? value : high;
}

export function converter(source: string): Converter {
  const text = normalize(source);
  const shift = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10) starts.push(index + 1);
  }

  const lineOf = (offset: number): number => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle]! <= offset) low = middle;
      else high = middle - 1;
    }
    return low;
  };

  return {
    text,
    position(offset) {
      const at = clamp(offset, 0, text.length);
      const line = lineOf(at);
      return { line, character: at - starts[line]! + (line === 0 ? shift : 0) };
    },
    offset(position) {
      const line = Math.floor(clamp(position.line, 0, starts.length - 1));
      const start = starts[line]!;
      const end = line + 1 < starts.length ? starts[line + 1]! - 1 : text.length;
      const column = clamp(position.character - (line === 0 ? shift : 0), 0, end - start);
      return start + Math.floor(column);
    },
  };
}
