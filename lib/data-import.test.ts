import assert from 'node:assert/strict';
import { File as NodeFile } from 'node:buffer';
import test from 'node:test';

import * as XLSX from 'xlsx';
import { parquetWriteBuffer } from 'hyparquet-writer';

import { parseDataFile } from './data-import';

void test('imports CSV and JSON collections as normalized local tables', async () => {
  const csv = new NodeFile(
    ['region,revenue\nNorth,"1,200"\nSouth,900'],
    'sales.csv',
    { type: 'text/csv' },
  );
  const json = new NodeFile(
    [JSON.stringify({ products: [{ id: 'p1', price: 42 }] })],
    'catalog.json',
    { type: 'application/json' },
  );

  const [csvTable] = await parseDataFile(csv as unknown as File);
  const [jsonTable] = await parseDataFile(json as unknown as File);

  assert.equal(csvTable.sourceKind, 'csv');
  assert.equal(csvTable.rows.length, 2);
  assert.equal(jsonTable.name, 'products');
  assert.equal(jsonTable.rows[0].price, 42);
});

void test('imports every populated Excel worksheet', async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet([{ month: 'Jan', revenue: 1250 }]),
    'Revenue',
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet([{ region: 'North', target: 1500 }]),
    'Targets',
  );
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const file = new NodeFile([bytes], 'planning.xlsx');

  const tables = await parseDataFile(file as unknown as File);

  assert.deepEqual(
    tables.map((table) => table.name),
    ['Revenue', 'Targets'],
  );
  assert.equal(tables[0].rows[0].revenue, 1250);
  assert.equal(tables[1].sourceKind, 'excel');
});

void test('imports local Parquet rows with numeric and text columns', async () => {
  const bytes = parquetWriteBuffer({
    columnData: [
      { name: 'region', data: ['North', 'South'], type: 'STRING' },
      { name: 'revenue', data: [1200, 900], type: 'INT32' },
    ],
  });
  const file = new NodeFile([new Uint8Array(bytes)], 'sales.parquet');

  const [table] = await parseDataFile(file as unknown as File);

  assert.equal(table.sourceKind, 'parquet');
  assert.equal(table.rows.length, 2);
  assert.deepEqual(table.rows[0], { region: 'North', revenue: 1200 });
});
