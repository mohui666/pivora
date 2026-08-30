import assert from 'node:assert/strict';
import test from 'node:test';

import { createBlankReport, REPORT_TEMPLATES } from './report-templates';

void test('creates a complete empty report bundle for import-first work', () => {
  const report = createBlankReport();
  assert.equal(report.schemaVersion, 7);
  assert.equal(report.tables.length, 0);
  assert.equal(report.widgets.length, 0);
  assert.equal(report.pages.length, 1);
  assert.equal(report.pages[0].name, 'Page 1');
});

void test('creates isolated template reports with valid model references', () => {
  const reports = REPORT_TEMPLATES.map((template) => template.create());
  assert.equal(
    new Set(reports.map((report) => report.id)).size,
    reports.length,
  );
  for (const report of reports) {
    const pageIds = new Set(report.pages.map((page) => page.id));
    const tableIds = new Set(report.tables.map((table) => table.id));
    assert.ok(report.pages.length > 0);
    assert.ok(report.widgets.every((widget) => pageIds.has(widget.pageId)));
    assert.ok(report.widgets.every((widget) => tableIds.has(widget.tableId)));
  }
  const scenario = reports.at(-1);
  assert.equal(
    scenario?.widgets.find((widget) => widget.id === 'widget_revenue')?.measure,
    'scenario_revenue',
  );
});
