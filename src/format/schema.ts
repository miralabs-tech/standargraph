import { type Static, Type } from "@sinclair/typebox";

export const FORMAT_VERSION = 1;

const Id = Type.String({ minLength: 1 });

export const ProvenanceSchema = Type.Object(
  {
    source: Type.String({ minLength: 1 }),
    confidence: Type.Optional(
      Type.Union([
        Type.Literal("confirmed"),
        Type.Literal("inferred"),
        Type.Literal("unknown"),
      ]),
    ),
    tool: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const MetaSchema = Type.Object(
  {
    provenance: Type.Optional(ProvenanceSchema),
    coverage: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    freshness: Type.Optional(Type.String({ format: "date-time" })),
    data: Type.Optional(
      Type.Record(
        Type.String(),
        Type.Union([Type.String(), Type.Number(), Type.Boolean()]),
      ),
    ),
  },
  { additionalProperties: false },
);

export const SHAPES = [
  "box",
  "rect",
  "pill",
  "diamond",
  "circle",
  "ellipse",
  "hexagon",
  "parallelogram",
  "cylinder",
  "document",
  "subroutine",
] as const;

export const ShapeSchema = Type.Union(SHAPES.map((shape) => Type.Literal(shape)));

export const NodeSchema = Type.Object(
  {
    id: Id,
    label: Type.Optional(Type.String()),
    type: Type.Optional(Type.String()),
    shape: Type.Optional(ShapeSchema),
    group: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    link: Type.Optional(Type.String()),
    position: Type.Optional(
      Type.Object(
        { x: Type.Number(), y: Type.Number() },
        { additionalProperties: false },
      ),
    ),
    meta: Type.Optional(MetaSchema),
  },
  { additionalProperties: false },
);

export const EdgeSchema = Type.Object(
  {
    id: Type.Optional(Id),
    from: Type.String(),
    to: Type.String(),
    label: Type.Optional(Type.String()),
    type: Type.Optional(Type.String()),
    directed: Type.Optional(Type.Boolean()),
    meta: Type.Optional(MetaSchema),
  },
  { additionalProperties: false },
);

export const GroupSchema = Type.Object(
  {
    id: Id,
    label: Type.Optional(Type.String()),
    parent: Type.Optional(Type.String()),
    meta: Type.Optional(MetaSchema),
  },
  { additionalProperties: false },
);

export const DirectionSchema = Type.Union([
  Type.Literal("down"),
  Type.Literal("right"),
  Type.Literal("up"),
  Type.Literal("left"),
]);

export const GraphDocumentSchema = Type.Object(
  {
    $schema: Type.Optional(Type.String()),
    version: Type.Literal(FORMAT_VERSION),
    kind: Type.Literal("graph"),
    title: Type.Optional(Type.String()),
    direction: Type.Optional(DirectionSchema),
    nodes: Type.Array(NodeSchema),
    edges: Type.Optional(Type.Array(EdgeSchema)),
    groups: Type.Optional(Type.Array(GroupSchema)),
    meta: Type.Optional(MetaSchema),
  },
  { additionalProperties: false },
);

export const ParticipantSchema = Type.Object(
  {
    id: Id,
    label: Type.Optional(Type.String()),
    type: Type.Optional(Type.String()),
    meta: Type.Optional(MetaSchema),
  },
  { additionalProperties: false },
);

export const MessageSchema = Type.Object(
  {
    from: Type.String(),
    to: Type.String(),
    label: Type.Optional(Type.String()),
    style: Type.Optional(
      Type.Union([
        Type.Literal("sync"),
        Type.Literal("async"),
        Type.Literal("reply"),
      ]),
    ),
    meta: Type.Optional(MetaSchema),
  },
  { additionalProperties: false },
);

export const SequenceDocumentSchema = Type.Object(
  {
    $schema: Type.Optional(Type.String()),
    version: Type.Literal(FORMAT_VERSION),
    kind: Type.Literal("sequence"),
    title: Type.Optional(Type.String()),
    participants: Type.Array(ParticipantSchema, { minItems: 1 }),
    messages: Type.Array(MessageSchema),
    meta: Type.Optional(MetaSchema),
  },
  { additionalProperties: false },
);

export const PSEUDO = ["initial", "final", "choice", "fork", "join", "history"] as const;

export const StateSchema = Type.Object(
  {
    id: Id,
    label: Type.Optional(Type.String()),
    type: Type.Optional(Type.String()),
    pseudo: Type.Optional(Type.Union(PSEUDO.map((pseudo) => Type.Literal(pseudo)))),
    parent: Type.Optional(Type.String()),
    actions: Type.Optional(Type.Array(Type.String())),
    description: Type.Optional(Type.String()),
    link: Type.Optional(Type.String()),
    meta: Type.Optional(MetaSchema),
  },
  { additionalProperties: false },
);

export const TransitionSchema = Type.Object(
  {
    id: Type.Optional(Id),
    from: Type.String(),
    to: Type.String(),
    event: Type.Optional(Type.String()),
    guard: Type.Optional(Type.String()),
    action: Type.Optional(Type.String()),
    type: Type.Optional(Type.String()),
    meta: Type.Optional(MetaSchema),
  },
  { additionalProperties: false },
);

export const StateDocumentSchema = Type.Object(
  {
    $schema: Type.Optional(Type.String()),
    version: Type.Literal(FORMAT_VERSION),
    kind: Type.Literal("state"),
    title: Type.Optional(Type.String()),
    direction: Type.Optional(DirectionSchema),
    states: Type.Array(StateSchema, { minItems: 1 }),
    transitions: Type.Optional(Type.Array(TransitionSchema)),
    meta: Type.Optional(MetaSchema),
  },
  { additionalProperties: false },
);

export const KEYS = ["pk", "fk", "uk"] as const;

export const CARDINALITIES = ["one", "zero-or-one", "one-or-more", "zero-or-more"] as const;

export const AttributeSchema = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    type: Type.Optional(Type.String()),
    keys: Type.Optional(Type.Array(Type.Union(KEYS.map((key) => Type.Literal(key))))),
    nullable: Type.Optional(Type.Boolean()),
    note: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const EntitySchema = Type.Object(
  {
    id: Id,
    label: Type.Optional(Type.String()),
    type: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    link: Type.Optional(Type.String()),
    attributes: Type.Optional(Type.Array(AttributeSchema)),
    meta: Type.Optional(MetaSchema),
  },
  { additionalProperties: false },
);

const CardinalitySchema = Type.Union(CARDINALITIES.map((cardinality) => Type.Literal(cardinality)));

export const RelationSchema = Type.Object(
  {
    id: Type.Optional(Id),
    from: Type.String(),
    to: Type.String(),
    fromCardinality: Type.Optional(CardinalitySchema),
    toCardinality: Type.Optional(CardinalitySchema),
    label: Type.Optional(Type.String()),
    identifying: Type.Optional(Type.Boolean()),
    type: Type.Optional(Type.String()),
    meta: Type.Optional(MetaSchema),
  },
  { additionalProperties: false },
);

export const ErDocumentSchema = Type.Object(
  {
    $schema: Type.Optional(Type.String()),
    version: Type.Literal(FORMAT_VERSION),
    kind: Type.Literal("er"),
    title: Type.Optional(Type.String()),
    direction: Type.Optional(DirectionSchema),
    entities: Type.Array(EntitySchema, { minItems: 1 }),
    relations: Type.Optional(Type.Array(RelationSchema)),
    meta: Type.Optional(MetaSchema),
  },
  { additionalProperties: false },
);

export const TREE_LAYOUTS = ["tree", "mindmap"] as const;

export const TreeNodeSchema = Type.Object(
  {
    id: Id,
    label: Type.String(),
    parent: Type.Optional(Type.String()),
    type: Type.Optional(Type.String()),
    shape: Type.Optional(ShapeSchema),
    description: Type.Optional(Type.String()),
    link: Type.Optional(Type.String()),
    meta: Type.Optional(MetaSchema),
  },
  { additionalProperties: false },
);

export const TreeDocumentSchema = Type.Object(
  {
    $schema: Type.Optional(Type.String()),
    version: Type.Literal(FORMAT_VERSION),
    kind: Type.Literal("tree"),
    title: Type.Optional(Type.String()),
    layout: Type.Optional(Type.Union(TREE_LAYOUTS.map((layout) => Type.Literal(layout)))),
    direction: Type.Optional(DirectionSchema),
    nodes: Type.Array(TreeNodeSchema, { minItems: 1 }),
    meta: Type.Optional(MetaSchema),
  },
  { additionalProperties: false },
);

export const DocumentSchema = Type.Union(
  [
    GraphDocumentSchema,
    SequenceDocumentSchema,
    StateDocumentSchema,
    ErDocumentSchema,
    TreeDocumentSchema,
  ],
  {
    $id: "urn:standargraph:graph-document:v1",
    title: "Standargraph document v1",
  },
);

export type Shape = (typeof SHAPES)[number];
export type Meta = Static<typeof MetaSchema>;
export type Node = Static<typeof NodeSchema>;
export type Edge = Static<typeof EdgeSchema>;
export type Group = Static<typeof GroupSchema>;
export type GraphDocument = Static<typeof GraphDocumentSchema>;
export type Participant = Static<typeof ParticipantSchema>;
export type Message = Static<typeof MessageSchema>;
export type SequenceDocument = Static<typeof SequenceDocumentSchema>;
export type Pseudo = (typeof PSEUDO)[number];
export type State = Static<typeof StateSchema>;
export type Transition = Static<typeof TransitionSchema>;
export type StateDocument = Static<typeof StateDocumentSchema>;
export type Key = (typeof KEYS)[number];
export type Cardinality = (typeof CARDINALITIES)[number];
export type Attribute = Static<typeof AttributeSchema>;
export type Entity = Static<typeof EntitySchema>;
export type Relation = Static<typeof RelationSchema>;
export type ErDocument = Static<typeof ErDocumentSchema>;
export type TreeLayout = (typeof TREE_LAYOUTS)[number];
export type TreeNode = Static<typeof TreeNodeSchema>;
export type TreeDocument = Static<typeof TreeDocumentSchema>;
export type Document = Static<typeof DocumentSchema>;
