import type { Kind } from "../text/parser";

export type AttrContext =
  | "header"
  | "node"
  | "group"
  | "edge"
  | "participant"
  | "message"
  | "state"
  | "transition"
  | "entity"
  | "attribute"
  | "relation"
  | "treeNode";

export const KIND_DOCS: Readonly<Record<Kind, string>> = {
  graph: "Graph diagram: nodes, groups and edges laid out automatically.",
  sequence: "Sequence diagram: participants exchanging messages in order.",
  state: "State machine: states, nested states and transitions.",
  er: "Entity-relation diagram: entities with attributes and the relations between them.",
  tree: "Tree or mind map: one root and indented child lines.",
};

const DIRECTION = "Layout direction: down, right, up or left.";
const LAYOUT = "Tree layout: tree or mindmap.";
const ID = "Explicit id of this item, used instead of the generated one.";
const TYPE = "Free-form type of this item, used for styling and grouping (for example page, service or database).";
const SHAPE =
  "Node shape: box, rect, pill, diamond, circle, ellipse, hexagon, parallelogram, cylinder, document or subroutine.";
const LINK = "URL or path this item links to.";
const DESCRIPTION = "Longer description shown with this item.";

const HEADER_DOCS: Readonly<Record<Kind, Readonly<Record<string, string>>>> = {
  graph: { direction: DIRECTION },
  sequence: {},
  state: { direction: DIRECTION },
  er: { direction: DIRECTION },
  tree: { direction: DIRECTION, layout: LAYOUT },
};

const FIELD_DOCS: Readonly<Record<Exclude<AttrContext, "header">, Readonly<Record<string, string>>>> = {
  node: {
    type: TYPE,
    shape: SHAPE,
    link: LINK,
    description: DESCRIPTION,
    x: "Fixed horizontal position of the node; goes together with y.",
    y: "Fixed vertical position of the node; goes together with x.",
  },
  group: {},
  edge: { id: "Explicit id of this edge.", type: "Free-form type of this edge." },
  participant: { type: TYPE },
  message: {},
  state: {
    type: TYPE,
    pseudo: "Pseudo-state kind: initial, final, choice, fork, join or history.",
    actions: 'List of actions run by this state, for example ["entry / start"].',
    description: DESCRIPTION,
    link: LINK,
  },
  transition: {
    id: "Explicit id of this transition.",
    guard: "Condition that must hold for the transition to fire.",
    action: "Action run when the transition fires.",
    type: "Free-form type of this transition.",
  },
  entity: { type: TYPE, description: DESCRIPTION, link: LINK },
  attribute: { note: "Free-text note about this attribute." },
  relation: { id: "Explicit id of this relation.", type: "Free-form type of this relation." },
  treeNode: { id: ID, type: TYPE, shape: SHAPE, description: DESCRIPTION, link: LINK },
};

const META_DOCS: Readonly<Record<string, string>> = {
  source: "Provenance: where this information comes from (file, URL or tool output).",
  confidence: "Provenance confidence: confirmed, inferred or unknown. Needs source.",
  tool: "Provenance: the tool that produced this information. Needs source.",
  coverage: "Share of the subject that is covered, a number from 0 to 1.",
  freshness: "When this information was last verified, as an ISO 8601 date-time.",
};

export function attributeDoc(context: AttrContext, key: string, kind: Kind): string | undefined {
  const own = context === "header" ? HEADER_DOCS[kind] : FIELD_DOCS[context];
  if (Object.hasOwn(own, key)) return own[key];
  if (context === "attribute") return undefined;
  if (Object.hasOwn(META_DOCS, key)) return META_DOCS[key];
  if (key.startsWith("data.") && key.length > 5) {
    return "Custom data value stored under meta.data (string, number or boolean).";
  }
  return undefined;
}
