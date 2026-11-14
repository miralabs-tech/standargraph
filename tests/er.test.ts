import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createView, HOVERABLE, sceneItemCount } from "../src/core/view";
import { validate } from "../src/format";
import { layout } from "../src/layout";
import { ER_ROW_HEIGHT } from "../src/layout/shared";
import type { LaidOutEr } from "../src/layout/types";
import { renderSvg } from "../src/svg";

function example(): Record<string, any> {
  return JSON.parse(readFileSync(new URL("../examples/shop-er.json", import.meta.url), "utf8"));
}

function small(): Record<string, any> {
  return {
    version: 1,
    kind: "er",
    entities: [
      { id: "a", attributes: [{ name: "id", keys: ["pk"] }, { name: "b_id", keys: ["fk"] }] },
      { id: "b" },
    ],
    relations: [{ from: "a", to: "b" }],
  };
}

function errorsOf(input: unknown): { path: string; message: string }[] {
  const result = validate(input);
  if (result.ok) throw new Error("expected validation to fail");
  return result.errors;
}

async function sceneOf(input: unknown): Promise<LaidOutEr> {
  const scene = await layout(input);
  if (scene.kind !== "er") throw new Error("expected an ER diagram");
  return scene;
}

function relationBlock(svg: string, id: string): string {
  return svg.split(`data-kind="relation" data-id="${id}"`)[1]!.split("</g>")[0]!;
}

describe("validation", () => {
  test("the example and a small diagram are valid", () => {
    expect(validate(example()).ok).toBe(true);
    expect(validate(small()).ok).toBe(true);
  });

  test("an ER document needs at least one entity", () => {
    const doc = small();
    doc.entities = [];
    expect(errorsOf(doc).map((error) => error.path)).toEqual(["/entities"]);
  });

  test("duplicate ids", () => {
    const doc = small();
    doc.entities.push({ id: "a" });
    doc.relations[0].id = "x";
    doc.relations.push({ id: "x", from: "a", to: "b" });
    expect(errorsOf(doc)).toEqual([
      { path: "/entities/2/id", message: 'Duplicate entity id "a"' },
      { path: "/relations/1/id", message: 'Duplicate relation id "x"' },
    ]);
  });

  test("unknown relation ends", () => {
    const doc = small();
    doc.relations.push({ from: "ghost", to: "a" }, { from: "a", to: "phantom" });
    expect(errorsOf(doc)).toEqual([
      { path: "/relations/1/from", message: 'Relation source "ghost" is not a known entity id' },
      { path: "/relations/2/to", message: 'Relation target "phantom" is not a known entity id' },
    ]);
  });

  test("duplicate attributes and keys", () => {
    const doc = small();
    doc.entities[0].attributes.push({ name: "id" }, { name: "x", keys: ["pk", "fk", "pk"] });
    expect(errorsOf(doc)).toEqual([
      { path: "/entities/0/attributes/2/name", message: 'Duplicate attribute "id" in entity "a"' },
      { path: "/entities/0/attributes/3/keys/2", message: 'Duplicate key "pk"' },
    ]);
  });

  test("an unknown key or cardinality names the allowed values", () => {
    const doc = small();
    doc.entities[0].attributes[0].keys = ["primary"];
    doc.relations[0].fromCardinality = "many";
    expect(errorsOf(doc)).toEqual([
      { path: "/entities/0/attributes/0/keys/0", message: "Expected one of pk, fk, uk" },
      {
        path: "/relations/0/fromCardinality",
        message: "Expected one of one, zero-or-one, one-or-more, zero-or-more",
      },
    ]);
  });

  test("attributes accept no meta", () => {
    const doc = small();
    doc.entities[0].attributes[0].meta = { coverage: 1 };
    expect(errorsOf(doc)).toEqual([
      { path: "/entities/0/attributes/0/meta", message: "Unexpected property" },
    ]);
  });

  test("an unknown kind lists the er kind", () => {
    expect(errorsOf({ version: 1, kind: "pie" })[0]!.message).toContain('"er"');
  });
});

