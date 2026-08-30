import Papa from 'papaparse';

import { normalizeRows } from './analytics';
import { makeTable } from './bi-model';
import type { DataTable, SourceKind } from './bi-types';

const MAX_ROWS = 250_000;

function limitRows(rows: Record<string, unknown>[]) {
  return {
    rows: normalizeRows(rows.slice(0, MAX_ROWS)),
    truncated: rows.length > MAX_ROWS,
  };
}

function tableFromRows(
  name: string,
  rows: Record<string, unknown>[],
  sourceKind: SourceKind,
  sourceName: string,
): DataTable {
  const limited = limitRows(rows);
  return {
    ...makeTable({ name, rows: limited.rows, sourceKind, sourceName }),
    truncated: limited.truncated,
  };
}

async function parseCsv(file: File): Promise<DataTable[]> {
  const text = await file.text();
  const result = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
  });
  if (result.errors.length && !result.data.length) {
    throw new Error(result.errors[0]?.message ?? 'CSV parsing failed.');
  }
  return [tableFromRows(file.name, result.data, 'csv', file.name)];
}

async function parseJson(file: File): Promise<DataTable[]> {
  const value = JSON.parse(await file.text()) as unknown;
  if (Array.isArray(value)) {
    return [
      tableFromRows(
        file.name,
        value as Record<string, unknown>[],
        'json',
        file.name,
      ),
    ];
  }
  if (value && typeof value === 'object') {
    const collections = Object.entries(value).filter(([, rows]) =>
      Array.isArray(rows),
    );
    if (!collections.length)
      throw new Error('JSON must contain an array of records.');
    return collections.map(([name, rows]) =>
      tableFromRows(name, rows as Record<string, unknown>[], 'json', file.name),
    );
  }
  throw new Error('JSON must contain an array of records.');
}

async function parseXml(file: File): Promise<DataTable[]> {
  const document = new DOMParser().parseFromString(
    await file.text(),
    'application/xml',
  );
  if (document.querySelector('parsererror')) {
    throw new Error('XML parsing failed.');
  }
  const root = document.documentElement;
  const records = Array.from(root.children).filter(
    (element) => element.children.length > 0,
  );
  if (!records.length) {
    throw new Error(
      'XML must contain a collection of record elements with fields.',
    );
  }
  const rows = records.map((record) =>
    Object.fromEntries(
      Array.from(record.children).map((field) => [
        field.tagName,
        field.textContent ?? null,
      ]),
    ),
  );
  return [tableFromRows(root.tagName, rows, 'xml', file.name)];
}

async function parseWorkbook(file: File): Promise<DataTable[]> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(await file.arrayBuffer());
  return workbook.SheetNames.map((sheetName) => {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook.Sheets[sheetName],
      { defval: null, raw: false },
    );
    return tableFromRows(sheetName, rows, 'excel', file.name);
  }).filter((table) => table.rows.length > 0);
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function parseSqlite(file: File): Promise<DataTable[]> {
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs({ locateFile: () => '/sql-wasm.wasm' });
  const database = new SQL.Database(new Uint8Array(await file.arrayBuffer()));
  try {
    const schema = database.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    const names = schema[0]?.values.map((value) => String(value[0])) ?? [];
    return names.map((name) => {
      const result = database.exec(
        `SELECT * FROM ${quoteIdentifier(name)} LIMIT ${MAX_ROWS + 1}`,
      )[0];
      const records = (result?.values ?? []).map((values) =>
        Object.fromEntries(
          result.columns.map((column, index) => [column, values[index]]),
        ),
      );
      return tableFromRows(name, records, 'sqlite', file.name);
    });
  } finally {
    database.close();
  }
}

export async function parseDataFile(file: File): Promise<DataTable[]> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'csv' || file.type === 'text/csv') return parseCsv(file);
  if (extension === 'json' || file.type === 'application/json')
    return parseJson(file);
  if (extension === 'xml' || file.type === 'application/xml')
    return parseXml(file);
  if (extension === 'xlsx' || extension === 'xls' || extension === 'xlsm') {
    return parseWorkbook(file);
  }
  if (extension === 'sqlite' || extension === 'sqlite3' || extension === 'db') {
    return parseSqlite(file);
  }
  throw new Error('Supported formats: CSV, JSON, XML, Excel, and SQLite.');
}
