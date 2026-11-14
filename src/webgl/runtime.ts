import type { Document } from "../format";
import { byId } from "../html/ui";
import type { LaidOut } from "../layout/types";
import { startWebgl } from "./adapter";

startWebgl(
  JSON.parse(byId<HTMLScriptElement>("standargraph-document").textContent ?? "{}") as Document,
  JSON.parse(byId<HTMLScriptElement>("standargraph-scene").textContent ?? "{}") as LaidOut,
);
