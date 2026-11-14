import { FormatRegistry } from "@sinclair/typebox";
import { Value, ValueErrorType } from "@sinclair/typebox/value";
import {
  FORMAT_VERSION,
  SHAPES,
  type Document,
  type GraphDocument,
  GraphDocumentSchema,
  type SequenceDocument,
  SequenceDocumentSchema,
} from "./schema";

export type ValidationError = { path: string; message: string };

export type ValidationResult =
  | { ok: true; document: Document }
  | { ok: false; errors: ValidationError[] };

const DATE_TIME =
  /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

const VERSION_MESSAGE = `Missing or unsupported version: this tool supports version ${FORMAT_VERSION} only`;

if (!FormatRegistry.Has("date-time")) {
  FormatRegistry.Set(
    "date-time",
    (value) => DATE_TIME.test(value) && !Number.isNaN(Date.parse(value)),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function structuralErrors(
  schema: typeof GraphDocumentSchema | typeof SequenceDocumentSchema,
  input: unknown,
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const error of Value.Errors(schema, input)) {
    let message = error.message;
    if (error.path === "/version") {
      message = VERSION_MESSAGE;
    } else if (error.type === ValueErrorType.Union) {
      message = error.path.endsWith("/shape")
        ? `Expected one of ${SHAPES.join(", ")}`
        : "Expected a string, a number or a boolean";
    } else if (error.type === ValueErrorType.ObjectAdditionalProperties) {
      message = "Unexpected property";
    } else if (error.type === ValueErrorType.StringFormat) {
      message = `Expected a valid ${String((error.schema as { format?: string }).format)} string`;
    }
    errors.push({ path: error.path, message });
  }
  return errors;
}

function checkUnique(
  items: readonly { id?: string }[],
  collection: string,
  label: string,
  errors: ValidationError[],
): Set<string> {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (item.id === undefined) return;
    if (seen.has(item.id)) {
      errors.push({
        path: `/${collection}/${index}/id`,
        message: `Duplicate ${label} id "${item.id}"`,
      });
    }
    seen.add(item.id);
  });
  return seen;
}

function semanticGraphErrors(doc: GraphDocument): ValidationError[] {
  const errors: ValidationError[] = [];
  const nodeIds = checkUnique(doc.nodes, "nodes", "node", errors);
  const groups = doc.groups ?? [];
  const groupIds = checkUnique(groups, "groups", "group", errors);
  const edges = doc.edges ?? [];
  checkUnique(edges, "edges", "edge", errors);

  edges.forEach((edge, index) => {
    if (!nodeIds.has(edge.from)) {
      errors.push({
        path: `/edges/${index}/from`,
        message: `Edge source "${edge.from}" is not a known node id`,
      });
    }
    if (!nodeIds.has(edge.to)) {
      errors.push({
        path: `/edges/${index}/to`,
        message: `Edge target "${edge.to}" is not a known node id`,
      });
    }
  });

  doc.nodes.forEach((node, index) => {
    if (node.group !== undefined && !groupIds.has(node.group)) {
      errors.push({
        path: `/nodes/${index}/group`,
        message: `Group "${node.group}" is not a known group id`,
      });
    }
  });

  groups.forEach((group, index) => {
    if (group.parent !== undefined && !groupIds.has(group.parent)) {
      errors.push({
        path: `/groups/${index}/parent`,
        message: `Parent group "${group.parent}" is not a known group id`,
      });
    }
  });

  const parentOf = new Map<string, string>();
  for (const group of groups) {
    if (group.parent !== undefined && groupIds.has(group.parent)) {
      parentOf.set(group.id, group.parent);
    }
  }
  const reported = new Set<string>();
  groups.forEach((group, index) => {
    const path: string[] = [];
    let current: string | undefined = group.id;
    while (current !== undefined) {
      const at = path.indexOf(current);
      if (at !== -1) {
        const cycle = path.slice(at);
        if (cycle.includes(group.id) && !reported.has(group.id)) {
          for (const id of cycle) reported.add(id);
          errors.push({
            path: `/groups/${index}/parent`,
            message: `Group parent cycle: ${[...cycle, current].join(" -> ")}`,
          });
        }
        break;
      }
      path.push(current);
      current = parentOf.get(current);
    }
  });

  return errors;
}

function semanticSequenceErrors(doc: SequenceDocument): ValidationError[] {
  const errors: ValidationError[] = [];
  const ids = checkUnique(
    doc.participants,
    "participants",
    "participant",
    errors,
  );
  doc.messages.forEach((message, index) => {
    if (!ids.has(message.from)) {
      errors.push({
        path: `/messages/${index}/from`,
        message: `Message sender "${message.from}" is not a known participant id`,
      });
    }
    if (!ids.has(message.to)) {
      errors.push({
        path: `/messages/${index}/to`,
        message: `Message recipient "${message.to}" is not a known participant id`,
      });
    }
  });
  return errors;
}

export function validate(input: unknown): ValidationResult {
  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [{ path: "", message: "Expected a JSON object" }],
    };
  }

  const { kind } = input;
  if (kind !== "graph" && kind !== "sequence") {
    const errors: ValidationError[] = [
      {
        path: "/kind",
        message:
          kind === undefined
            ? 'Missing kind: expected "graph" or "sequence"'
            : `Unknown kind ${JSON.stringify(kind)}: expected "graph" or "sequence"`,
      },
    ];
    if (input.version !== FORMAT_VERSION) {
      errors.push({ path: "/version", message: VERSION_MESSAGE });
    }
    return { ok: false, errors };
  }

  const schema =
    kind === "graph" ? GraphDocumentSchema : SequenceDocumentSchema;
  const structural = structuralErrors(schema, input);
  if (structural.length > 0) return { ok: false, errors: structural };

  const semantic =
    kind === "graph"
      ? semanticGraphErrors(input as GraphDocument)
      : semanticSequenceErrors(input as SequenceDocument);
  if (semantic.length > 0) return { ok: false, errors: semantic };

  return { ok: true, document: input as Document };
}
