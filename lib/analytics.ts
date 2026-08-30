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
  | 'difference';

export type Field = {
  name: string;
  kind: FieldKind;
  uniqueCount: number;
};

export type AggregatedPoint = {
  label: string;
  value: number;
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
      } else if (typeof value === 'string') {
        normalized[key.trim()] = String(value);
      } else {
        normalized[key.trim()] = JSON.stringify(value);
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
  return points.map((point, index) => ({
    ...point,
    value: index ? point.value - points[index - 1].value : 0,
  }));
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
