import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyCalculatedFields,
  applyQuerySteps,
  applyTransforms,
  filterRows,
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
          value: 'Software',
        },
      ],
      sales.id,
      [sales, products],
    ),
    [rows[1]],
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
