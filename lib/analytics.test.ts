import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateRows,
  applyQuickCalculation,
  inferFields,
  normalizeRows,
  summarize,
} from './analytics';

const rows = normalizeRows([
  { date: '2026-01-01', region: 'East', revenue: '1,200' },
  { date: '2026-01-20', region: 'East', revenue: '800' },
  { date: '2026-02-01', region: 'West', revenue: '500' },
]);

void test('normalizes numeric CSV cells and infers field kinds', () => {
  assert.equal(rows[0].revenue, 1200);
  assert.deepEqual(
    inferFields(rows).map(({ name, kind }) => ({ name, kind })),
    [
      { name: 'date', kind: 'date' },
      { name: 'region', kind: 'text' },
      { name: 'revenue', kind: 'number' },
    ],
  );
});

void test('groups monthly values and calculates sums', () => {
  assert.deepEqual(
    aggregateRows({
      rows,
      dimension: 'date',
      dimensionKind: 'date',
      measure: 'revenue',
      aggregation: 'sum',
    }),
    [
      { label: 'Jan 26', value: 2000 },
      { label: 'Feb 26', value: 500 },
    ],
  );
});

void test('summarizes a selected measure', () => {
  assert.deepEqual(summarize(rows, 'revenue'), {
    total: 2500,
    rows: 3,
    average: 2500 / 3,
    populated: 3,
  });
});

void test('supports extended aggregations and quick calculations', () => {
  const grouped = aggregateRows({
    rows,
    dimension: 'region',
    dimensionKind: 'text',
    measure: 'revenue',
    aggregation: 'maximum',
  });
  assert.deepEqual(grouped, [
    { label: 'East', value: 1200 },
    { label: 'West', value: 500 },
  ]);
  assert.deepEqual(applyQuickCalculation(grouped, 'running-total'), [
    { label: 'East', value: 1200 },
    { label: 'West', value: 1700 },
  ]);
  assert.deepEqual(applyQuickCalculation(grouped, 'difference'), [
    { label: 'East', value: 0 },
    { label: 'West', value: -700 },
  ]);
});