describe("layout", () => {
  test("every entity has a box and every relation a route", async () => {
    const scene = await sceneOf(example());
    expect(scene.entities.map((entity) => entity.id)).toEqual([
      "customer",
      "order",
      "order_item",
      "product",
    ]);
    expect(scene.relations.map((relation) => relation.id)).toEqual(["r0", "r1", "r2"]);
    for (const relation of scene.relations) {
      expect(relation.points.length).toBeGreaterThanOrEqual(2);
      expect(relation.labelBox).toBeDefined();
    }
    for (const entity of scene.entities) {
      expect(entity.x + entity.width).toBeLessThanOrEqual(scene.width + 0.01);
      expect(entity.y + entity.height).toBeLessThanOrEqual(scene.height + 0.01);
    }
  });

  test("entity sizes follow the header, the rows and the columns", async () => {
    const scene = await sceneOf(example());
    const byId = new Map(scene.entities.map((entity) => [entity.id, entity]));
    const customer = byId.get("customer")!;
    expect(customer.headerHeight).toBe(40);
    expect(byId.get("product")!.headerHeight).toBe(54);
    expect(ER_ROW_HEIGHT).toBe(21);
    expect(customer.height).toBe(40 + 3 * ER_ROW_HEIGHT + 6);
    expect(customer.width).toBeGreaterThanOrEqual(120);
    expect(customer.columns.key).toBe(12);
    expect(customer.columns.name).toBeGreaterThan(customer.columns.key);
    expect(customer.columns.type).toBeGreaterThan(customer.columns.name);
    expect(customer.columns.type).toBeLessThan(customer.width);
    const rows = customer.attributes.map((attribute) => attribute.y);
    expect(rows[0]).toBe(customer.y + 40 + 3);
    expect(rows[1]! - rows[0]!).toBe(ER_ROW_HEIGHT);
    expect(customer.attributes[0]).toMatchObject({ name: "id", type: "uuid", keys: ["pk"] });
  });

  test("an entity without attributes is only a header", async () => {
    const scene = await sceneOf(small());
    const bare = scene.entities.find((entity) => entity.id === "b")!;
    expect(bare.attributes).toEqual([]);
    expect(bare.height).toBe(bare.headerHeight);
    expect(bare.width).toBe(120);
  });

  test("the key column is absent without keys and the nullable mark is kept", async () => {
    const doc = small();
    doc.entities[0].attributes = [{ name: "plain" }];
    const plain = (await sceneOf(doc)).entities[0]!;
    expect(plain.columns.name).toBe(plain.columns.key);
    const nullableDoc = small();
    nullableDoc.entities[0].attributes = [{ name: "x", type: "text", nullable: true }];
    const nullable = (await sceneOf(nullableDoc)).entities[0]!;
    expect(nullable.attributes[0]!.nullable).toBe(true);
  });

  test("relations carry their defaults and cardinalities", async () => {
    const scene = await sceneOf(example());
    expect(scene.relations[0]).toMatchObject({
      from: "customer",
      to: "order",
      label: "places",
      fromCardinality: "one",
      toCardinality: "zero-or-more",
      identifying: false,
    });
    const bare = (await sceneOf(small())).relations[0]!;
    expect(bare.identifying).toBe(true);
    expect(bare.fromCardinality).toBeUndefined();
    expect(bare.label).toBeUndefined();
    expect(bare.labelBox).toBeUndefined();
  });

  test("a custom relation id is kept and a self relation is routed", async () => {
    const doc = small();
    doc.relations = [{ id: "parent", from: "a", to: "a", label: "parent of" }];
    const scene = await sceneOf(doc);
    expect(scene.relations[0]!.id).toBe("parent");
    expect(scene.relations[0]!.points.length).toBeGreaterThanOrEqual(2);
  });

  test("metadata, type, link and description travel to the scene", async () => {
    const doc = small();
    doc.entities[1] = {
      id: "b",
      label: "B",
      type: "catalog",
      description: "d",
      link: "https://example.com",
      meta: { coverage: 0.5 },
    };
    const entity = (await sceneOf(doc)).entities[1]!;
    expect(entity).toMatchObject({
      label: "B",
      type: "catalog",
      description: "d",
      link: "https://example.com",
      meta: { coverage: 0.5 },
    });
  });

  test("the layout is deterministic and the direction changes the shape", async () => {
    expect(await sceneOf(example())).toEqual(await sceneOf(example()));
    const right = example();
    right.direction = "right";
    const down = await sceneOf(example());
    const across = await sceneOf(right);
    expect(across.width).toBeGreaterThan(across.height);
    expect(down.height).toBeGreaterThan(across.height);
  });

  test("an invalid ER document is rejected", async () => {
    const doc = small();
    doc.relations[0].to = "ghost";
    await expect(layout(doc)).rejects.toThrow("/relations/0/to");
  });
});

