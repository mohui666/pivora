import { Parser } from 'expr-eval';

import {
  type DataRow,
  type Field,
  type FieldKind,
  inferFields,
} from './analytics';
import type {
  CalculatedField,
  ColumnTransform,
  DataTable,
  QueryStep,
  Relationship,
  ReportFilter,
  ReportRole,
  RoleRule,
} from './bi-types';

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
  return name.replace(/\.[^.]+$/, '').trim() || 'Untitled table';
}

export function makeTable({
  name,
  rows,
  sourceKind,
  sourceName,
}: Omit<DataTable, 'id' | 'importedAt'>): DataTable {
  return {
    id: createId('table'),
    name: sanitizeTableName(name),
    rows,
    sourceKind,
    sourceName,
    importedAt: new Date().toISOString(),
  };
}

function coerce(value: DataRow[string], kind: FieldKind): DataRow[string] {
  if (value === null || value === undefined || value === '') return null;
  if (kind === 'number') {
    const numeric = Number(String(value).replaceAll(',', ''));
    return Number.isFinite(numeric) ? numeric : null;
  }
  if (kind === 'date') {
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
      if (transform.remove) {
        delete next[transform.field];
        continue;
      }
      let value = next[transform.field];
      if (transform.trim && typeof value === 'string') value = value.trim();
      if ((value === null || value === '') && transform.fillNull) {
        value = transform.fillNull;
      }
      next[transform.field] = coerce(value, transform.kind);
    }
    return next;
  });
}

