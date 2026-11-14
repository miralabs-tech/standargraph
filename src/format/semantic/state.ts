import type { StateDocument } from "../schema";
import { checkUnique, parentCycles, type ValidationError } from "./shared";

export function semanticStateErrors(doc: StateDocument): ValidationError[] {
  const errors: ValidationError[] = [];
  const stateIds = checkUnique(doc.states, "states", "state", errors);
  const transitions = doc.transitions ?? [];
  checkUnique(transitions, "transitions", "transition", errors);

  const pseudoOf = new Map<string, string | undefined>();
  for (const state of doc.states) {
    if (!pseudoOf.has(state.id)) pseudoOf.set(state.id, state.pseudo);
  }

  const outgoing = new Map<string, number>();
  transitions.forEach((transition, index) => {
    outgoing.set(transition.from, (outgoing.get(transition.from) ?? 0) + 1);
    if (!stateIds.has(transition.from)) {
      errors.push({
        path: `/transitions/${index}/from`,
        message: `Transition source "${transition.from}" is not a known state id`,
      });
    } else if (pseudoOf.get(transition.from) === "final") {
      errors.push({
        path: `/transitions/${index}/from`,
        message: `Transition out of a final pseudo-state "${transition.from}"`,
      });
    }
    if (!stateIds.has(transition.to)) {
      errors.push({
        path: `/transitions/${index}/to`,
        message: `Transition target "${transition.to}" is not a known state id`,
      });
    } else if (pseudoOf.get(transition.to) === "initial") {
      errors.push({
        path: `/transitions/${index}/to`,
        message: `Transition into an initial pseudo-state "${transition.to}"`,
      });
    }
  });

  const initialRegions = new Set<string>();
  doc.states.forEach((state, index) => {
    if (state.parent !== undefined) {
      if (!stateIds.has(state.parent)) {
        errors.push({
          path: `/states/${index}/parent`,
          message: `Parent state "${state.parent}" is not a known state id`,
        });
      } else if (pseudoOf.get(state.parent) !== undefined) {
        errors.push({
          path: `/states/${index}/parent`,
          message: `Parent state "${state.parent}" is a pseudo-state and cannot contain states`,
        });
      }
    }
    if (state.pseudo !== undefined && state.actions !== undefined && state.actions.length > 0) {
      errors.push({
        path: `/states/${index}/actions`,
        message: "Pseudo-states carry no actions",
      });
    }
    if (state.pseudo === "initial") {
      const found = outgoing.get(state.id) ?? 0;
      if (found !== 1) {
        errors.push({
          path: `/states/${index}`,
          message: `Initial pseudo-state "${state.id}" needs exactly one outgoing transition (found ${found})`,
        });
      }
      const region = state.parent ?? "root";
      if (initialRegions.has(region)) {
        errors.push({
          path: `/states/${index}/pseudo`,
          message: `More than one initial pseudo-state in region "${region}"`,
        });
      }
      initialRegions.add(region);
    }
  });

  for (const { index, cycle } of parentCycles(doc.states)) {
    errors.push({
      path: `/states/${index}/parent`,
      message: `State parent cycle: ${cycle.join(" -> ")}`,
    });
  }

  return errors;
}
