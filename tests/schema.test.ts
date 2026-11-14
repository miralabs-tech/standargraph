import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildJsonSchema, renderJsonSchema } from "../src/format/json-schema";

const committed = new URL("../schema/graph-document.v1.json", import.meta.url);

test("committed JSON Schema matches the generated one", () => {
  const onDisk: unknown = JSON.parse(readFileSync(committed, "utf8"));
  expect(onDisk).toEqual(buildJsonSchema());
});

test("committed JSON Schema file is byte-identical to the generated output", () => {
  expect(readFileSync(committed, "utf8").replace(/\r\n/g, "\n")).toBe(
    renderJsonSchema(),
  );
});
