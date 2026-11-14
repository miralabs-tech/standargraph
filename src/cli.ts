#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { VERSION } from "./version";

const USAGE = `Usage: standargraph <command> [options]

Commands:
  export    Export a graph to SVG (not implemented yet)

Options:
  -v, --version    Print the version
  -h, --help       Show this help
`;

export function run(argv: string[]): number {
  const [command] = argv;
  if (command === undefined || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }
  if (command === "--version" || command === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
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
