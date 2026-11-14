import type { LoadError } from "../text";

export function formatErrors(
  errors: readonly { path: string; message: string }[],
): string {
  return errors
    .map((error) => `${error.path === "" ? "/" : error.path}: ${error.message}`)
    .join("\n");
}

export function formatLoadErrors(errors: readonly LoadError[], file?: string): string {
  return errors
    .map((error) => {
      if (error.line !== undefined) {
        const where = `${file === undefined ? "" : `${file}:`}${error.line}:${error.column ?? 1}`;
        return `${where}: ${error.message}${error.code === undefined ? "" : ` [${error.code}]`}`;
      }
      if (error.path !== undefined) {
        return `${error.path === "" ? "/" : error.path}: ${error.message}`;
      }
      return error.message;
    })
    .join("\n");
}
