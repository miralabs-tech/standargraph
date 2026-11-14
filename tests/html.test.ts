import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildLayoutWorker, buildRuntime, buildWebglRuntime } from "../scripts/build-runtime";

function committed(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("the committed runtime bundle equals a fresh build", async () => {
  expect(await buildRuntime()).toBe(committed("../src/html/runtime.generated.ts"));
});

test("the committed WebGL runtime bundle equals a fresh build", async () => {
  expect(await buildWebglRuntime()).toBe(committed("../src/webgl/runtime.generated.ts"));
});

test("the committed layout worker bundle equals a fresh build", async () => {
  expect(await buildLayoutWorker()).toBe(committed("../src/html/layout-worker.generated.ts"));
}, 60000);
