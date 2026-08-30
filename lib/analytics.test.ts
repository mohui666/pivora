import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateRows,
  applyQuickCalculation,
  inferFields,
  normalizeRows,
  profileColumn,
  sortAggregatedPointsByColumn,
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
  assert.deepEqual(applyQuickCalculation(grouped, 'percent-change'), [
    { label: 'East', value: 0 },
    { label: 'West', value: -700 / 1200 },
  ]);
  assert.deepEqual(applyQuickCalculation(grouped, 'rank'), [
    { label: 'East', value: 1 },
    { label: 'West', value: 2 },
  ]);
});

void test('profiles column quality, distribution, and descriptive statistics', () => {
  const profile = profileColumn(
    [...rows, { date: null, region: '', revenue: 'bad' }],
    'revenue',
    'number',
  );

  assert.equal(profile.totalCount, 4);
  assert.equal(profile.validCount, 3);
  assert.equal(profile.errorCount, 1);
  assert.equal(profile.emptyCount, 0);
  assert.equal(profile.distinctCount, 3);
  assert.equal(profile.minimum, 500);
  assert.equal(profile.maximum, 1200);
  assert.equal(profile.average, 2500 / 3);
  assert.equal(profile.median, 800);
  assert.equal(
    profile.distribution.reduce((sum, bin) => sum + bin.count, 0),
    3,
  );
});

void test('sorts aggregated categories by a configured metadata column', () => {
  const points = [
    { label: 'West', value: 500 },
    { label: 'East', value: 2000 },
    { label: 'North', value: 900 },
  ];
  const ordered = sortAggregatedPointsByColumn(
    points,
    [
      { region: 'East', region_order: 2 },
      { region: 'West', region_order: 3 },
      { region: 'North', region_order: 1 },
    ],
    'region',
    'region_order',
  );
  assert.deepEqual(
    ordered.map((point) => point.label),
    ['North', 'East', 'West'],
  );
});
