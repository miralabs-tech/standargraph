import type { Transition } from "./schema";

export function transitionLabel(
  transition: Pick<Transition, "event" | "guard" | "action">,
): string {
  const { event, guard, action } = transition;
  return [
    event,
    guard === undefined ? undefined : `[${guard}]`,
    action === undefined ? undefined : `/ ${action}`,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" ");
}
