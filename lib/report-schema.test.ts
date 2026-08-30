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
    widgets: current.widgets.map((widget) =>
      Object.fromEntries(
        Object.entries(widget).filter(([key]) => key !== 'pageId'),
      ),
    ),
  };

  const upgraded = upgradeReport(legacy);

  assert.equal(upgraded.schemaVersion, 3);
  assert.equal(upgraded.pages[0].name, 'Overview');
  assert.equal(upgraded.widgets[0].pageId, upgraded.pages[0].id);
  assert.equal(upgraded.widgets[0].sortDirection, 'none');
  assert.equal(upgraded.widgets[0].calculation, 'none');
  assert.equal(upgraded.widgets[0].topN, 20);
  assert.equal(upgraded.theme.id, 'ocean');
});

void test('rejects unsupported report bundles', () => {
  assert.throws(
    () => upgradeReport({ schemaVersion: 99, tables: [], widgets: [] }),
    /not a supported LocalLens BI report bundle/,
  );
});