describe("svg", () => {
  async function svgOf(input: unknown, options?: Parameters<typeof renderSvg>[1]) {
    return renderSvg(await layout(input), options);
  }

  test("the root tells the diagram kind and items carry data attributes", async () => {
    const svg = await svgOf(example());
    expect(svg).toContain('data-diagram="er"');
    expect(svg).toContain('<g data-kind="entity" data-id="customer">');
    expect(svg).toContain('<g data-kind="entity" data-id="product" data-type="catalog">');
    expect(svg).toContain(
      '<g data-kind="relation" data-id="r0" data-from="customer" data-to="order" data-from-cardinality="one" data-to-cardinality="zero-or-more" data-identifying="false">',
    );
  });

  test("relations come first, then the entities", async () => {
    const svg = await svgOf(example());
    const order = [...svg.matchAll(/data-kind="(entity|relation)" data-id="([^"]+)"/g)].map(
      (match) => `${match[1]}:${match[2]}`,
    );
    expect(order).toEqual([
      "relation:r0",
      "relation:r1",
      "relation:r2",
      "entity:customer",
      "entity:order",
      "entity:order_item",
      "entity:product",
    ]);
  });

  test("attribute rows carry their name, keys, type and note", async () => {
    const svg = await svgOf(example());
    expect(svg).toContain('<g class="sg-attr" data-attr="id" data-keys="pk">');
    expect(svg).toContain('<g class="sg-attr" data-attr="order_id" data-keys="pk fk">');
    expect(svg).toContain('<g class="sg-attr" data-attr="name">');
    expect(svg).toContain("<title>free text from checkout</title>");
    expect(svg).toMatch(/class="sg-muted sg-attr-key"[^>]*>PK, FK<\/text>/);
    expect(svg).toMatch(/class="sg-muted sg-attr-type"[^>]*>text\?<\/text>/);
    expect(svg).toMatch(/class="sg-muted sg-attr-type"[^>]*>decimal\(10,2\)<\/text>/);
  });

  test("the header band is clipped by the frame", async () => {
    const svg = await svgOf(example());
    expect(svg).toMatch(/<clipPath id="sg-clip-0"><rect [^>]*rx="4"\/><\/clipPath>/);
    expect(svg).toMatch(/<rect class="sg-node" [^>]*rx="4"/);
    expect(svg).toMatch(/<rect class="sg-header" [^>]*clip-path="url\(#sg-clip-0\)"\/>/);
  });

  test("crow's feet are explicit paths without markers", async () => {
    const svg = await svgOf(example());
    const relation = relationBlock(svg, "r1");
    expect(relation).not.toContain("marker-end");
    const lines = [...relation.matchAll(/ d="(M[^"]*)"/g)].map((match) => match[1]!);
    expect(lines).toHaveLength(5);
    expect(lines.filter((line) => (line.match(/M/g) ?? []).length === 3)).toHaveLength(1);
  });

  test("cardinality marks follow the table", async () => {
    const marks = async (from?: string, to?: string) => {
      const doc = small();
      doc.relations[0] = { from: "a", to: "b", fromCardinality: from, toCardinality: to };
      const relation = relationBlock(await svgOf(doc), "r0");
      return {
        paths: (relation.match(/stroke-linecap="round"/g) ?? []).length,
        circles: (relation.match(/<circle /g) ?? []).length,
      };
    };
    expect(await marks()).toEqual({ paths: 0, circles: 0 });
    expect(await marks("one")).toEqual({ paths: 2, circles: 0 });
    expect(await marks("zero-or-one")).toEqual({ paths: 1, circles: 1 });
    expect(await marks("one-or-more")).toEqual({ paths: 2, circles: 0 });
    expect(await marks("zero-or-more")).toEqual({ paths: 1, circles: 1 });
    expect(await marks("one", "zero-or-more")).toEqual({ paths: 3, circles: 1 });
  });

  test("a non identifying relation is dashed and confidence wins", async () => {
    const svg = await svgOf(example());
    expect(relationBlock(svg, "r0")).toContain('stroke-linejoin="round" stroke-dasharray="4 3"/>');
    expect(relationBlock(svg, "r1")).not.toContain("stroke-dasharray");
    const doc = example();
    doc.relations[0].meta = { provenance: { source: "s", confidence: "inferred" } };
    const inferred = relationBlock(await svgOf(doc), "r0");
    expect(inferred).toContain('stroke-dasharray="6 4"');
    expect(inferred).not.toContain('stroke-dasharray="4 3"');
  });

  test("marks are drawn with explicit paint for PNG and PDF", async () => {
    const svg = await svgOf(example(), { styles: false });
    expect(svg).not.toContain("<style>");
    expect(svg).toMatch(/<circle class="sg-bg sg-edge"[^>]*fill="#ffffff" stroke="#475569"/);
    expect(svg).toMatch(/<rect class="sg-header"[^>]*fill="#e2e8f0"/);
  });

  test("an entity shows its coverage and unknown confidence", async () => {
    const doc = small();
    doc.entities[0].meta = { coverage: 0.5, provenance: { source: "s", confidence: "unknown" } };
    const svg = await svgOf(doc);
    expect(svg).toContain('<rect class="sg-accent"');
    expect(svg).toContain('class="sg-node sg-unknown"');
    expect(svg).toContain('stroke-dasharray="2 3"');
  });

  test("escaping", async () => {
    const doc = small();
    doc.entities[0] = {
      id: "a",
      label: '<&">',
      attributes: [{ name: "<n>", type: "<t>", note: "<note>" }],
    };
    const svg = await svgOf(doc);
    expect(svg).toContain("&lt;&amp;&quot;&gt;");
    expect(svg).toContain('data-attr="&lt;n&gt;"');
    expect(svg).toContain("&lt;t&gt;");
    expect(svg).toContain("<title>&lt;note&gt;</title>");
  });

  test("rendering is deterministic", async () => {
    expect(await svgOf(example())).toBe(await svgOf(example()));
  });
});

