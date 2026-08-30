import assert from 'node:assert/strict';
import test from 'node:test';

import { upgradeReport } from './report-schema';
import { createSampleReport } from './sample-report';

void test('upgrades schema v2 reports with pages, themes, and visual defaults', () => {
  const current = createSampleReport();
  const legacy = {
    ...current,
    schemaVersion: 2,
    pages: undefined,
    bookmarks: undefined,
    theme: undefined,
    parameters: undefined,
    visualInteractions: undefined,
    columnMetadata: undefined,
    widgets: current.widgets.map((widget) =>
      Object.fromEntries(
        Object.entries(widget).filter(([key]) => key !== 'pageId'),
      ),
    ),
    filters: [
      {
        id: 'legacy-filter',
        tableId: current.tables[0].id,
        field: 'region',
        value: 'North',
        sourceWidgetId: current.widgets[0].id,
      },
    ],
  };

  const upgraded = upgradeReport(legacy);

  assert.equal(upgraded.schemaVersion, 7);
  assert.equal(upgraded.pages[0].name, 'Overview');
  assert.equal(upgraded.widgets[0].pageId, upgraded.pages[0].id);
  assert.equal(upgraded.widgets[0].sortDirection, 'none');
  assert.equal(upgraded.widgets[0].calculation, 'none');
  assert.equal(upgraded.widgets[0].topN, 20);
  assert.equal(upgraded.theme.id, 'ocean');
  assert.deepEqual(upgraded.measures, []);
  assert.deepEqual(upgraded.roleRules, []);
  assert.deepEqual(upgraded.parameters, []);
  assert.deepEqual(upgraded.visualInteractions, []);
  assert.deepEqual(upgraded.columnMetadata, []);
  assert.deepEqual(upgraded.pages[0].drillthroughFields, []);
  assert.equal(upgraded.pages[0].keepAllFilters, true);
  assert.equal(upgraded.filters[0].scope, 'interaction');
  assert.equal(upgraded.filters[0].operator, 'equals');
});

void test('upgrades legacy filters captured inside bookmarks', () => {
  const current = createSampleReport();
  const legacy = {
    ...current,
    schemaVersion: 4,
    bookmarks: [
      {
        id: 'bookmark',
        name: 'Legacy bookmark',
        pageId: current.pages[0].id,
        hiddenWidgetIds: [],
        createdAt: current.createdAt,
        filters: [
          {
            id: 'bookmark-filter',
            tableId: current.tables[0].id,
            field: 'region',
            value: 'North',
          },
        ],
      },
    ],
  };

  const upgraded = upgradeReport(legacy);
  assert.equal(upgraded.bookmarks[0].filters[0].operator, 'equals');
  assert.equal(upgraded.bookmarks[0].filters[0].scope, 'report');
});

void test('rejects unsupported report bundles', () => {
  assert.throws(
    () => upgradeReport({ schemaVersion: 99, tables: [], widgets: [] }),
    /not a supported Pivora report bundle/,
  );
});
