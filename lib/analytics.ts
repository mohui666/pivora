export type DataRow = Record<string, string | number | null>;
export type FieldKind = 'date' | 'number' | 'text';
export type Aggregation =
  | 'sum'
  | 'average'
  | 'count'
  | 'minimum'
  | 'maximum'
  | 'distinct-count';
export type QuickCalculation =
  | 'none'
  | 'running-total'
  | 'percent-of-total'
  | 'difference'
  | 'percent-change'
  | 'rank';

export type Field = {
  name: string;
  kind: FieldKind;
  uniqueCount: number;
};

export type AggregatedPoint = {
  label: string;
  value: number;
};

export type ColumnProfile = {
  field: string;
  kind: FieldKind;
  totalCount: number;
  validCount: number;
  emptyCount: number;
  errorCount: number;
  distinctCount: number;
  validRatio: number;
  minimum?: number;
  maximum?: number;
  average?: number;
  median?: number;
  standardDeviation?: number;
  topValues: Array<{ label: string; count: number; ratio: number }>;
  distribution: Array<{
    label: string;
    minimum: number;
    maximum: number;
    count: number;
  }>;
};

const DATE_PATTERN = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/;

export function normalizeRows(input: Record<string, unknown>[]): DataRow[] {
  return input.map((row) => {
    const normalized: DataRow = {};
    for (const [key, raw] of Object.entries(row)) {
      const value = typeof raw === 'string' ? raw.trim() : raw;
      if (value === '' || value === undefined) {
        normalized[key.trim()] = null;
      } else if (
        typeof value === 'string' &&
        /^-?\d+(\.\d+)?$/.test(value.replaceAll(',', ''))
      ) {
        normalized[key.trim()] = Number(value.replaceAll(',', ''));
      } else if (typeof value === 'number') {
        normalized[key.trim()] = value;
      } else if (typeof value === 'bigint') {
        normalized[key.trim()] = Number.isSafeInteger(Number(value))
          ? Number(value)
          : value.toString();
      } else if (typeof value === 'boolean') {
        normalized[key.trim()] = String(value);
      } else if (value instanceof Date) {
        normalized[key.trim()] = value.toISOString();
      } else if (value instanceof Uint8Array) {
        normalized[key.trim()] = `[binary ${value.byteLength} bytes]`;
      } else if (typeof value === 'string') {
        normalized[key.trim()] = String(value);
      } else {
        normalized[key.trim()] = JSON.stringify(value, (_, nested) =>
          typeof nested === 'bigint' ? nested.toString() : nested,
        );
      }
    }
    return normalized;
  });
}

export function inferFields(rows: DataRow[]): Field[] {
  const names = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  return names.map((name) => {
    const values = rows
      .map((row) => row[name])
      .filter(
        (value): value is string | number =>
          value !== null && value !== undefined,
      );
    const numericRatio = values.length
      ? values.filter((value) => typeof value === 'number').length /
        values.length
      : 0;
    const dateRatio = values.length
      ? values.filter(
          (value) =>
            typeof value === 'string' &&
            DATE_PATTERN.test(value) &&
            !Number.isNaN(Date.parse(value)),
        ).length / values.length
      : 0;
    return {
      name,
      kind: numericRatio >= 0.8 ? 'number' : dateRatio >= 0.8 ? 'date' : 'text',
      uniqueCount: new Set(values.map(String)).size,
    };
  });
}

export function profileColumn(
  rows: DataRow[],
  field: string,
  kind?: FieldKind,
): ColumnProfile {
  const resolvedKind =
    kind ??
    inferFields(rows).find((candidate) => candidate.name === field)?.kind ??
    'text';
  const values = rows.map((row) => row[field]);
  const populated = values.filter(
    (value): value is string | number =>
      value !== null && value !== undefined && String(value).trim() !== '',
  );
  const isValid = (value: string | number) =>
    resolvedKind === 'number'
      ? Number.isFinite(Number(value))
      : resolvedKind === 'date'
        ? !Number.isNaN(Date.parse(String(value)))
        : true;
  const valid = populated.filter(isValid);
  const counts = new Map<string, number>();
  for (const value of valid) {
    const label = String(value);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const topValues = Array.from(counts, ([label, count]) => ({
    label,
    count,
    ratio: valid.length ? count / valid.length : 0,
  }))
    .sort(
      (left, right) =>
        right.count - left.count || left.label.localeCompare(right.label),
    )
    .slice(0, 8);
  const numeric =
    resolvedKind === 'number'
      ? valid
          .map(Number)
          .filter(Number.isFinite)
          .sort((left, right) => left - right)
      : [];
  const minimum = numeric[0];
  const maximum = numeric.at(-1);
  const average = numeric.length
    ? numeric.reduce((sum, value) => sum + value, 0) / numeric.length
    : undefined;
  const middle = Math.floor(numeric.length / 2);
  const median = numeric.length
    ? numeric.length % 2
      ? numeric[middle]
      : (numeric[middle - 1] + numeric[middle]) / 2
    : undefined;
  const standardDeviation = numeric.length
    ? Math.sqrt(
        numeric.reduce((sum, value) => sum + (value - (average ?? 0)) ** 2, 0) /
          numeric.length,
      )
    : undefined;
  const distribution: ColumnProfile['distribution'] = [];
  if (numeric.length && minimum !== undefined && maximum !== undefined) {
    const binCount = Math.min(
      8,
      Math.max(1, Math.ceil(Math.sqrt(numeric.length))),
    );
    const width = maximum === minimum ? 1 : (maximum - minimum) / binCount;
    for (let index = 0; index < binCount; index += 1) {
      const lower = minimum + width * index;
      const upper =
        index === binCount - 1 ? maximum : minimum + width * (index + 1);
      const count = numeric.filter(
        (value) =>
          value >= lower &&
          (index === binCount - 1 ? value <= upper : value < upper),
      ).length;
      distribution.push({
        label: `${formatMetric(lower)}–${formatMetric(upper)}`,
        minimum: lower,
        maximum: upper,
        count,
      });
    }
  }
  return {
    field,
    kind: resolvedKind,
    totalCount: rows.length,
    validCount: valid.length,
    emptyCount: values.length - populated.length,
    errorCount: populated.length - valid.length,
    distinctCount: counts.size,
    validRatio: rows.length ? valid.length / rows.length : 0,
    minimum,
    maximum,
    average,
    median,
    standardDeviation,
    topValues,
    distribution,
  };
}

function dimensionLabel(value: DataRow[string], kind: FieldKind): string {
  if (value === null || value === undefined || value === '') return 'Blank';
  if (kind !== 'date') return String(value);
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    year: '2-digit',
  }).format(date);
}

