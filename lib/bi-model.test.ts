import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyzeRelationship,
  applyCalculatedFields,
  applyQuerySteps,
  applyTransforms,
  filterRows,
  filtersForContext,
  filtersForDrillthrough,
  materializeTable,
  validateCalculatedExpression,
  validateRelationship,
} from './bi-model';
import type { DataTable, Relationship } from './bi-types';

const sales: DataTable = {
  id: 'sales',
  name: 'Sales',
  sourceKind: 'csv',
  sourceName: 'sales.csv',
  importedAt: '2026-08-30T00:00:00.000Z',
  rows: [
    { product_id: 'p1', revenue: ' 120 ', cost: 50, note: ' keep ' },
    { product_id: 'p2', revenue: '80', cost: 30, note: null },
  ],
};

const products: DataTable = {
  id: 'products',
  name: 'Products',
  sourceKind: 'json',
  sourceName: 'products.json',
  importedAt: '2026-08-30T00:00:00.000Z',
  rows: [
    { id: 'p1', category: 'Hardware' },
    { id: 'p2', category: 'Software' },
  ],
};

const relationship: Relationship = {
  id: 'relation',
  leftTableId: 'sales',
  leftField: 'product_id',
  rightTableId: 'products',
  rightField: 'id',
};

void test('applies cleaning and type coercion without mutating source rows', () => {
  const result = applyTransforms(sales.rows, sales.id, [
    {
      id: 'revenue-number',
      tableId: sales.id,
      field: 'revenue',
      kind: 'number',
      trim: true,
      fillNull: '0',
    },
    {
      id: 'note-clean',
      tableId: sales.id,
      field: 'note',
      kind: 'text',
      trim: true,
      fillNull: 'Unknown',
    },
  ]);

  assert.equal(result[0].revenue, 120);
  assert.equal(result[0].note, 'keep');
  assert.equal(result[1].note, 'Unknown');
  assert.equal(sales.rows[0].revenue, ' 120 ');
});

void test('removes excluded columns during non-destructive materialization', () => {
  const result = applyTransforms(sales.rows, sales.id, [
    {
      id: 'remove-note',
      tableId: sales.id,
      field: 'note',
      kind: 'text',
      trim: false,
      fillNull: '',
      remove: true,
    },
  ]);

  assert.equal('note' in result[0], false);
  assert.equal('note' in sales.rows[0], true);
});

void test('evaluates bracketed calculated fields and rejects malformed formulas', () => {
  const result = applyCalculatedFields(sales.rows, sales.id, [
    {
      id: 'profit',
      tableId: sales.id,
      name: 'profit',
      expression: '[revenue] - [cost]',
    },
  ]);

  assert.equal(result[0].profit, 70);
  assert.equal(result[1].profit, 50);
  assert.equal(
    validateCalculatedExpression('[revenue] -'),
    'unexpected TEOF: EOF',
  );
});

void test('resolves numeric what-if parameters inside calculated fields', () => {
  const result = applyCalculatedFields(
    sales.rows,
    sales.id,
    [
      {
        id: 'scenario',
        tableId: sales.id,
        name: 'scenario_revenue',
        expression: '[revenue] * (1 + [Uplift] / 100)',
      },
    ],
    [
      {
        id: 'uplift',
        name: 'Uplift',
        minimum: 0,
        maximum: 50,
        step: 5,
        value: 25,
      },
    ],
  );

  assert.equal(result[0].scenario_revenue, 150);
  assert.equal(result[1].scenario_revenue, 100);
});

void test('materializes lookup fields and applies cross-table filters', () => {
  const rows = materializeTable({
    tableId: sales.id,
    tables: [sales, products],
    relationships: [relationship],
    transforms: [],
    calculatedFields: [],
  });

  assert.equal(rows[0]['Products.category'], 'Hardware');
  assert.deepEqual(
    filterRows(
      rows,
      [
        {
          id: 'filter',
          tableId: products.id,
          field: 'category',
          operator: 'equals',
          value: 'Software',
          scope: 'report',
        },
      ],
      sales.id,
      [sales, products],
    ),
    [rows[1]],
  );
});

void test('applies role row rules and lets owners bypass preview filtering', () => {
  const rows = materializeTable({
    tableId: sales.id,
    tables: [sales, products],
    relationships: [relationship],
    transforms: [],
    calculatedFields: [],
  });
  const rules = [
    {
      id: 'viewer-hardware',
      role: 'viewer' as const,
      tableId: products.id,
      field: 'category',
      operator: 'equals' as const,
      value: 'Hardware',
      enabled: true,
    },
  ];

  assert.deepEqual(
    filterRows(rows, [], sales.id, [sales, products], rules, 'viewer'),
    [rows[0]],
  );
  assert.equal(
    filterRows(rows, [], sales.id, [sales, products], rules, 'owner').length,
    2,
  );
});

void test('selects report, page, visual, and interaction filter contexts', () => {
  const base = {
    tableId: sales.id,
    field: 'product_id',
    operator: 'equals' as const,
    value: 'p1',
  };
  const selected = filtersForContext(
    [
      { ...base, id: 'report', scope: 'report' },
      { ...base, id: 'page', scope: 'page', pageId: 'overview' },
      { ...base, id: 'other-page', scope: 'page', pageId: 'detail' },
      { ...base, id: 'visual', scope: 'visual', widgetId: 'chart' },
      {
        ...base,
        id: 'interaction',
        scope: 'interaction',
        pageId: 'overview',
        sourceWidgetId: 'source',
      },
      {
        ...base,
        id: 'self-interaction',
        scope: 'interaction',
        pageId: 'overview',
        sourceWidgetId: 'chart',
      },
    ],
    'overview',
    'chart',
  );

  assert.deepEqual(
    selected.map((filter) => filter.id),
    ['report', 'page', 'visual', 'interaction'],
  );
});