describe("view", () => {
  test("item count and hover rules", async () => {
    const scene = await sceneOf(example());
    expect(sceneItemCount(scene)).toBe(7);
    expect(HOVERABLE.has("entity")).toBe(true);
    expect(HOVERABLE.has("relation")).toBe(false);
  });

  test("an entity is hit on its box and a relation on its path and its label", async () => {
    const scene = await sceneOf(example());
    const view = createView(scene);
    view.setViewport(scene.width, scene.height);
    view.setCamera({ x: 0, y: 0, scale: 1 });
    const customer = scene.entities[0]!;
    expect(view.hitTest(customer.x + customer.width / 2, customer.y + 10)).toEqual({
      kind: "entity",
      id: "customer",
    });
    const relation = scene.relations[0]!;
    const start = relation.points[0]!;
    const end = relation.points[1]!;
    expect(view.hitTest(start.x + 1, (start.y + end.y) / 2 + 30)).toEqual({
      kind: "relation",
      id: "r0",
    });
    const box = relation.labelBox!;
    expect(view.hitTest(box.x + box.width / 2, box.y + box.height / 2)).toEqual({
      kind: "relation",
      id: "r0",
    });
    expect(view.hitTest(2, scene.height - 2)).toBeNull();
  });

  test("search matches labels, ids and attribute names", async () => {
    const scene = await sceneOf(example());
    const view = createView(scene);
    view.search("ORDER");
    expect([...view.highlight().active].sort()).toEqual(["entity:order", "entity:order_item"]);
    view.search("customer_id");
    expect([...view.highlight().active]).toEqual(["entity:order"]);
    view.search("price");
    expect([...view.highlight().active]).toEqual(["entity:product"]);
    view.search("appears");
    expect([...view.highlight().active]).toEqual([]);
  });

  test("an entity gathers its relations and their endpoints", async () => {
    const scene = await sceneOf(example());
    const view = createView(scene);
    view.hover({ kind: "entity", id: "order" });
    expect([...view.highlight().active].sort()).toEqual([
      "entity:customer",
      "entity:order",
      "entity:order_item",
      "relation:r0",
      "relation:r1",
    ]);
  });

  test("items resolve by reference", async () => {
    const scene = await sceneOf(example());
    const view = createView(scene);
    expect(view.item({ kind: "entity", id: "product" })?.attributes).toHaveLength(2);
    expect(view.item({ kind: "relation", id: "r2" })?.from).toBe("product");
    view.select({ kind: "relation", id: "r2" });
    expect(view.selected()).toEqual({ kind: "relation", id: "r2" });
  });
});