export function aggregateRows({
  rows,
  dimension,
  dimensionKind,
  measure,
  aggregation,
  filterValue,
}: {
  rows: DataRow[];
  dimension: string;
  dimensionKind: FieldKind;
  measure: string;
  aggregation: Aggregation;
  filterValue?: string;
}): AggregatedPoint[] {
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const label = dimensionLabel(row[dimension], dimensionKind);
    if (filterValue && label !== filterValue) continue;
    const numeric = measure === '__rows' ? 1 : Number(row[measure]);
    if (!Number.isFinite(numeric)) continue;
    const values = groups.get(label) ?? [];
    values.push(numeric);
    groups.set(label, values);
  }
  const points = Array.from(groups, ([label, values]) => ({
    label,
    value:
      aggregation === 'count'
        ? values.length
        : aggregation === 'distinct-count'
          ? new Set(values).size
          : aggregation === 'average'
            ? values.reduce((sum, value) => sum + value, 0) / values.length
            : aggregation === 'minimum'
              ? Math.min(...values)
              : aggregation === 'maximum'
                ? Math.max(...values)
                : values.reduce((sum, value) => sum + value, 0),
  }));
  if (dimensionKind === 'date') {
    const monthIndex = (label: string) => {
      const parsed = Date.parse(`1 ${label}`);
      return Number.isNaN(parsed) ? 0 : parsed;
    };
    return points.sort((a, b) => monthIndex(a.label) - monthIndex(b.label));
  }
  return points.sort((a, b) => b.value - a.value).slice(0, 18);
}

export function applyQuickCalculation(
  points: AggregatedPoint[],
  calculation: QuickCalculation = 'none',
): AggregatedPoint[] {
  if (calculation === 'none') return points;
  if (calculation === 'percent-of-total') {
    const total = points.reduce((sum, point) => sum + point.value, 0);
    return points.map((point) => ({
      ...point,
      value: total ? point.value / total : 0,
    }));
  }
  if (calculation === 'running-total') {
    let total = 0;
    return points.map((point) => ({ ...point, value: (total += point.value) }));
  }
  if (calculation === 'rank') {
    const ranks = new Map(
      [...points]
        .sort((left, right) => right.value - left.value)
        .map((point, index) => [point.label, index + 1]),
    );
    return points.map((point) => ({
      ...point,
      value: ranks.get(point.label) ?? 0,
    }));
  }
  if (calculation === 'percent-change') {
    return points.map((point, index) => {
      const previous = points[index - 1]?.value;
      return {
        ...point,
        value: previous ? (point.value - previous) / Math.abs(previous) : 0,
      };
    });
  }
  return points.map((point, index) => ({
    ...point,
    value: index ? point.value - points[index - 1].value : 0,
  }));
}

export function sortAggregatedPointsByColumn(
  points: AggregatedPoint[],
  rows: DataRow[],
  dimension: string,
  sortByField: string,
): AggregatedPoint[] {
  const sortValues = new Map<string, DataRow[string]>();
  for (const row of rows) {
    const label = dimensionLabel(row[dimension], 'text');
    if (!sortValues.has(label)) sortValues.set(label, row[sortByField]);
  }
  return [...points].sort((left, right) => {
    const leftValue = sortValues.get(left.label);
    const rightValue = sortValues.get(right.label);
    if (leftValue === null || leftValue === undefined)
      return rightValue === null || rightValue === undefined ? 0 : 1;
    if (rightValue === null || rightValue === undefined) return -1;
    const leftNumber = Number(leftValue);
    const rightNumber = Number(rightValue);
    return Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
      ? leftNumber - rightNumber
      : String(leftValue).localeCompare(String(rightValue), undefined, {
          numeric: true,
          sensitivity: 'base',
        });
  });
}

export function summarize(rows: DataRow[], measure: string) {
  const values = rows
    .map((row) => (measure === '__rows' ? 1 : Number(row[measure])))
    .filter(Number.isFinite);
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    total,
    rows: rows.length,
    average: values.length ? total / values.length : 0,
    populated: values.length,
  };
}

export function formatMetric(value: number): string {
  return new Intl.NumberFormat('en', {
    notation: Math.abs(value) >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: Math.abs(value) >= 100 ? 1 : 2,
  }).format(value);
}
