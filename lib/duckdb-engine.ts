import * as duckdb from '@duckdb/duckdb-wasm';
import duckdbEh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import duckdbMvp from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';

import { normalizeRows, type DataRow } from './analytics';
import type { DataTable } from './bi-types';

export type LocalSqlResult = {
  columns: string[];
  rows: DataRow[];
  durationMs: number;
  truncated: boolean;
  engineVersion: string;
};

const MAX_SQL_ROWS = 10_000;
const bundles: duckdb.DuckDBBundles = {
  mvp: { mainModule: duckdbMvp, mainWorker: mvpWorker },
  eh: { mainModule: duckdbEh, mainWorker: ehWorker },
};

let enginePromise: Promise<duckdb.AsyncDuckDB> | undefined;
const loadedTableNames = new Set<string>();
const generatedModuleUrls = new Set<string>();
const ARROW_BIG_NUM = Symbol.for('isArrowBigNum');

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function jsonWithBigInts(value: unknown): string {
  return JSON.stringify(value, (_, nested) =>
    typeof nested === 'bigint' ? nested.toString() : nested,
  );
}

function normalizeArrowNumber(value: unknown, scale = 0): unknown {
  if (
    !value ||
    typeof value !== 'object' ||
    !(value as Record<symbol, unknown>)[ARROW_BIG_NUM]
  ) {
    return value;
  }

  const raw = (value as { toString(): string }).toString();
  const negative = raw.startsWith('-');
  const digits = negative ? raw.slice(1) : raw;
  const padded = digits.padStart(scale + 1, '0');
  const scaled = scale
    ? `${negative ? '-' : ''}${padded.slice(0, -scale)}.${padded.slice(-scale)}`
    : raw;
  const numeric = Number(scaled);
  return Number.isFinite(numeric) && digits.length <= 15 ? numeric : scaled;
}

function assertReadOnlySql(sql: string): string {
  const trimmed = sql.trim().replace(/;\s*$/, '');
  if (!trimmed) throw new Error('Enter a SQL query.');
  if (trimmed.includes(';')) {
    throw new Error('Run one read-only SQL statement at a time.');
  }
  if (!/^(select|with|show|describe|desc|explain)\b/i.test(trimmed)) {
    throw new Error(
      'The local workbench accepts SELECT, WITH, SHOW, DESCRIBE, and EXPLAIN statements only.',
    );
  }
  return trimmed;
}

async function resolveSplitWasmUrl(moduleUrl: string): Promise<string> {
  const manifestResponse = await fetch(`${moduleUrl}.parts.json`);
  if (!manifestResponse.ok) return moduleUrl;

  const manifest = (await manifestResponse.json()) as { count?: number };
  if (!Number.isInteger(manifest.count) || (manifest.count ?? 0) < 1) {
    return moduleUrl;
  }

  const partResponses = await Promise.all(
    Array.from({ length: manifest.count ?? 0 }, (_, index) =>
      fetch(`${moduleUrl}.part${index}`),
    ),
  );
  const failedPart = partResponses.findIndex((response) => !response.ok);
  if (failedPart !== -1) {
    throw new Error(`DuckDB WASM part ${failedPart + 1} could not be loaded.`);
  }

  const parts = await Promise.all(
    partResponses.map((response) => response.arrayBuffer()),
  );
  const generatedUrl = URL.createObjectURL(
    new Blob(parts, { type: 'application/wasm' }),
  );
  generatedModuleUrls.add(generatedUrl);
  return generatedUrl;
}

async function getEngine(): Promise<duckdb.AsyncDuckDB> {
  enginePromise ??= (async () => {
    const bundle = await duckdb.selectBundle(bundles);
    if (!bundle.mainWorker)
      throw new Error('No DuckDB worker bundle is available.');
    const worker = new Worker(bundle.mainWorker);
    const database = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    const mainModule = await resolveSplitWasmUrl(bundle.mainModule);
    await database.instantiate(mainModule, bundle.pthreadWorker);
    return database;
  })();
  return enginePromise;
}

async function hydrateTables(
  database: duckdb.AsyncDuckDB,
  tables: DataTable[],
) {
  const connection = await database.connect();
  try {
    for (const previous of loadedTableNames) {
      await connection.query(
        `DROP TABLE IF EXISTS ${quoteIdentifier(previous)}`,
      );
    }
    loadedTableNames.clear();
    await database.dropFiles();
    for (const table of tables) {
      // DuckDB cannot infer a schema from an empty JSON array. Empty model
      // tables stay in the report and become queryable as soon as they contain
      // at least one row.
      if (!table.rows.length) continue;
      const path = `pivora-${table.id}.json`;
      await database.registerFileText(path, jsonWithBigInts(table.rows));
      await connection.insertJSONFromPath(path, {
        schema: 'main',
        name: table.name,
      });
      loadedTableNames.add(table.name);
    }
  } finally {
    await connection.close();
  }
}

export async function runLocalSql(
  tables: DataTable[],
  sql: string,
): Promise<LocalSqlResult> {
  const query = assertReadOnlySql(sql);
  const database = await getEngine();
  await hydrateTables(database, tables);
  const connection = await database.connect();
  const startedAt = performance.now();
  try {
    const executable = /^(select|with)\b/i.test(query)
      ? `SELECT * FROM (${query}) AS __pivora_result LIMIT ${MAX_SQL_ROWS + 1}`
      : query;
    const result = await connection.query(executable);
    const fields = result.schema.fields;
    const rawRows = result.toArray().map((row) => {
      const raw = row.toJSON();
      return Object.fromEntries(
        fields.map((field) => [
          field.name,
          normalizeArrowNumber(
            raw[field.name],
            (field.type as { scale?: number }).scale ?? 0,
          ),
        ]),
      );
    });
    const truncated = rawRows.length > MAX_SQL_ROWS;
    const rows = normalizeRows(rawRows.slice(0, MAX_SQL_ROWS));
    return {
      columns: fields.map((field) => field.name),
      rows,
      durationMs: performance.now() - startedAt,
      truncated,
      engineVersion: await database.getVersion(),
    };
  } finally {
    await connection.close();
  }
}

export async function resetLocalSqlEngine(): Promise<void> {
  if (!enginePromise) return;
  const database = await enginePromise;
  await database.terminate();
  enginePromise = undefined;
  loadedTableNames.clear();
  for (const url of generatedModuleUrls) URL.revokeObjectURL(url);
  generatedModuleUrls.clear();
}
