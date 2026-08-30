import { Parser } from "expr-eval";

import {
  type DataRow,
  type Field,
  type FieldKind,
  inferFields,
} from "./analytics";
import type {
  CalculatedField,
  ColumnTransform,
  DataTable,
  Relationship,
  ReportFilter,
} from "./bi-types";

const parser = new Parser({
  operators: {
    logical: true,
    comparison: true,
    in: false,
    assignment: false,
  },
});

export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

export function sanitizeTableName(name: string): string {
  return name.replace(/\.[^.]+$/, "").trim() || "Untitled table";
}

export function makeTable({
  name,
  rows,
  sourceKind,
  sourceName,
}: Omit<DataTable, "id" | "importedAt">): DataTable {
  return {
    id: createId("table"),
    name: sanitizeTableName(name),
    rows,
    sourceKind,
    sourceName,
    importedAt: new Date().toISOString(),
  };
}

function coerce(value: DataRow[string], kind: FieldKind): DataRow[string] {
  if (value === null || value === undefined || value === "") return null;
  if (kind === "number") {
    const numeric = Number(String(value).replaceAll(",", ""));
    return Number.isFinite(numeric) ? numeric : null;
  }
  if (kind === "date") {
    const date = new Date(String(value));
    return Number.isNaN(date.getTime())
      ? null
      : date.toISOString().slice(0, 10);
  }
  return String(value);
}

export function applyTransforms(
  rows: DataRow[],
  tableId: string,
  transforms: ColumnTransform[],
): DataRow[] {
  const relevant = transforms.filter(
    (transform) => transform.tableId === tableId,
  );
  if (!relevant.length) return rows;
  return rows.map((row) => {
    const next = { ...row };
    for (const transform of relevant) {
      let value = next[transform.field];
      if (transform.trim && typeof value === "string") value = value.trim();
      if ((value === null || value === "") && transform.fillNull) {
        value = transform.fillNull;
      }
      next[transform.field] = coerce(value, transform.kind);
    }
    return next;
  });
}

function compileCalculatedField(field: CalculatedField) {
  const variables = new Map<string, string>();
  let index = 0;
  const expression = field.expression.replace(
    /\[([^\]]+)\]/g,
    (_, rawName: string) => {
      const alias = `v${index++}`;
      variables.set(alias, rawName.trim());
      return alias;
    },
  );
  return { expression: parser.parse(expression), variables };
}

export function applyCalculatedFields(
  rows: DataRow[],
  tableId: string,
  fields: CalculatedField[],
): DataRow[] {
  const compiled = fields
    .filter((field) => field.tableId === tableId)
    .flatMap((field) => {
      try {
        return [{ field, ...compileCalculatedField(field) }];
      } catch {
        return [];
      }
    });
  if (!compiled.length) return rows;
  return rows.map((row) => {
    const next = { ...row };
    for (const item of compiled) {
      try {
        const scope = Object.fromEntries(
          Array.from(item.variables, ([alias, name]) => [
            alias,
            next[name] ?? 0,
          ]),
        );
        const result = item.expression.evaluate(scope) as unknown;
        next[item.field.name] =
          typeof result === "number" || typeof result === "string"
            ? result
            : null;
      } catch {
        next[item.field.name] = null;
      }
    }
    return next;
  });
}

export function validateCalculatedExpression(
  expression: string,
): string | null {
  if (!expression.trim()) return "Enter a formula.";
  try {
    compileCalculatedField({
      id: "validation",
      tableId: "validation",
      name: "validation",
      expression,
    });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid formula.";
  }
}

export function materializeTable({
  tableId,
  tables,
  relationships,
  calculatedFields,
  transforms,
}: {
  tableId: string;
  tables: DataTable[];
  relationships: Relationship[];
  calculatedFields: CalculatedField[];
  transforms: ColumnTransform[];
}): DataRow[] {
  const table = tables.find((candidate) => candidate.id === tableId);
  if (!table) return [];
  let rows = applyCalculatedFields(
    applyTransforms(table.rows, table.id, transforms),
    table.id,
    calculatedFields,
  );
  const direct = relationships.filter(
    (relationship) =>
      relationship.leftTableId === tableId ||
      relationship.rightTableId === tableId,
  );
  for (const relation of direct) {
    const baseIsLeft = relation.leftTableId === tableId;
    const otherId = baseIsLeft ? relation.rightTableId : relation.leftTableId;
    const baseField = baseIsLeft ? relation.leftField : relation.rightField;
    const otherField = baseIsLeft ? relation.rightField : relation.leftField;
    const other = tables.find((candidate) => candidate.id === otherId);
    if (!other) continue;
    const otherRows = applyCalculatedFields(
      applyTransforms(other.rows, other.id, transforms),
      other.id,
      calculatedFields,
    );
    const index = new Map<string, DataRow>();
    for (const row of otherRows) {
      const key = String(row[otherField] ?? "");
      if (!index.has(key)) index.set(key, row);
    }
    rows = rows.map((row) => {
      const match = index.get(String(row[baseField] ?? ""));
      if (!match) return row;
      const additions = Object.fromEntries(
        Object.entries(match).map(([field, value]) => [
          `${other.name}.${field}`,
          value,
        ]),
      );
      return { ...row, ...additions };
    });
  }
  return rows;
}

export function materializedFields(rows: DataRow[]): Field[] {
  return inferFields(rows.slice(0, 5000));
}

export function filterRows(
  rows: DataRow[],
  filters: ReportFilter[],
  tableId: string,
  tables: DataTable[],
): DataRow[] {
  if (!filters.length) return rows;
  return rows.filter((row) =>
    filters.every((filter) => {
      const source = tables.find((table) => table.id === filter.tableId);
      const key =
        filter.tableId === tableId
          ? filter.field
          : `${source?.name}.${filter.field}`;
      return String(row[key] ?? "Blank") === filter.value;
    }),
  );
}

export function validateRelationship(
  relationship: Omit<Relationship, "id">,
  tables: DataTable[],
): string | null {
  if (relationship.leftTableId === relationship.rightTableId) {
    return "Choose two different tables.";
  }
  const left = tables.find((table) => table.id === relationship.leftTableId);
  const right = tables.find((table) => table.id === relationship.rightTableId);
  if (!left || !right) return "A selected table no longer exists.";
  if (
    !inferFields(left.rows).some(
      (field) => field.name === relationship.leftField,
    )
  ) {
    return "The left key does not exist.";
  }
  if (
    !inferFields(right.rows).some(
      (field) => field.name === relationship.rightField,
    )
  ) {
    return "The right key does not exist.";
  }
  return null;
}
