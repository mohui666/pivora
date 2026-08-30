import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertReadOnlyOdbcSql,
  listOdbcSources,
  normalizeOdbcQueryRequest,
  redactConnectorSecrets,
} from './odbc-bridge.mjs';

void test('allows one SELECT or WITH statement with literals and comments', () => {
  assert.equal(
    assertReadOnlyOdbcSql("SELECT ';' AS value -- harmless ;\nFROM [orders];"),
    "SELECT ';' AS value -- harmless ;\nFROM [orders]",
  );
  assert.equal(
    assertReadOnlyOdbcSql('WITH rows AS (SELECT 1 AS id) SELECT * FROM rows'),
    'WITH rows AS (SELECT 1 AS id) SELECT * FROM rows',
  );
});

void test('rejects write-capable and multi-statement ODBC SQL', () => {
  for (const query of [
    'DELETE FROM orders',
    'SELECT * INTO copied_orders FROM orders',
    'WITH removed AS (DELETE FROM orders RETURNING *) SELECT * FROM removed',
    'SELECT 1; SELECT 2',
    "SELECT 'unterminated",
  ]) {
    assert.throws(() => assertReadOnlyOdbcSql(query));
  }
});

void test('bounds ODBC row and command limits before crossing IPC', () => {
  assert.deepEqual(
    normalizeOdbcQueryRequest({
      connectionString: 'DSN=Warehouse',
      query: 'SELECT * FROM facts',
      maxRows: 999_999,
      commandTimeoutSeconds: 1,
    }),
    {
      connectionString: 'DSN=Warehouse',
      query: 'SELECT * FROM facts',
      maxRows: 100_000,
      commandTimeoutSeconds: 5,
    },
  );
});

void test('redacts connection secrets from bridge failures', () => {
  assert.equal(
    redactConnectorSecrets('PWD=hunter2;Token=visible, Password={also hidden}'),
    'PWD=[redacted];Token=[redacted], Password=[redacted]',
  );
});

void test(
  'enumerates Windows ODBC sources through the real bridge',
  { skip: process.platform !== 'win32' },
  async () => {
    const result = await listOdbcSources();
    assert.equal(result.available, true);
    assert.ok(Array.isArray(result.sources));
    assert.ok(Array.isArray(result.drivers));
  },
);
