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

export const NodeSchema = Type.Object(
  {
    id: Id,
    label: Type.Optional(Type.String()),
    type: Type.Optional(Type.String()),
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

export const GraphDocumentSchema = Type.Object(
  {
    $schema: Type.Optional(Type.String()),
    version: Type.Literal(FORMAT_VERSION),
    kind: Type.Literal("graph"),
    title: Type.Optional(Type.String()),
    direction: Type.Optional(
      Type.Union([
        Type.Literal("down"),
        Type.Literal("right"),
        Type.Literal("up"),
        Type.Literal("left"),
      ]),
    ),
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

export const DocumentSchema = Type.Union(
  [GraphDocumentSchema, SequenceDocumentSchema],
  {
    $id: "urn:standargraph:graph-document:v1",
    title: "Standargraph document v1",
  },
);

export type Meta = Static<typeof MetaSchema>;
export type Node = Static<typeof NodeSchema>;
export type Edge = Static<typeof EdgeSchema>;
export type Group = Static<typeof GroupSchema>;
export type GraphDocument = Static<typeof GraphDocumentSchema>;
export type Participant = Static<typeof ParticipantSchema>;
export type Message = Static<typeof MessageSchema>;
export type SequenceDocument = Static<typeof SequenceDocumentSchema>;
export type Document = Static<typeof DocumentSchema>;