function compareValues(left: DataRow[string], right: DataRow[string]): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return String(left ?? '').localeCompare(String(right ?? ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function matchesOperator(
  cell: DataRow[string],
  operator: QueryStep['operator'],
  target: string,
): boolean {
  const blank = cell === null || cell === undefined || cell === '';
  if (operator === 'is-blank') return blank;
  if (operator === 'not-blank') return !blank;
  if (operator === 'contains') {
    return String(cell ?? '')
      .toLocaleLowerCase()
      .includes(target.toLocaleLowerCase());
  }
  const comparison = compareValues(cell, target);
  if (operator === 'not-equals') return comparison !== 0;
  if (operator === 'greater-than') return comparison > 0;
  if (operator === 'less-than') return comparison < 0;
  return comparison === 0;
}

export function applyQuerySteps(
  rows: DataRow[],
  tableId: string,
  steps: QueryStep[],
): DataRow[] {
  let result = rows;
  for (const step of steps.filter(
    (candidate) => candidate.tableId === tableId && candidate.enabled,
  )) {
    if (step.kind === 'filter') {
      result = result.filter((row) =>
        matchesOperator(row[step.field], step.operator, step.value),
      );
    } else if (step.kind === 'sort') {
      const direction = step.direction === 'ascending' ? 1 : -1;
      result = [...result].sort(
        (left, right) =>
          compareValues(left[step.field], right[step.field]) * direction,
      );
    } else if (step.kind === 'remove-duplicates') {
      const seen = new Set<string>();
      result = result.filter((row) => {
        const key = String(row[step.field] ?? '');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    } else if (step.kind === 'limit') {
      result = result.slice(0, Math.max(0, step.count));
    } else if (step.kind === 'add-index') {
      result = result.map((row, index) => ({
        ...row,
        [step.name || 'Index']: step.start + index,
      }));
    } else if (step.kind === 'replace-values') {
      result = result.map((row) => ({
        ...row,
        [step.field]: String(row[step.field] ?? '').replaceAll(
          step.value,
          step.replacement ?? '',
        ),
      }));
    } else if (step.kind === 'rename-column') {
      result = result.map((row) => {
        const next = { ...row };
        next[step.name || step.field] = next[step.field];
        delete next[step.field];
        return next;
      });
    } else if (step.kind === 'split-column') {
      const separator = step.separator || ',';
      result = result.map((row) => {
        const parts = String(row[step.field] ?? '').split(separator);
        const prefix = step.name || step.field;
        return {
          ...row,
          [`${prefix}.1`]: parts[0] ?? '',
          [`${prefix}.2`]: parts.slice(1).join(separator),
        };
      });
    } else if (step.kind === 'custom-column') {
      result = applyCalculatedFields(result, tableId, [
        {
          id: step.id,
          tableId,
          name: step.name || 'Custom',
          expression: step.value,
        },
      ]);
    } else if (step.kind === 'group-by') {
      const groups = new Map<string, number[]>();
      for (const row of result) {
        const key = String(row[step.field] ?? 'Blank');
        const numeric = Number(row[step.targetField ?? '']);
        const values = groups.get(key) ?? [];
        if (Number.isFinite(numeric)) values.push(numeric);
        groups.set(key, values);
      }
      result = Array.from(groups, ([key, values]) => {
        const aggregation = step.aggregation ?? 'sum';
        const value = !values.length
          ? 0
          : aggregation === 'count'
            ? values.length
            : aggregation === 'distinct-count'
              ? new Set(values).size
              : aggregation === 'average'
                ? values.reduce((sum, item) => sum + item, 0) /
                  Math.max(1, values.length)
                : aggregation === 'minimum'
                  ? Math.min(...values)
                  : aggregation === 'maximum'
                    ? Math.max(...values)
                    : values.reduce((sum, item) => sum + item, 0);
        return {
          [step.field]: key,
          [step.name || `${aggregation}_${step.targetField}`]: value,
        };
      });
    }
  }
  return result;
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
          typeof result === 'number' || typeof result === 'string'
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
  if (!expression.trim()) return 'Enter a formula.';
  try {
    compileCalculatedField({
      id: 'validation',
      tableId: 'validation',
      name: 'validation',
      expression,
    });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid formula.';
  }
}

export function materializeTable({
  tableId,
  tables,
  relationships,
  calculatedFields,
  transforms,
  querySteps = [],
}: {
  tableId: string;
  tables: DataTable[];
  relationships: Relationship[];
  calculatedFields: CalculatedField[];
  transforms: ColumnTransform[];
  querySteps?: QueryStep[];
}): DataRow[] {
  const table = tables.find((candidate) => candidate.id === tableId);
  if (!table) return [];
  let rows = applyCalculatedFields(
    applyQuerySteps(
      applyTransforms(table.rows, table.id, transforms),
      table.id,
      querySteps,
    ),
    table.id,
    calculatedFields,
  );
  const direct = relationships.filter(
    (relationship) =>
      relationship.active !== false &&
      (relationship.leftTableId === tableId ||
        (relationship.crossFilterDirection === 'both' &&
          relationship.rightTableId === tableId)),
  );
  for (const relation of direct) {
    const baseIsLeft = relation.leftTableId === tableId;
    const otherId = baseIsLeft ? relation.rightTableId : relation.leftTableId;
    const baseField = baseIsLeft ? relation.leftField : relation.rightField;
    const otherField = baseIsLeft ? relation.rightField : relation.leftField;
    const other = tables.find((candidate) => candidate.id === otherId);
    if (!other) continue;
    const otherRows = applyCalculatedFields(
      applyQuerySteps(
        applyTransforms(other.rows, other.id, transforms),
        other.id,
        querySteps,
      ),
      other.id,
      calculatedFields,
    );
    const index = new Map<string, DataRow[]>();
    for (const row of otherRows) {
      const key = String(row[otherField] ?? '');
      index.set(key, [...(index.get(key) ?? []), row]);
    }
    rows = rows.flatMap((row) => {
      const matches = index.get(String(row[baseField] ?? ''));
      if (!matches?.length) return [row];
      const selected =
        relation.cardinality === 'many-to-many' ? matches : matches.slice(0, 1);
      return selected.map((match) => {
        const additions = Object.fromEntries(
          Object.entries(match).map(([field, value]) => [
            `${other.name}.${field}`,
            value,
          ]),
        );
        return { ...row, ...additions };
      });
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
  roleRules: RoleRule[] = [],
  role: ReportRole = 'owner',
): DataRow[] {
  const activeRoleRules =
    role === 'owner'
      ? []
      : roleRules.filter((rule) => rule.enabled && rule.role === role);
  if (!filters.length && !activeRoleRules.length) return rows;
  return rows.filter(
    (row) =>
      filters.every((filter) => {
        const source = tables.find((table) => table.id === filter.tableId);
        const key =
          filter.tableId === tableId
            ? filter.field
            : `${source?.name}.${filter.field}`;
        return String(row[key] ?? 'Blank') === filter.value;
      }) &&
      activeRoleRules.every((rule) => {
        const source = tables.find((table) => table.id === rule.tableId);
        const key =
          rule.tableId === tableId
            ? rule.field
            : `${source?.name}.${rule.field}`;
        if (rule.tableId !== tableId && !(key in row)) return true;
        return matchesOperator(row[key], rule.operator, rule.value);
      }),
  );
}

export function validateRelationship(
  relationship: Omit<Relationship, 'id'>,
  tables: DataTable[],
): string | null {
  if (relationship.leftTableId === relationship.rightTableId) {
    return 'Choose two different tables.';
  }
  const left = tables.find((table) => table.id === relationship.leftTableId);
  const right = tables.find((table) => table.id === relationship.rightTableId);
  if (!left || !right) return 'A selected table no longer exists.';
  if (
    !inferFields(left.rows).some(
      (field) => field.name === relationship.leftField,
    )
  ) {
    return 'The left key does not exist.';
  }
  if (
    !inferFields(right.rows).some(
      (field) => field.name === relationship.rightField,
    )
  ) {
    return 'The right key does not exist.';
  }
  return null;
}

export type RelationshipDiagnostic = {
  status: 'healthy' | 'warning' | 'invalid';
  cardinalityValid: boolean;
  leftRows: number;
  rightRows: number;
  leftDistinct: number;
  rightDistinct: number;
  leftDuplicates: number;
  rightDuplicates: number;
  leftNulls: number;
  rightNulls: number;
  unmatchedLeft: number;
  unmatchedRight: number;
  matchRate: number;
  issues: string[];
};

function relationshipKey(value: DataRow[string]): string | null {
  if (value === null || value === undefined || value === '') return null;
  return String(value).trim();
}

export function analyzeRelationship(
  relationship: Relationship,
  tables: DataTable[],
): RelationshipDiagnostic {
  const left = tables.find((table) => table.id === relationship.leftTableId);
  const right = tables.find((table) => table.id === relationship.rightTableId);
  if (!left || !right) {
    return {
      status: 'invalid',
      cardinalityValid: false,
      leftRows: left?.rows.length ?? 0,
      rightRows: right?.rows.length ?? 0,
      leftDistinct: 0,
      rightDistinct: 0,
      leftDuplicates: 0,
      rightDuplicates: 0,
      leftNulls: 0,
      rightNulls: 0,
      unmatchedLeft: 0,
      unmatchedRight: 0,
      matchRate: 0,
      issues: ['A related table is missing.'],
    };
  }

  const leftKeys = left.rows.map((row) =>
    relationshipKey(row[relationship.leftField]),
  );
  const rightKeys = right.rows.map((row) =>
    relationshipKey(row[relationship.rightField]),
  );
  const leftNonNull = leftKeys.filter((key): key is string => key !== null);
  const rightNonNull = rightKeys.filter((key): key is string => key !== null);
  const leftSet = new Set(leftNonNull);
  const rightSet = new Set(rightNonNull);
  const leftDuplicates = leftNonNull.length - leftSet.size;
  const rightDuplicates = rightNonNull.length - rightSet.size;
  const leftNulls = leftKeys.length - leftNonNull.length;
  const rightNulls = rightKeys.length - rightNonNull.length;
  const unmatchedLeft = leftNonNull.filter((key) => !rightSet.has(key)).length;
  const unmatchedRight = rightNonNull.filter((key) => !leftSet.has(key)).length;
  const leftUnique = leftDuplicates === 0 && leftNulls === 0;
  const rightUnique = rightDuplicates === 0 && rightNulls === 0;
  const cardinality = relationship.cardinality ?? 'many-to-one';
  const cardinalityValid =
    cardinality === 'many-to-many' ||
    (cardinality === 'many-to-one' && rightUnique) ||
    (cardinality === 'one-to-many' && leftUnique) ||
    (cardinality === 'one-to-one' && leftUnique && rightUnique);
  const issues: string[] = [];
  if (!cardinalityValid) {
    issues.push(`Key uniqueness does not satisfy ${cardinality}.`);
  }
  if (leftNulls || rightNulls) {
    issues.push(`${leftNulls + rightNulls} blank key value(s).`);
  }
  if (unmatchedLeft || unmatchedRight) {
    issues.push(`${unmatchedLeft + unmatchedRight} unmatched key value(s).`);
  }
  const matchedLeft = leftNonNull.length - unmatchedLeft;
  const matchRate = leftNonNull.length ? matchedLeft / leftNonNull.length : 0;
  return {
    status: !cardinalityValid
      ? 'invalid'
      : issues.length
        ? 'warning'
        : 'healthy',
    cardinalityValid,
    leftRows: left.rows.length,
    rightRows: right.rows.length,
    leftDistinct: leftSet.size,
    rightDistinct: rightSet.size,
    leftDuplicates,
    rightDuplicates,
    leftNulls,
    rightNulls,
    unmatchedLeft,
    unmatchedRight,
    matchRate,
    issues,
  };
}
