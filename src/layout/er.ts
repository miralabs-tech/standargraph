import type { ErDocument } from "../format";
import { type ElkEdgeInput, runElk } from "./elk";
import { measureText } from "./measure";
import {
  attributeTypeText,
  boxSize,
  CAPTION_FONT,
  compact,
  EDGE_LABEL_FONT,
  ER_ROW_HEIGHT,
  ER_ROWS_PAD,
  keysText,
  labelBoxSize,
  PAD_X,
  round,
} from "./shared";
import type {
  Box,
  LaidOutAttribute,
  LaidOutEntity,
  LaidOutEr,
  LaidOutRelation,
} from "./types";

type Entity = ErDocument["entities"][number];

type Metrics = {
  width: number;
  height: number;
  headerHeight: number;
  columns: { key: number; name: number; type: number };
};

function widest(texts: readonly string[], font: typeof EDGE_LABEL_FONT): number {
  return Math.max(0, ...texts.map((text) => measureText(text, font).width));
}

function entityMetrics(entity: Entity): Metrics {
  const header = boxSize(entity.label ?? entity.id, entity.type, 0);
  const attributes = entity.attributes ?? [];
  const keyWidth = widest(
    attributes.map((attribute) => keysText(attribute.keys)),
    CAPTION_FONT,
  );
  const nameWidth = widest(
    attributes.map((attribute) => attribute.name),
    EDGE_LABEL_FONT,
  );
  const typeWidth = widest(attributes.map(attributeTypeText), EDGE_LABEL_FONT);
  const key = PAD_X;
  const name = key + (keyWidth > 0 ? keyWidth + 8 : 0);
  const type = name + nameWidth + 16;
  return {
    width: Math.ceil(Math.max(120, header.width, type + typeWidth + PAD_X)),
    height:
      header.height +
      attributes.length * ER_ROW_HEIGHT +
      (attributes.length > 0 ? 2 * ER_ROWS_PAD : 0),
    headerHeight: header.height,
    columns: { key, name, type },
  };
}

export async function layoutEr(doc: ErDocument): Promise<LaidOutEr> {
  const metrics = new Map<string, Metrics>();
  for (const entity of doc.entities) {
    if (!metrics.has(entity.id)) metrics.set(entity.id, entityMetrics(entity));
  }

  const relations = doc.relations ?? [];
  const elkEdges: ElkEdgeInput[] = relations.map((relation, index) => {
    const edge: ElkEdgeInput = {
      id: `r:${index}`,
      from: `e:${relation.from}`,
      to: `e:${relation.to}`,
    };
    if (relation.label !== undefined && relation.label !== "") {
      const size = labelBoxSize(relation.label);
      edge.label = { width: size.width, height: size.height };
    }
    return edge;
  });

  const result = await runElk(
    doc.direction ?? "down",
    doc.entities.map((entity) => {
      const size = metrics.get(entity.id)!;
      return { id: `e:${entity.id}`, width: size.width, height: size.height };
    }),
    elkEdges,
  );

  const entities: LaidOutEntity[] = doc.entities.map((entity) => {
    const size = metrics.get(entity.id)!;
    const box: Box = result.boxes.get(`e:${entity.id}`) ?? {
      x: 0,
      y: 0,
      width: size.width,
      height: size.height,
    };
    const top = box.y + size.headerHeight + ER_ROWS_PAD;
    const attributes: LaidOutAttribute[] = (entity.attributes ?? []).map(
      (attribute, index) =>
        compact({
          name: attribute.name,
          type: attribute.type,
          keys: attribute.keys,
          nullable: attribute.nullable,
          note: attribute.note,
          y: round(top + index * ER_ROW_HEIGHT),
          height: ER_ROW_HEIGHT,
        }),
    );
    return compact({
      id: entity.id,
      label: entity.label ?? entity.id,
      type: entity.type,
      x: round(box.x),
      y: round(box.y),
      width: round(box.width),
      height: round(box.height),
      headerHeight: size.headerHeight,
      columns: {
        key: round(size.columns.key),
        name: round(size.columns.name),
        type: round(size.columns.type),
      },
      attributes,
      description: entity.description,
      link: entity.link,
      meta: entity.meta,
    });
  });

  const laidOutRelations: LaidOutRelation[] = relations.map((relation, index) => {
    const route = result.routes.get(`r:${index}`);
    const labelBox = route?.labelBox;
    return compact({
      id: relation.id ?? `r${index}`,
      from: relation.from,
      to: relation.to,
      label: relation.label === "" ? undefined : relation.label,
      fromCardinality: relation.fromCardinality,
      toCardinality: relation.toCardinality,
      identifying: relation.identifying ?? true,
      type: relation.type,
      points: (route?.points ?? []).map((point) => ({
        x: round(point.x),
        y: round(point.y),
      })),
      labelBox:
        labelBox === undefined
          ? undefined
          : {
              x: round(labelBox.x),
              y: round(labelBox.y),
              width: round(labelBox.width),
              height: round(labelBox.height),
            },
      meta: relation.meta,
    });
  });

  return compact({
    kind: "er" as const,
    width: round(result.width),
    height: round(result.height),
    title: doc.title,
    entities,
    relations: laidOutRelations,
  });
}
