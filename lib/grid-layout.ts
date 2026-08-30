import type { LayoutMode, WidgetLayout } from '@/lib/bi-types';

export const DASHBOARD_GRID_COLUMNS = 12;
export const MIN_WIDGET_WIDTH = 3;
export const MIN_WIDGET_HEIGHT = 3;
export const FREE_GRID_SCALE = 4;
export const FREE_GRID_EDGE_BUFFER = 8;

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
  if (mode === 'free') {
    return {
      x: Math.max(0, finiteInteger(layout.x, 0)),
      y: Math.max(0, finiteInteger(layout.y, 0)),
      w: Math.max(
        grid.minimumWidth,
        finiteInteger(layout.w, grid.minimumWidth),
      ),
      h: Math.max(
        grid.minimumHeight,
        finiteInteger(layout.h, grid.minimumHeight),
      ),
    };
  }
  return normalizeWidgetLayout(
    layout,
    grid.columns,
    grid.minimumWidth,
    grid.minimumHeight,
  );
}

/**
 * Freeform reports use a scrollable canvas that grows with their content. The
 * base 48-column viewport keeps snap/free conversion stable, while extra
 * columns extend the canvas without changing the visual's pixel position.
 */
export function resolveDashboardGridGeometry(
  mode: LayoutMode,
  viewportWidth: number,
  layouts: WidgetLayout[],
): { columns: number; width: number } {
  const safeViewportWidth = Math.max(1, finiteInteger(viewportWidth, 1));
  const grid = DASHBOARD_GRID_MODES[mode];
  if (mode === 'snap') {
    return { columns: grid.columns, width: safeViewportWidth };
  }

  const contentEdge = layouts.reduce(
    (maximum, layout) =>
      Math.max(
        maximum,
        normalizeWidgetLayoutForMode(layout, 'free').x +
          normalizeWidgetLayoutForMode(layout, 'free').w,
      ),
    0,
  );
  const columns = Math.max(
    grid.columns,
    Math.ceil(contentEdge + FREE_GRID_EDGE_BUFFER),
  );
  const horizontalMargin = grid.margin[0];
  const basePitch = (safeViewportWidth + horizontalMargin) / grid.columns;
  const width = Math.max(
    safeViewportWidth,
    Math.round(basePitch * columns - horizontalMargin),
  );

  return { columns, width };
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
