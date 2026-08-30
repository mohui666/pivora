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
    layoutMode: undefined,
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

  assert.equal(upgraded.schemaVersion, 8);
  assert.equal(upgraded.layoutMode, 'snap');
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

void test('repairs corrupted legacy geometry while preserving free layouts', () => {
  const current = createSampleReport();
  const repaired = upgradeReport({
    ...current,
    schemaVersion: 7,
    layoutMode: undefined,
    widgets: current.widgets.map((widget, index) =>
      index
        ? widget
        : {
            ...widget,
            measure: '__rows',
            numberFormat: 'currency',
            layout: { x: 99, y: -4, w: 300, h: 0 },
          },
    ),
  });
  assert.deepEqual(repaired.widgets[0].layout, { x: 0, y: 0, w: 12, h: 3 });
  assert.equal(repaired.widgets[0].numberFormat, 'standard');

  const free = upgradeReport({
    ...current,
    schemaVersion: 8,
    layoutMode: 'free',
    widgets: current.widgets.map((widget, index) =>
      index ? widget : { ...widget, layout: { x: 7, y: 5, w: 24, h: 20 } },
    ),
  });
  assert.equal(free.layoutMode, 'free');
  assert.deepEqual(free.widgets[0].layout, { x: 7, y: 5, w: 24, h: 20 });
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
