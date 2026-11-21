import { describe, expect, test } from "bun:test";
import { edgeWidthScale } from "../src/svg/weight";

describe("edgeWidthScale", () => {
  test("no weight gives the base width", () => {
    const width = edgeWidthScale([{}, {}]);
    expect(width(undefined)).toBe(1.5);
    expect(width(4)).toBe(1.5);
  });

  test("equal weights give the base width", () => {
    const width = edgeWidthScale([{ weight: 2 }, { weight: 2 }]);
    expect(width(2)).toBe(1.5);
  });

  test("weights scale linearly from 1.5 to 6", () => {
    const width = edgeWidthScale([{ weight: 0 }, { weight: 10 }, { weight: 5 }, {}]);
    expect(width(0)).toBe(1.5);
    expect(width(10)).toBe(6);
    expect(width(5)).toBe(3.75);
    expect(width(undefined)).toBe(1.5);
  });
});
