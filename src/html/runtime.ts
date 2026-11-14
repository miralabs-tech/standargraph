import type { Document } from "../format";
import type { LaidOut } from "../layout/types";
import { startSvg } from "./svg-adapter";
import { byId } from "./ui";

startSvg(
  JSON.parse(byId<HTMLScriptElement>("standargraph-document").textContent ?? "{}") as Document,
  JSON.parse(byId<HTMLScriptElement>("standargraph-scene").textContent ?? "{}") as LaidOut,
);
