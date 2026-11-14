import type { SequenceDocument } from "../format";
import { measureText } from "./measure";
import {
  boxSize,
  compact,
  EDGE_LABEL_FONT,
  labelBoxSize,
  MARGIN,
  round,
  SELF_LOOP_HEIGHT,
  SELF_LOOP_WIDTH,
} from "./shared";
import type {
  Box,
  LaidOutMessage,
  LaidOutParticipant,
  LaidOutSequence,
} from "./types";

const MIN_GAP = 40;
const FIRST_ROW_OFFSET = 40;
const MIN_ROW = 36;
const LIFELINE_TAIL = 30;
const SELF_LABEL_OFFSET = 6;

type Requirement = { from: number; to: number; distance: number };

export function layoutSequence(doc: SequenceDocument): LaidOutSequence {
  const sizes = doc.participants.map((participant) =>
    boxSize(participant.label ?? participant.id, participant.type, 100),
  );
  const headerHeight = Math.max(...sizes.map((size) => size.height));
  const indexOf = new Map<string, number>();
  doc.participants.forEach((participant, index) =>
    indexOf.set(participant.id, index),
  );

  const gaps: number[] = [];
  for (let i = 0; i < sizes.length - 1; i++) {
    gaps.push(sizes[i]!.width / 2 + sizes[i + 1]!.width / 2 + MIN_GAP);
  }

  const requirements: Requirement[] = [];
  const selfExtent: Array<{ participant: number; extent: number }> = [];
  for (const message of doc.messages) {
    const a = indexOf.get(message.from)!;
    const b = indexOf.get(message.to)!;
    const labelWidth =
      message.label === undefined || message.label === ""
        ? 0
        : labelBoxSize(message.label).width;
    if (a === b) {
      const extent = SELF_LOOP_WIDTH + SELF_LABEL_OFFSET + labelWidth;
      selfExtent.push({ participant: a, extent });
      if (a < sizes.length - 1) {
        requirements.push({ from: a, to: a + 1, distance: extent + 10 });
      }
    } else if (labelWidth > 0) {
      requirements.push({
        from: Math.min(a, b),
        to: Math.max(a, b),
        distance: labelWidth + 16,
      });
    }
  }
  requirements.sort((x, y) => x.to - x.from - (y.to - y.from));
  for (const requirement of requirements) {
    const span = requirement.to - requirement.from;
    let current = 0;
    for (let k = requirement.from; k < requirement.to; k++) current += gaps[k]!;
    if (current < requirement.distance) {
      const extra = (requirement.distance - current) / span;
      for (let k = requirement.from; k < requirement.to; k++) gaps[k]! += extra;
    }
  }

  const centers: number[] = [MARGIN + sizes[0]!.width / 2];
  for (let i = 0; i < gaps.length; i++) {
    centers.push(centers[i]! + gaps[i]!);
  }

  const participants: LaidOutParticipant[] = doc.participants.map(
    (participant, index) => {
      const size = sizes[index]!;
      return compact({
        id: participant.id,
        label: participant.label ?? participant.id,
        type: participant.type,
        x: round(centers[index]! - size.width / 2),
        y: MARGIN,
        width: size.width,
        height: headerHeight,
        lifelineX: round(centers[index]!),
        meta: participant.meta,
      });
    },
  );

  let cursor = MARGIN + headerHeight + FIRST_ROW_OFFSET;
  const messages: LaidOutMessage[] = doc.messages.map((message, index) => {
    const a = indexOf.get(message.from)!;
    const b = indexOf.get(message.to)!;
    const self = a === b;
    const hasLabel = message.label !== undefined && message.label !== "";
    const textHeight = hasLabel
      ? measureText(message.label!, EDGE_LABEL_FONT).height
      : 0;
    const row = Math.max(MIN_ROW, textHeight + 20);
    const x1 = centers[a]!;
    const x2 = centers[b]!;
    let y: number;
    let rowHeight: number;
    let labelBox: Box | undefined;
    if (self) {
      rowHeight = row * 1.5;
      y = cursor + 10;
      if (hasLabel) {
        const size = labelBoxSize(message.label!);
        labelBox = {
          x: x1 + SELF_LOOP_WIDTH + SELF_LABEL_OFFSET,
          y: y + SELF_LOOP_HEIGHT / 2 - size.height / 2,
          ...size,
        };
      }
    } else {
      rowHeight = row;
      y = cursor + row - 8;
      if (hasLabel) {
        const size = labelBoxSize(message.label!);
        labelBox = {
          x: (x1 + x2) / 2 - size.width / 2,
          y: y - 3 - size.height,
          ...size,
        };
      }
    }
    cursor += rowHeight;
    return compact({
      index,
      from: message.from,
      to: message.to,
      label: message.label,
      style: message.style ?? "sync",
      y: round(y),
      x1: round(x1),
      x2: round(x2),
      self,
      labelBox:
        labelBox === undefined
          ? undefined
          : {
              x: round(labelBox.x),
              y: round(labelBox.y),
              width: labelBox.width,
              height: labelBox.height,
            },
      meta: message.meta,
    });
  });

  const lifelineBottom = cursor + LIFELINE_TAIL;
  let right = 0;
  for (let i = 0; i < sizes.length; i++) {
    right = Math.max(right, centers[i]! + sizes[i]!.width / 2);
  }
  for (const { participant, extent } of selfExtent) {
    right = Math.max(right, centers[participant]! + extent);
  }

  return compact({
    kind: "sequence" as const,
    width: round(right + MARGIN),
    height: round(lifelineBottom + MARGIN),
    title: doc.title,
    participants,
    messages,
    lifelineBottom: round(lifelineBottom),
  });
}
