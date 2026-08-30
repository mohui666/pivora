import assert from 'node:assert/strict';
import test from 'node:test';

import { getCompactor, type Layout } from 'react-grid-layout';

import {
  convertWidgetLayoutMode,
  DASHBOARD_GRID_MODES,
  MIN_WIDGET_HEIGHT,
  MIN_WIDGET_WIDTH,
  normalizeWidgetLayout,
  normalizeWidgetLayoutForMode,
  resolveDashboardGridGeometry,
} from './grid-layout';

void test('normalizes interrupted resize geometry to a visible card', () => {
  assert.deepEqual(
    normalizeWidgetLayout({ x: Number.NaN, y: -9, w: 0, h: -2 }),
    { x: 0, y: 0, w: MIN_WIDGET_WIDTH, h: MIN_WIDGET_HEIGHT },
  );
});

void test('converts between snap and fine-grained free placement', () => {
  const snap = { x: 2, y: 3, w: 6, h: 7 };
  const free = convertWidgetLayoutMode(snap, 'snap', 'free');
  assert.deepEqual(free, { x: 8, y: 12, w: 24, h: 28 });
  assert.deepEqual(convertWidgetLayoutMode(free, 'free', 'snap'), snap);
  assert.equal(DASHBOARD_GRID_MODES.free.columns, 48);
});

void test('free placement preserves overlapping visual positions', () => {
  const mode = DASHBOARD_GRID_MODES.free;
  const compactor = getCompactor(
    null,
    mode.allowOverlap,
    mode.preventCollision,
  );
  const overlapping: Layout = [
    { i: 'front', x: 4, y: 5, w: 16, h: 16 },
    { i: 'back', x: 4, y: 5, w: 16, h: 16 },
  ];

  assert.equal(compactor.allowOverlap, true);
  assert.equal(mode.preventCollision, false);
  assert.notEqual(compactor.preventCollision, true);
  assert.deepEqual(
    compactor
      .compact(overlapping, mode.columns)
      .map(({ i, x, y, w, h }) => ({ i, x, y, w, h })),
    overlapping,
  );
});

void test('free placement preserves positions beyond the initial viewport', () => {
  const outsideInitialGrid = { x: 73, y: 6, w: 20, h: 18 };
  assert.deepEqual(
    normalizeWidgetLayoutForMode(outsideInitialGrid, 'free'),
    outsideInitialGrid,
  );

  const geometry = resolveDashboardGridGeometry('free', 704, [
    outsideInitialGrid,
  ]);
  assert.equal(geometry.columns, 101);
  assert.ok(geometry.width > 704);
  assert.deepEqual(resolveDashboardGridGeometry('snap', 704, []), {
    columns: 12,
    width: 704,
  });
});

void test('keeps resized cards inside the available columns', () => {
  assert.deepEqual(normalizeWidgetLayout({ x: 11, y: 2.4, w: 8, h: 6.7 }), {
    x: 4,
    y: 2,
    w: 8,
    h: 7,
  });
  assert.deepEqual(
    normalizeWidgetLayout(
      { x: Number.POSITIVE_INFINITY, y: 1, w: 40, h: 4 },
      2,
    ),
    { x: 0, y: 1, w: 2, h: 4 },
  );
});
