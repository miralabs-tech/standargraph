#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validate } from "./format/validate";
import { VERSION } from "./version";

const USAGE = `Usage: standargraph <command> [options]

Commands:
  validate <file>    Validate a graph document (JSON) against format v1
  export             Export a graph to SVG (not implemented yet)

Options:
  -v, --version    Print the version
  -h, --help       Show this help
`;

function runValidate(file: string | undefined): number {
  if (file === undefined) {
    process.stderr.write("Usage: standargraph validate <file>\n");
    return 2;
  }
  let input: unknown;
  try {
    input = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Cannot read ${file}: ${reason}\n`);
    return 2;
  }
  const result = validate(input);
  if (result.ok) {
    process.stdout.write(`valid: ${file}\n`);
    return 0;
  }
  for (const error of result.errors) {
    process.stderr.write(`${error.path}: ${error.message}\n`);
  }
  return 1;
}

export function run(argv: string[]): number {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }
  if (command === "--version" || command === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (command === "validate") {
    return runValidate(rest[0]);
  }
  process.stderr.write(`Unknown command: ${command}\n`);
  return 1;
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  process.exitCode = run(process.argv.slice(2));
}
