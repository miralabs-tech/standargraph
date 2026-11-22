import { DirectionSchema, GRAPH_LAYOUTS, PSEUDO, SHAPES, TREE_LAYOUTS } from "../format/schema";
import type { Kind, OpSymbol } from "../text/parser";

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
const GRAPH_LAYOUT = "Graph layout: layered (default) or stress.";
const ID = "Explicit id of this item, used instead of the generated one.";
const TYPE = "Free-form type of this item, used for styling and grouping (for example page, service or database).";
const SHAPE =
  "Node shape: box, rect, pill, diamond, circle, ellipse, hexagon, parallelogram, cylinder, document or subroutine.";
const LINK = "URL or path this item links to.";
const DESCRIPTION = "Longer description shown with this item.";

const HEADER_DOCS: Readonly<Record<Kind, Readonly<Record<string, string>>>> = {
  graph: { direction: DIRECTION, layout: GRAPH_LAYOUT },
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
  edge: {
    id: "Explicit id of this edge.",
    type: "Free-form type of this edge.",
    weight: "Edge weight, a number ≥ 0; drawn as stroke width relative to the other edges.",
    description: DESCRIPTION,
    link: LINK,
  },
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

export const DATA_NAMESPACE_DOC =
  "Free metadata: data.<name>=value stores a custom string, number or boolean under meta.data.";

export const KEYWORD_DOCS: Readonly<Record<string, string>> = {
  group: 'Group of nodes: group id "Label" { ... }.',
  initial: "Initial pseudo-state, the start of a state machine: initial -> state.",
  final: "Final pseudo-state, the end of a state machine: state -> final.",
};

export const FLAG_DOCS: Readonly<Record<string, string>> = {
  pk: "Primary key.",
  fk: "Foreign key.",
  uk: "Unique key.",
  null: "The attribute accepts null values.",
};

export const OPERATOR_DOCS: Readonly<Record<OpSymbol, string>> = {
  "->": "Directed link: an edge, a synchronous message or a transition.",
  "--": "Undirected edge, or an identifying relation.",
  "->>": "Asynchronous message.",
  "-->": "Reply message.",
  "..": "Non-identifying relation.",
};

export const CARDINALITY_DOCS: Readonly<Record<string, string>> = {
  "1": "Exactly one.",
  "0..1": "Zero or one.",
  "1..*": "One or more.",
  "0..*": "Zero or more.",
};

const DIRECTIONS: readonly string[] = DirectionSchema.anyOf.map((literal) => literal.const);
const CONFIDENCES = ["confirmed", "inferred", "unknown"];

export function attributeKeys(context: AttrContext, kind: Kind): string[] {
  const own = context === "header" ? HEADER_DOCS[kind] : FIELD_DOCS[context];
  const keys = Object.keys(own);
  if (context !== "attribute") keys.push(...Object.keys(META_DOCS));
  return keys;
}

export function attributeValues(context: AttrContext, key: string, kind: Kind): readonly string[] | undefined {
  if (context === "attribute") return undefined;
  if (key === "confidence") return CONFIDENCES;
  if (key.startsWith("data.") && key.length > 5) return ["true", "false"];
  if (context === "header") {
    if (key === "direction" && Object.hasOwn(HEADER_DOCS[kind], key)) return DIRECTIONS;
    if (key === "layout" && kind === "tree") return TREE_LAYOUTS;
    if (key === "layout" && kind === "graph") return GRAPH_LAYOUTS;
    return undefined;
  }
  if (key === "shape" && (context === "node" || context === "treeNode")) return SHAPES;
  if (key === "pseudo" && context === "state") return PSEUDO;
  return undefined;
}
