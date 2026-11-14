import type { Document } from "../format";
import type { LaidOut } from "../layout/types";
import { startSvg } from "./svg-adapter";

function embedded<T>(id: string): T {
  return JSON.parse((document.getElementById(id) as HTMLScriptElement).textContent ?? "{}") as T;
}

startSvg(embedded<Document>("standargraph-document"), embedded<LaidOut>("standargraph-scene"));
