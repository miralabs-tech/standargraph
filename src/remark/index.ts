import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Html, Parent, Root, RootContent } from "mdast";
import { validate } from "../format";
import { renderHtml } from "../html/render";
import { layout } from "../layout";
import { formatErrors } from "../shared/errors";
import { renderSvg } from "../svg/render";

export { VERSION } from "../version";

export type RemarkStandargraphOptions = {
  outDir?: string;
  publicPath?: string;
  theme?: "light" | "dark" | "auto";
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type Converted = { node: Html; failed: boolean };

function failure(message: string): Converted {
  return {
    failed: true,
    node: {
      type: "html",
      value: `<pre class="standargraph-error">${escapeHtml(message)}</pre>`,
    },
  };
}

async function convert(
  source: string,
  options: RemarkStandargraphOptions,
): Promise<Converted> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return failure(`Invalid JSON: ${reason}`);
  }
  const result = validate(parsed);
  if (!result.ok) {
    return failure(`Invalid document:\n${formatErrors(result.errors)}`);
  }
  try {
    const laidOut = await layout(result.document);
    const hash = createHash("sha256").update(source).digest("hex").slice(0, 12);
    const svg = renderSvg(laidOut, {
      theme: options.theme === "dark" ? "dark" : "light",
      standalone: false,
      idPrefix: `sg${hash}`,
    }).trim();
    let content = svg;
    if (options.outDir !== undefined) {
      mkdirSync(options.outDir, { recursive: true });
      writeFileSync(
        join(options.outDir, `${hash}.html`),
        renderHtml(result.document, laidOut, { theme: options.theme }),
      );
      const prefix =
        options.publicPath === undefined
          ? ""
          : `${options.publicPath.replace(/\/+$/, "")}/`;
      content = `<a href="${escapeHtml(`${prefix}${hash}.html`)}">${svg}</a>`;
    }
    return {
      failed: false,
      node: {
        type: "html",
        value: `<figure class="standargraph">${content}</figure>`,
      },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return failure(`Cannot render the diagram: ${reason}`);
  }
}

async function walk(
  parent: Parent,
  options: RemarkStandargraphOptions,
): Promise<void> {
  const children: RootContent[] = [];
  for (const child of parent.children as RootContent[]) {
    if (child.type === "code" && child.lang === "standargraph") {
      const converted = await convert(child.value, options);
      if (converted.failed) children.push(child);
      children.push(converted.node);
      continue;
    }
    if ("children" in child) {
      await walk(child as Parent, options);
    }
    children.push(child);
  }
  parent.children = children as Parent["children"];
}

export function remarkStandargraph(
  options: RemarkStandargraphOptions = {},
) {
  return async (tree: Root): Promise<void> => {
    await walk(tree, options);
  };
}
