import { expect, test } from "bun:test";
import { run } from "../src/cli";

test("--version returns 0", () => {
  expect(run(["--version"])).toBe(0);
});

test("unknown command returns 1", () => {
  expect(run(["nope"])).toBe(1);
});
