import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildRuntime } from "../scripts/build-runtime";

test("the committed runtime bundle equals a fresh build", async () => {
  const committed = readFileSync(
    new URL("../src/html/runtime.generated.ts", import.meta.url),
    "utf8",
  );
  expect(await buildRuntime()).toBe(committed);
});
