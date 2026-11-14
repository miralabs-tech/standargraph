import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { layout } from "../src/layout";
import { renderSvg } from "../src/svg";

function example(name: string): Record<string, any> {
  return JSON.parse(
    readFileSync(new URL(`../examples/${name}.json`, import.meta.url), "utf8"),
  );
}

function assertWellFormed(svg: string): void {
  const withoutDeclaration = svg.replace(/^<\?xml[^>]*\?>\s*/, "");
  const stack: string[] = [];
  const tag = /<(\/?)([A-Za-z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let cursor = 0;
  let roots = 0;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(withoutDeclaration)) !== null) {
    const between = withoutDeclaration.slice(cursor, match.index);
    expect(between).not.toContain("<");
    expect(between.replace(/&(amp|lt|gt|quot|apos|#\d+);/g, "")).not.toContain("&");
    cursor = match.index + match[0].length;
    const [, closing, name, attributes, selfClosing] = match;
    expect(attributes!.replace(/"[^"]*"|'[^']*'/g, "")).not.toContain("<");
    if (closing === "/") {
      expect(stack.pop()).toBe(name!);
    } else if (selfClosing !== "/") {
      if (stack.length === 0) roots++;
      stack.push(name!);
    } else if (stack.length === 0) {
      roots++;
    }
  }
  expect(withoutDeclaration.slice(cursor).trim()).toBe("");
  expect(stack).toEqual([]);
  expect(roots).toBe(1);
}

async function render(doc: unknown, options?: Parameters<typeof renderSvg>[1]) {
  return renderSvg(await layout(doc), options);
}

describe("snapshots", () => {
  for (const name of ["architecture", "protocol", "agent-output", "order-state", "shop-er"]) {
    test(`${name} in the light theme`, async () => {
      const svg = await render(example(name));
      assertWellFormed(svg);
      expect(svg).toMatchSnapshot();
    });
  }

  test("protocol in the dark theme", async () => {
    const svg = await render(example("protocol"), { theme: "dark" });
    assertWellFormed(svg);
    expect(svg).toContain("--sg-bg:#0f172a");
    expect(svg).toMatchSnapshot();
  });
});

describe("structure", () => {
  test("standalone output carries the namespace and a viewBox", async () => {
    const svg = await render(example("architecture"));
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toMatch(/viewBox="0 0 [\d.]+ [\d.]+"/);
    expect(svg).toContain('font-family="Inter, system-ui, sans-serif"');
    expect(svg).toContain("<style>");
  });

  test("inline output drops the declaration and the namespace", async () => {
    const svg = await render(example("architecture"), { standalone: false });
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg).not.toContain("xmlns");
    assertWellFormed(svg);
  });

  test("rendering is deterministic", async () => {
    const first = await render(example("agent-output"));
    const second = await render(example("agent-output"));
    expect(second).toBe(first);
  });

  test("every element carries data-id and data-kind", async () => {
    const svg = await render(example("architecture"));
    const kinds = [...svg.matchAll(/data-kind="(\w+)"/g)].map((m) => m[1]);
    expect(kinds.filter((kind) => kind === "node").length).toBe(8);
    expect(kinds.filter((kind) => kind === "group").length).toBe(3);
    expect(kinds.filter((kind) => kind === "edge").length).toBe(
      example("architecture").edges.length,
    );
    expect(svg).toContain('data-id="GeneralSettings"');
    const sequence = await render(example("protocol"));
    expect(sequence).toContain('data-kind="participant"');
    expect(sequence).toContain('data-kind="message"');
  });

  test("message styles map to arrowheads and dashes", async () => {
    const svg = await render({
      version: 1,
      kind: "sequence",
      participants: [{ id: "a" }, { id: "b" }],
      messages: [
        { from: "a", to: "b", style: "sync" },
        { from: "a", to: "b", style: "async" },
        { from: "b", to: "a", style: "reply" },
        { from: "a", to: "a" },
      ],
    });
    assertWellFormed(svg);
    const messages = svg.split('data-kind="message"').slice(1);
    expect(messages[0]).toContain("url(#sg-arrow-filled)");
    expect(messages[0]).not.toContain("stroke-dasharray");
    expect(messages[1]).toContain("url(#sg-arrow-open)");
    expect(messages[1]).not.toContain("stroke-dasharray");
    expect(messages[2]).toContain("url(#sg-arrow-open)");
    expect(messages[2]).toContain('stroke-dasharray="5 3"');
    expect(messages[3]).toContain(" H");
  });
});

describe("escaping", () => {
  test("special characters are escaped everywhere", async () => {
    const hostile = `<&"'>`;
    const escaped = "&lt;&amp;&quot;&apos;&gt;";
    const svg = await render({
      version: 1,
      kind: "graph",
      title: hostile,
      groups: [{ id: `g${hostile}`, label: hostile }],
      nodes: [
        {
          id: `a${hostile}`,
          label: hostile,
          type: hostile,
          group: `g${hostile}`,
          link: `https://example.com/?a=1&b=${hostile}`,
          meta: { provenance: { source: hostile, tool: hostile } },
        },
        { id: "b", label: hostile },
      ],
      edges: [{ from: `a${hostile}`, to: "b", label: hostile }],
    });
    assertWellFormed(svg);
    expect(svg).toContain(escaped);
    expect(svg).not.toContain(hostile);
    expect(svg).toContain(`data-id="a${escaped}"`);
    expect(svg).toContain(`href="https://example.com/?a=1&amp;b=${escaped}"`);
  });

  test("sequence labels are escaped", async () => {
    const svg = await render({
      version: 1,
      kind: "sequence",
      participants: [{ id: "a", label: "<A>" }, { id: "b", label: "B&B" }],
      messages: [{ from: "a", to: "b", label: `x<y && "z"` }],
    });
    assertWellFormed(svg);
    expect(svg).toContain("&lt;A&gt;");
    expect(svg).toContain("B&amp;B");
    expect(svg).toContain("x&lt;y &amp;&amp; &quot;z&quot;");
  });

  test("control characters that XML forbids are dropped", async () => {
    const svg = await render({
      version: 1,
      kind: "graph",
      nodes: [{ id: "a", label: "bad\u0001label" }],
    });
    assertWellFormed(svg);
    expect(svg).not.toContain("\u0001");
    expect(svg).toContain("badlabel");
  });
});

describe("metadata", () => {
  const doc = {
    version: 1,
    kind: "graph",
    groups: [{ id: "g", label: "G", meta: { provenance: { source: "s", confidence: "inferred" } } }],
    nodes: [
      { id: "ok", group: "g", meta: { provenance: { source: "s", confidence: "confirmed" }, coverage: 0.5 } },
      { id: "inf", meta: { provenance: { source: "s", confidence: "inferred" } } },
      { id: "unk", meta: { provenance: { source: "s", confidence: "unknown" }, freshness: "2026-01-01T00:00:00Z" } },
      { id: "plain" },
    ],
    edges: [
      { from: "ok", to: "inf", meta: { provenance: { source: "s", confidence: "inferred" } } },
      { from: "inf", to: "unk", meta: { provenance: { source: "s", confidence: "unknown" } } },
      { from: "unk", to: "plain" },
    ],
  };

  function section(svg: string, kind: string, id: string): string {
    const start = svg.indexOf(`data-kind="${kind}" data-id="${id}"`);
    expect(start).toBeGreaterThan(-1);
    return svg.slice(start, svg.indexOf("</g>", start));
  }

  test("confidence selects the border style", async () => {
    const svg = await render(doc);
    assertWellFormed(svg);
    expect(section(svg, "node", "ok")).not.toContain("stroke-dasharray");
    expect(section(svg, "node", "inf")).toContain('stroke-dasharray="6 4"');
    expect(section(svg, "node", "unk")).toContain('stroke-dasharray="2 3"');
    expect(section(svg, "node", "unk")).toContain("sg-unknown");
    expect(section(svg, "node", "unk")).toContain('fill="#f1f5f9"');
    expect(section(svg, "node", "plain")).not.toContain("stroke-dasharray");
    expect(section(svg, "group", "g")).toContain('stroke-dasharray="6 4"');
    expect(section(svg, "edge", "e0")).toContain('stroke-dasharray="6 4"');
    expect(section(svg, "edge", "e1")).toContain('stroke-dasharray="2 3"');
    expect(section(svg, "edge", "e2")).not.toContain("stroke-dasharray");
  });

  test("coverage draws a proportional bar", async () => {
    const laid = await layout(doc);
    if (laid.kind !== "graph") throw new Error("expected a graph");
    const node = laid.nodes.find((candidate) => candidate.id === "ok")!;
    const svg = renderSvg(laid);
    expect(svg).toContain(`class="sg-accent"`);
    expect(svg).toContain(`width="${node.width * 0.5}" height="4"`);
    expect(svg.split('class="sg-accent"').length - 1).toBe(1);
  });

  test("meta is summarised in a title", async () => {
    const svg = await render(doc);
    expect(section(svg, "node", "ok")).toContain("<title>Source: s (confirmed)\nCoverage: 50%</title>");
    expect(section(svg, "node", "unk")).toContain("Freshness: 2026-01-01T00:00:00Z");
    expect(section(svg, "node", "plain")).not.toContain("<title>");
  });

  test("a link wraps the node in an anchor", async () => {
    const svg = await render({
      version: 1,
      kind: "graph",
      nodes: [
        { id: "a", link: "https://example.com/a" },
        { id: "b", link: "javascript:alert(1)" },
        { id: "c" },
      ],
    });
    assertWellFormed(svg);
    expect(svg).toContain('<a href="https://example.com/a"><g data-kind="node" data-id="a" data-shape="box">');
    expect(svg.split("<a ").length - 1).toBe(1);
    expect(svg).not.toContain("javascript:");
  });
});
