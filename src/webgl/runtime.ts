import type { Document } from "../format";
import type { LaidOut } from "../layout/types";
import { startWebgl } from "./adapter";

function embedded<T>(id: string): T {
  return JSON.parse((document.getElementById(id) as HTMLScriptElement).textContent ?? "{}") as T;
}

startWebgl(embedded<Document>("standargraph-document"), embedded<LaidOut>("standargraph-scene"));
