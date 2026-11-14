import type { State, StateDocument } from "../format/schema";
import { transitionLabel } from "../format/transition-label";
import {
  BLOCK_DIRECTIONS,
  Ids,
  mlabel,
  noteLosses,
  plainText,
  type Warnings,
} from "./common";

const MARKER = "[*]";

function isTerminal(state: State): boolean {
  return state.pseudo === "initial" || state.pseudo === "final";
}

export function stateLines(doc: StateDocument, warnings: Warnings): string[] {
  const ids = new Ids();
  const byId = new Map<string, State>();
  const children = new Map<string, State[]>();
  for (const state of doc.states) {
    byId.set(state.id, state);
    noteLosses(warnings, state);
    if (!isTerminal(state)) ids.add(state.id, state.id);
    const key = state.parent ?? "";
    const list = children.get(key);
    if (list === undefined) children.set(key, [state]);
    else list.push(state);
  }

  const chain = (region: string): string[] => {
    const result = [region];
    let current = region;
    while (current !== "") {
      current = byId.get(current)?.parent ?? "";
      result.push(current);
    }
    return result;
  };
  const lowestCommon = (first: string, second: string): string => {
    const above = new Set(chain(first));
    return chain(second).find((region) => above.has(region)) ?? "";
  };

  const transitionsByRegion = new Map<string, string[]>();
  for (const transition of doc.transitions ?? []) {
    noteLosses(warnings, transition);
    const from = byId.get(transition.from)!;
    const to = byId.get(transition.to)!;
    const fromTerminal = isTerminal(from);
    const toTerminal = isTerminal(to);
    let region: string;
    if (fromTerminal) region = from.parent ?? "";
    else if (toTerminal) region = to.parent ?? "";
    else region = lowestCommon(from.parent ?? "", to.parent ?? "");
    if (
      !fromTerminal &&
      !toTerminal &&
      from.parent !== undefined &&
      to.parent !== undefined &&
      from.parent !== to.parent
    ) {
      warnings.add(
        "a transition between internal states of different composites may be refused by Mermaid",
      );
    }
    const label = transitionLabel(transition);
    const left = fromTerminal ? MARKER : ids.get(from.id);
    const right = toTerminal ? MARKER : ids.get(to.id);
    const line = `${left} --> ${right}${label === "" ? "" : ` : ${plainText(label)}`}`;
    const list = transitionsByRegion.get(region);
    if (list === undefined) transitionsByRegion.set(region, [line]);
    else list.push(line);
  }

  const lines = ["stateDiagram-v2", `  direction ${BLOCK_DIRECTIONS[doc.direction ?? "down"]}`];
  const emit = (region: string, depth: number): void => {
    const indent = "  ".repeat(depth);
    for (const state of children.get(region) ?? []) {
      if (isTerminal(state)) continue;
      const id = ids.get(state.id);
      if (state.pseudo === "choice" || state.pseudo === "fork" || state.pseudo === "join") {
        lines.push(`${indent}state ${id} <<${state.pseudo}>>`);
        continue;
      }
      if (state.pseudo === "history") {
        warnings.add('pseudo-state "history" written as a plain state');
        lines.push(`${indent}state "H" as ${id}`);
        continue;
      }
      lines.push(`${indent}state ${mlabel(state.label ?? state.id)} as ${id}`);
      for (const action of state.actions ?? []) {
        lines.push(`${indent}${id} : ${plainText(action)}`);
      }
      if (children.has(state.id)) {
        lines.push(`${indent}state ${id} {`);
        emit(state.id, depth + 1);
        lines.push(`${indent}}`);
      }
    }
    for (const line of transitionsByRegion.get(region) ?? []) lines.push(`${indent}${line}`);
  };
  emit("", 1);
  return lines;
}
