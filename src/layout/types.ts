import type { Cardinality, Key, Meta, Pseudo, Shape } from "../format";

export type Point = { x: number; y: number };

export type Box = { x: number; y: number; width: number; height: number };

export type LaidOutGroup = {
  id: string;
  label?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  meta?: Meta;
};

export type LaidOutNode = {
  id: string;
  label: string;
  type?: string;
  shape?: Shape;
  x: number;
  y: number;
  width: number;
  height: number;
  group?: string;
  link?: string;
  description?: string;
  meta?: Meta;
};

export type LaidOutEdge = {
  id: string;
  from: string;
  to: string;
  label?: string;
  type?: string;
  directed: boolean;
  points: Point[];
  labelBox?: Box;
  meta?: Meta;
};

export type LaidOutGraph = {
  kind: "graph";
  width: number;
  height: number;
  title?: string;
  groups: LaidOutGroup[];
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
};

export type LaidOutParticipant = {
  id: string;
  label: string;
  type?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  lifelineX: number;
  meta?: Meta;
};

export type MessageStyle = "sync" | "async" | "reply";

export type LaidOutMessage = {
  index: number;
  from: string;
  to: string;
  label?: string;
  style: MessageStyle;
  y: number;
  x1: number;
  x2: number;
  self: boolean;
  labelBox?: Box;
  meta?: Meta;
};

export type LaidOutSequence = {
  kind: "sequence";
  width: number;
  height: number;
  title?: string;
  participants: LaidOutParticipant[];
  messages: LaidOutMessage[];
  lifelineBottom: number;
};

export type LaidOutState = {
  id: string;
  label: string;
  type?: string;
  pseudo?: Pseudo;
  composite: boolean;
  parent?: string;
  depth: number;
  actions?: string[];
  description?: string;
  link?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  meta?: Meta;
};

export type LaidOutTransition = {
  id: string;
  from: string;
  to: string;
  label?: string;
  event?: string;
  guard?: string;
  action?: string;
  type?: string;
  points: Point[];
  labelBox?: Box;
  meta?: Meta;
};

export type LaidOutStateMachine = {
  kind: "state";
  width: number;
  height: number;
  title?: string;
  states: LaidOutState[];
  transitions: LaidOutTransition[];
};

export type LaidOutAttribute = {
  name: string;
  type?: string;
  keys?: Key[];
  nullable?: boolean;
  note?: string;
  y: number;
  height: number;
};

export type LaidOutEntity = {
  id: string;
  label: string;
  type?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  headerHeight: number;
  columns: { key: number; name: number; type: number };
  attributes: LaidOutAttribute[];
  description?: string;
  link?: string;
  meta?: Meta;
};

export type LaidOutRelation = {
  id: string;
  from: string;
  to: string;
  label?: string;
  fromCardinality?: Cardinality;
  toCardinality?: Cardinality;
  identifying: boolean;
  type?: string;
  points: Point[];
  labelBox?: Box;
  meta?: Meta;
};

export type LaidOutEr = {
  kind: "er";
  width: number;
  height: number;
  title?: string;
  entities: LaidOutEntity[];
  relations: LaidOutRelation[];
};

export type LaidOutTreeNode = LaidOutNode & {
  depth: number;
  parent?: string;
  side?: "left" | "right";
};

export type LaidOutTreeEdge = {
  id: string;
  from: string;
  to: string;
  points: Point[];
  curve: "elbow" | "bezier";
};

export type LaidOutTree = {
  kind: "tree";
  layout: "tree" | "mindmap";
  width: number;
  height: number;
  title?: string;
  nodes: LaidOutTreeNode[];
  edges: LaidOutTreeEdge[];
};

export type LaidOut =
  | LaidOutGraph
  | LaidOutSequence
  | LaidOutStateMachine
  | LaidOutEr
  | LaidOutTree;
