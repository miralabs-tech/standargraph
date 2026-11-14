import { FormatRegistry, type Static, type TSchema } from "@sinclair/typebox";
import { Value, ValueErrorType } from "@sinclair/typebox/value";
import {
  CARDINALITIES,
  FORMAT_VERSION,
  KEYS,
  PSEUDO,
  SHAPES,
  type Document,
  ErDocumentSchema,
  GraphDocumentSchema,
  SequenceDocumentSchema,
  StateDocumentSchema,
} from "./schema";
import { semanticErErrors } from "./semantic/er";
import { semanticGraphErrors } from "./semantic/graph";
import { semanticSequenceErrors } from "./semantic/sequence";
import { semanticStateErrors } from "./semantic/state";
import type { ValidationError } from "./semantic/shared";

export type { ValidationError };

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

type KindHandler = {
  schema: TSchema;
  semantic: (document: unknown) => ValidationError[];
};

function handler<S extends TSchema>(
  schema: S,
  semantic: (document: Static<S>) => ValidationError[],
): KindHandler {
  return { schema, semantic: semantic as (document: unknown) => ValidationError[] };
}

const KINDS: Readonly<Record<string, KindHandler>> = {
  graph: handler(GraphDocumentSchema, semanticGraphErrors),
  sequence: handler(SequenceDocumentSchema, semanticSequenceErrors),
  state: handler(StateDocumentSchema, semanticStateErrors),
  er: handler(ErDocumentSchema, semanticErErrors),
};

const KIND_NAMES = Object.keys(KINDS)
  .map((name) => JSON.stringify(name))
  .join(", ");

function structuralErrors(
  schema: TSchema,
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
        : error.path.endsWith("/pseudo")
          ? `Expected one of ${PSEUDO.join(", ")}`
          : error.path.endsWith("Cardinality")
            ? `Expected one of ${CARDINALITIES.join(", ")}`
            : /\/keys\/\d+$/.test(error.path)
              ? `Expected one of ${KEYS.join(", ")}`
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

export function validate(input: unknown): ValidationResult {
  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [{ path: "", message: "Expected a JSON object" }],
    };
  }

  const { kind } = input;
  const entry =
    typeof kind === "string" && Object.hasOwn(KINDS, kind) ? KINDS[kind] : undefined;
  if (entry === undefined) {
    const errors: ValidationError[] = [
      {
        path: "/kind",
        message:
          kind === undefined
            ? `Missing kind: expected one of ${KIND_NAMES}`
            : `Unknown kind ${JSON.stringify(kind)}: expected one of ${KIND_NAMES}`,
      },
    ];
    if (input.version !== FORMAT_VERSION) {
      errors.push({ path: "/version", message: VERSION_MESSAGE });
    }
    return { ok: false, errors };
  }

  const structural = structuralErrors(entry.schema, input);
  if (structural.length > 0) return { ok: false, errors: structural };

  const semantic = entry.semantic(input);
  if (semantic.length > 0) return { ok: false, errors: semantic };

  return { ok: true, document: input as Document };
}
