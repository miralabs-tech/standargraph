import type { Meta } from "../format";

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

export type LaidOut = LaidOutGraph | LaidOutSequence;
