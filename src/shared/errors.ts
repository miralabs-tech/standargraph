export function formatErrors(
  errors: readonly { path: string; message: string }[],
): string {
  return errors
    .map((error) => `${error.path === "" ? "/" : error.path}: ${error.message}`)
    .join("\n");
}