void test('transfers selected and optional source context into a drillthrough page', () => {
  const base = {
    tableId: sales.id,
    field: 'product_id',
    operator: 'equals' as const,
    value: 'p1',
  };
  const filters = [
    { ...base, id: 'report', scope: 'report' as const },
    {
      ...base,
      id: 'source-page',
      scope: 'page' as const,
      pageId: 'overview',
    },
    {
      ...base,
      id: 'selected',
      scope: 'interaction' as const,
      pageId: 'overview',
      sourceWidgetId: 'chart',
    },
    {
      ...base,
      id: 'old-target',
      scope: 'page' as const,
      pageId: 'detail',
    },
  ];
  const transferred = filtersForDrillthrough(
    filters,
    'overview',
    'chart',
    'detail',
    'selected',
    true,
  );

  assert.deepEqual(
    transferred
      .filter((filter) => filter.scope === 'page' && filter.pageId === 'detail')
      .map((filter) => filter.id),
    ['drillthrough_source-page_detail', 'drillthrough_selected_detail'],
  );
  assert.equal(
    transferred.some((filter) => filter.id === 'report'),
    true,
  );
  assert.equal(
    transferred.some((filter) => filter.id === 'old-target'),
    false,
  );
});

void test('validates relationship table and key selection', () => {
  assert.equal(validateRelationship(relationship, [sales, products]), null);
  assert.equal(
    validateRelationship(
      { ...relationship, rightTableId: sales.id, rightField: 'product_id' },
      [sales, products],
    ),
    'Choose two different tables.',
  );
});

void test('diagnoses relationship cardinality and unmatched keys', () => {
  const duplicateProducts: DataTable = {
    ...products,
    rows: [
      ...products.rows,
      { id: 'p2', category: 'Duplicate' },
      { id: 'p3', category: 'Unmatched' },
    ],
  };
  const diagnostic = analyzeRelationship(
    { ...relationship, cardinality: 'many-to-one' },
    [sales, duplicateProducts],
  );

  assert.equal(diagnostic.status, 'invalid');
  assert.equal(diagnostic.cardinalityValid, false);
  assert.equal(diagnostic.rightDuplicates, 1);
  assert.equal(diagnostic.unmatchedRight, 1);
  assert.equal(diagnostic.matchRate, 1);
});

void test('respects relationship direction and expands many-to-many matches', () => {
  const oneWay = materializeTable({
    tableId: products.id,
    tables: [sales, products],
    relationships: [{ ...relationship, crossFilterDirection: 'single' }],
    transforms: [],
    calculatedFields: [],
  });
  assert.equal(oneWay[0]['Sales.revenue'], undefined);

  const bothWays = materializeTable({
    tableId: products.id,
    tables: [sales, products],
    relationships: [
      {
        ...relationship,
        cardinality: 'many-to-many',
        crossFilterDirection: 'both',
      },
    ],
    transforms: [],
    calculatedFields: [],
  });
  assert.equal(bothWays.length, 2);
  assert.equal(bothWays[0]['Sales.product_id'], 'p1');
});

void test('applies ordered query steps without mutating source rows', () => {
  const result = applyQuerySteps(sales.rows, sales.id, [
    {
      id: 'filter',
      tableId: sales.id,
      kind: 'filter',
      field: 'revenue',
      operator: 'greater-than',
      value: '90',
      direction: 'ascending',
      count: 100,
      name: 'Index',
      start: 1,
      enabled: true,
    },
    {
      id: 'index',
      tableId: sales.id,
      kind: 'add-index',
      field: '',
      operator: 'equals',
      value: '',
      direction: 'ascending',
      count: 100,
      name: 'Row number',
      start: 10,
      enabled: true,
    },
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0]['Row number'], 10);
  assert.equal('Row number' in sales.rows[0], false);
});

void test('applies advanced replace, split, custom, and group query steps', () => {
  const base = {
    tableId: sales.id,
    operator: 'equals' as const,
    direction: 'ascending' as const,
    count: 100,
    start: 1,
    enabled: true,
  };
  const prepared = applyQuerySteps(sales.rows, sales.id, [
    {
      ...base,
      id: 'replace',
      kind: 'replace-values',
      field: 'product_id',
      value: 'p',
      replacement: 'SKU-',
      name: '',
    },
    {
      ...base,
      id: 'split',
      kind: 'split-column',
      field: 'product_id',
      value: '',
      separator: '-',
      name: 'product',
    },
    {
      ...base,
      id: 'custom',
      kind: 'custom-column',
      field: '',
      value: '[cost] * 2',
      name: 'double_cost',
    },
  ]);
  assert.equal(prepared[0]['product.1'], 'SKU');
  assert.equal(prepared[0]['product.2'], '1');
  assert.equal(prepared[0].double_cost, 100);

  const grouped = applyQuerySteps(sales.rows, sales.id, [
    {
      ...base,
      id: 'group',
      kind: 'group-by',
      field: 'product_id',
      targetField: 'cost',
      aggregation: 'sum',
      value: '',
      name: 'total_cost',
    },
  ]);
  assert.deepEqual(grouped, [
    { product_id: 'p1', total_cost: 50 },
    { product_id: 'p2', total_cost: 30 },
  ]);
});
