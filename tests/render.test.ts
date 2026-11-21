import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { layout } from "../src/layout";
import { renderSvg } from "../src/svg";
import { typeHash } from "../src/svg/theme";

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
  for (const name of ["architecture", "protocol", "agent-output", "order-state", "shop-er", "roadmap-mindmap", "repo-tree"]) {
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

describe("edge presentation", () => {
  const typed = {
    version: 1,
    kind: "graph",
    nodes: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
    edges: [
      { id: "t", from: "a", to: "b", type: "calls" },
      { id: "u", from: "b", to: "c" },
      { id: "s", from: "c", to: "d", type: "plain" },
    ],
  };

  function part(svg: string, id: string): string {
    const start = svg.indexOf(`data-kind="edge" data-id="${id}"`);
    expect(start).toBeGreaterThan(-1);
    return svg.slice(start, svg.indexOf("</g>", start));
  }

  test("a typed edge carries the stroke attribute, an untyped one the default", async () => {
    const svg = await render(typed, {
      theme: { edgeTypes: { calls: { stroke: "#123456" } } },
    });
    assertWellFormed(svg);
    expect(part(svg, "t")).toContain('stroke="#123456"');
    expect(part(svg, "u")).toContain('stroke="#475569"');
  });

  test("a palette stroke is carried by the attribute", async () => {
    const svg = await render(typed);
    expect(part(svg, "t")).not.toContain('stroke="#475569"');
  });

  test("the dash comes from the type, confidence wins", async () => {
    const theme = {
      edgeTypes: { calls: { dash: "dashed" as const }, plain: { dash: "solid" as const } },
    };
    const svg = await render(typed, { theme });
    expect(part(svg, "t")).toContain('stroke-dasharray="6 4"');
    expect(part(svg, "s")).not.toContain("stroke-dasharray");
    const unknown = {
      ...typed,
      edges: [
        { id: "t", from: "a", to: "b", type: "calls", meta: { provenance: { source: "s", confidence: "unknown" } } },
      ],
    };
    expect(part(await render(unknown, { theme }), "t")).toContain('stroke-dasharray="2 3"');
  });

  test("the type text color is a fill attribute on the label", async () => {
    const doc = {
      ...typed,
      edges: [{ id: "t", from: "a", to: "b", type: "calls", label: "go" }],
    };
    const svg = await render(doc, { theme: { edgeTypes: { calls: { text: "#abcdef" } } } });
    expect(part(svg, "t")).toContain('fill="#abcdef">go</text>');
  });

  test("the stroke width follows the weight", async () => {
    const doc = {
      ...typed,
      edges: [
        { id: "t", from: "a", to: "b", weight: 1 },
        { id: "u", from: "b", to: "c", weight: 8 },
        { id: "s", from: "c", to: "d" },
      ],
    };
    const svg = await render(doc);
    expect(part(svg, "t")).toContain('stroke-width="1.5"');
    expect(part(svg, "u")).toContain('stroke-width="6"');
    expect(part(svg, "s")).toContain('stroke-width="1.5"');
    const equal = await render({
      ...doc,
      edges: doc.edges.map((edge) => ({ ...edge, weight: 3 })),
    });
    for (const id of ["t", "u", "s"]) expect(part(equal, id)).toContain('stroke-width="1.5"');
  });

  test("a safe link wraps the edge, an unsafe one does not", async () => {
    const doc = {
      ...typed,
      edges: [
        { id: "t", from: "a", to: "b", link: "https://x" },
        { id: "u", from: "b", to: "c", link: "javascript:alert(1)" },
      ],
    };
    const svg = await render(doc);
    assertWellFormed(svg);
    expect(svg).toContain('<a href="https://x"><g data-kind="edge" data-id="t"');
    expect(svg).not.toContain("javascript:");
  });

  test("the description leads the title, before the meta lines", async () => {
    const doc = {
      version: 1,
      kind: "graph",
      nodes: [
        { id: "a", description: "Node text", meta: { freshness: "2026-01-01T00:00:00Z" } },
        { id: "b" },
      ],
      edges: [{ id: "t", from: "a", to: "b", description: "Edge <text>" }],
    };
    const svg = await render(doc);
    assertWellFormed(svg);
    expect(part(svg, "t")).toContain("<title>Edge &lt;text&gt;</title>");
    expect(svg).toContain("<title>Node text\nFreshness: 2026-01-01T00:00:00Z</title>");
    expect(svg.match(/<title>/g)).toHaveLength(2);
  });

  test("a typed directed edge has its own arrow marker", async () => {
    const theme = { edgeTypes: { calls: { stroke: "#123456" } } };
    const svg = await render(typed, { theme });
    const key = typeHash("calls").toString(36);
    expect(part(svg, "t")).toContain(`marker-end="url(#sg-arrow-filled-t${key})"`);
    expect(part(svg, "u")).toContain('marker-end="url(#sg-arrow-filled)"');
    expect(svg).toContain(`<marker id="sg-arrow-filled-t${key}"`);
    expect(svg).toContain(
      `<path class="sg-arrow-filled sg-arrow-t${key}" d="M0,0 L10,5 L0,10 z" fill="#123456" stroke="#123456"`,
    );
    expect(svg).toContain(`.sg-arrow-t${key}{fill:#123456;stroke:#123456}`);
    const prefixed = await render(typed, { theme, idPrefix: "x" });
    expect(prefixed).toContain(`<marker id="x-arrow-filled-t${key}"`);
    expect(prefixed).toContain(`marker-end="url(#x-arrow-filled-t${key})"`);
    expect(prefixed).not.toContain("sg-arrow-filled-t");
  });
});
