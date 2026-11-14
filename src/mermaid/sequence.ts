import type { SequenceDocument } from "../format/schema";
import { Ids, noteLosses, plainText, type Warnings } from "./common";

const ARROWS = { sync: "->>", async: "-)", reply: "-->>" } as const;

export function sequenceLines(doc: SequenceDocument, warnings: Warnings): string[] {
  const ids = new Ids();
  const lines = ["sequenceDiagram"];
  for (const participant of doc.participants) {
    noteLosses(warnings, participant);
    const id = ids.add(participant.id, participant.id);
    const label = plainText(participant.label ?? participant.id);
    lines.push(label === id ? `  participant ${id}` : `  participant ${id} as ${label}`);
  }
  for (const message of doc.messages) {
    noteLosses(warnings, message);
    const arrow = ARROWS[message.style ?? "sync"];
    const text =
      message.label === undefined || message.label === "" ? "" : ` ${plainText(message.label)}`;
    lines.push(`  ${ids.get(message.from)}${arrow}${ids.get(message.to)}:${text}`);
  }
  return lines;
}
