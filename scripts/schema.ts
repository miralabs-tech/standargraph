import { mkdirSync, writeFileSync } from "node:fs";
import { renderJsonSchema } from "../src/format/json-schema";

mkdirSync(new URL("../schema/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../schema/graph-document.v1.json", import.meta.url),
  renderJsonSchema(),
);
