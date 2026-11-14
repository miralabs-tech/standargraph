import type { Shape, State, StateDocument } from "../format";
import { transitionLabel } from "../format/transition-label";
import { type ElkBoxInput, type ElkEdgeInput, runElk } from "./elk";
import { measureText } from "./measure";
import {
  actionsHeight,
  actionsWidth,
  boxSize,
  compact,
  GROUP_FONT,
  groupTopPadding,
  labelBoxSize,
  PAD_X,
  PAD_Y,
  round,
} from "./shared";
import { clipEnds } from "./shapes";
import type {
  Box,
  LaidOutState,
  LaidOutStateMachine,
  LaidOutTransition,
  Point,
} from "./types";

type Size = { width: number; height: number };

const CLIP_SHAPES: Partial<Record<NonNullable<State["pseudo"]>, Shape>> = {
  initial: "circle",
  final: "circle",
  history: "circle",
  choice: "diamond",
};

function stateLabel(state: State): string {
  return state.label ?? state.id;
}

function pseudoSize(
  pseudo: NonNullable<State["pseudo"]>,
  vertical: boolean,
): Size {
  switch (pseudo) {
    case "initial":
      return { width: 20, height: 20 };
    case "final":
    case "history":
      return { width: 24, height: 24 };
    case "choice":
      return { width: 28, height: 28 };
    case "fork":
    case "join":
      return vertical ? { width: 6, height: 64 } : { width: 64, height: 6 };
  }
}

function simpleSize(state: State): Size {
  const base = boxSize(stateLabel(state), state.type, 80);
  const actions = state.actions ?? [];
  if (actions.length === 0) return base;
  return {
    width: Math.ceil(Math.max(base.width, actionsWidth(actions) + 2 * PAD_X)),
    height: Math.ceil(base.height + actionsHeight(actions.length) + PAD_Y),
  };
}

export async function layoutState(doc: StateDocument): Promise<LaidOutStateMachine> {
  const direction = doc.direction ?? "down";
  const children = new Map<string | undefined, State[]>();
  for (const state of doc.states) {
    const list = children.get(state.parent) ?? [];
    list.push(state);
    children.set(state.parent, list);
  }

  const stateElk = (state: State): ElkBoxInput => {
    const members = children.get(state.id);
    if (members === undefined) {
      const size =
        state.pseudo === undefined
          ? simpleSize(state)
          : pseudoSize(state.pseudo, direction === "right" || direction === "left");
      return { id: `s:${state.id}`, width: size.width, height: size.height };
    }
    const title = stateLabel(state);
    const actions = state.actions ?? [];
    return {
      id: `s:${state.id}`,
      width: 0,
      height: 0,
      padding: {
        top: groupTopPadding(title) + actionsHeight(actions.length),
        left: PAD_X,
        bottom: PAD_X,
        right: PAD_X,
      },
      minWidth: Math.ceil(
        Math.max(measureText(title, GROUP_FONT).width, actionsWidth(actions)) + 2 * PAD_X,
      ),
      children: members.map(stateElk),
    };
  };

  const transitions = doc.transitions ?? [];
  const labels = transitions.map(transitionLabel);
  const elkEdges: ElkEdgeInput[] = transitions.map((transition, index) => {
    const edge: ElkEdgeInput = {
      id: `t:${index}`,
      from: `s:${transition.from}`,
      to: `s:${transition.to}`,
    };
    const label = labels[index]!;
    if (label !== "") {
      const size = labelBoxSize(label);
      edge.label = { width: size.width, height: size.height };
    }
    return edge;
  });

  const result = await runElk(
    direction,
    (children.get(undefined) ?? []).map(stateElk),
    elkEdges,
  );

  const boxOf = (id: string): Box =>
    result.boxes.get(`s:${id}`) ?? { x: 0, y: 0, width: 0, height: 0 };

  const byId = new Map(doc.states.map((state) => [state.id, state]));
  const depthOf = (state: State): number => {
    let depth = 0;
    for (
      let parent = state.parent;
      parent !== undefined;
      parent = byId.get(parent)?.parent
    ) {
      depth += 1;
    }
    return depth;
  };

  const clipShape = (id: string): Shape | undefined => {
    const pseudo = byId.get(id)?.pseudo;
    return pseudo === undefined ? undefined : CLIP_SHAPES[pseudo];
  };

  const laidOutStates: LaidOutState[] = doc.states.map((state) => {
    const box = boxOf(state.id);
    return compact({
      id: state.id,
      label: stateLabel(state),
      type: state.type,
      pseudo: state.pseudo,
      composite: children.has(state.id),
      parent: state.parent,
      depth: depthOf(state),
      actions: state.actions,
      description: state.description,
      link: state.link,
      x: round(box.x),
      y: round(box.y),
      width: round(box.width),
      height: round(box.height),
      meta: state.meta,
    });
  });

  const laidOutTransitions: LaidOutTransition[] = transitions.map((transition, index) => {
    const route = result.routes.get(`t:${index}`);
    const points: Point[] = clipEnds(
      route?.points ?? [],
      clipShape(transition.from),
      boxOf(transition.from),
      clipShape(transition.to),
      boxOf(transition.to),
    ).map((point) => ({ x: round(point.x), y: round(point.y) }));
    const labelBox = route?.labelBox;
    return compact({
      id: transition.id ?? `t${index}`,
      from: transition.from,
      to: transition.to,
      label: labels[index] === "" ? undefined : labels[index],
      event: transition.event,
      guard: transition.guard,
      action: transition.action,
      type: transition.type,
      points,
      labelBox:
        labelBox === undefined
          ? undefined
          : {
              x: round(labelBox.x),
              y: round(labelBox.y),
              width: round(labelBox.width),
              height: round(labelBox.height),
            },
      meta: transition.meta,
    });
  });

  return compact({
    kind: "state" as const,
    width: round(result.width),
    height: round(result.height),
    title: doc.title,
    states: laidOutStates,
    transitions: laidOutTransitions,
  });
}
