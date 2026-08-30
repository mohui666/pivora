import type { LayoutMode, WidgetLayout } from '@/lib/bi-types';

export const DASHBOARD_GRID_COLUMNS = 12;
export const MIN_WIDGET_WIDTH = 3;
export const MIN_WIDGET_HEIGHT = 3;
export const FREE_GRID_SCALE = 4;

export const DASHBOARD_GRID_MODES = {
  snap: {
    columns: DASHBOARD_GRID_COLUMNS,
    rowHeight: 34,
    margin: [12, 12] as const,
    minimumWidth: MIN_WIDGET_WIDTH,
    minimumHeight: MIN_WIDGET_HEIGHT,
    allowOverlap: false,
    preventCollision: false,
  },
  free: {
    columns: DASHBOARD_GRID_COLUMNS * FREE_GRID_SCALE,
    rowHeight: 8,
    margin: [3, 3] as const,
    minimumWidth: MIN_WIDGET_WIDTH * FREE_GRID_SCALE,
    minimumHeight: MIN_WIDGET_HEIGHT * FREE_GRID_SCALE,
    allowOverlap: true,
    preventCollision: false,
  },
} satisfies Record<
  LayoutMode,
  {
    columns: number;
    rowHeight: number;
    margin: readonly [number, number];
    minimumWidth: number;
    minimumHeight: number;
    allowOverlap: boolean;
    preventCollision: boolean;
  }
>;

function finiteInteger(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.round(value) : fallback;
}

/**
 * Keeps persisted visual geometry inside the dashboard grid. Pointer events can
 * occasionally be interrupted by a window resize or a view switch; never let
 * a partial geometry update make the visual unreachable afterwards.
 */
export function normalizeWidgetLayout(
  layout: WidgetLayout,
  columns = DASHBOARD_GRID_COLUMNS,
  minimumWidth = MIN_WIDGET_WIDTH,
  minimumHeight = MIN_WIDGET_HEIGHT,
): WidgetLayout {
  const safeColumns = Math.max(
    1,
    finiteInteger(columns, DASHBOARD_GRID_COLUMNS),
  );
  const safeMinimumWidth = Math.min(
    Math.max(1, finiteInteger(minimumWidth, MIN_WIDGET_WIDTH)),
    safeColumns,
  );
  const width = Math.min(
    safeColumns,
    Math.max(safeMinimumWidth, finiteInteger(layout.w, safeMinimumWidth)),
  );
  const height = Math.max(
    Math.max(1, finiteInteger(minimumHeight, MIN_WIDGET_HEIGHT)),
    finiteInteger(layout.h, minimumHeight),
  );
  const maximumX = Math.max(0, safeColumns - width);

  return {
    x: Math.min(maximumX, Math.max(0, finiteInteger(layout.x, 0))),
    y: Math.max(0, finiteInteger(layout.y, 0)),
    w: width,
    h: height,
  };
}

export function normalizeWidgetLayoutForMode(
  layout: WidgetLayout,
  mode: LayoutMode,
): WidgetLayout {
  const grid = DASHBOARD_GRID_MODES[mode];
  return normalizeWidgetLayout(
    layout,
    grid.columns,
    grid.minimumWidth,
    grid.minimumHeight,
  );
}

export function convertWidgetLayoutMode(
  layout: WidgetLayout,
  from: LayoutMode,
  to: LayoutMode,
): WidgetLayout {
  if (from === to) return normalizeWidgetLayoutForMode(layout, to);
  const multiplier = to === 'free' ? FREE_GRID_SCALE : 1 / FREE_GRID_SCALE;
  return normalizeWidgetLayoutForMode(
    {
      x: layout.x * multiplier,
      y: layout.y * multiplier,
      w: layout.w * multiplier,
      h: layout.h * multiplier,
    },
    to,
  );
}
