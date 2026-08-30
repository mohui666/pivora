import type {
  ChartWidget,
  ReportBookmark,
  ReportDocument,
  ReportFilter,
  ReportPage,
  RoleRule,
  ReportTheme,
} from './bi-types';

export const REPORT_THEMES: ReportTheme[] = [
  {
    id: 'ocean',
    name: 'Ocean',
    palette: ['#4f6df5', '#22b8a7', '#f2a43a', '#8b62e8', '#ef6a68'],
    canvas: '#f3f6fb',
  },
  {
    id: 'executive',
    name: 'Executive',
    palette: ['#1f2937', '#2563eb', '#64748b', '#d97706', '#0f766e'],
    canvas: '#f5f5f4',
  },
  {
    id: 'forest',
    name: 'Forest',
    palette: ['#15803d', '#65a30d', '#0f766e', '#a16207', '#4d7c0f'],
    canvas: '#f3f7f3',
  },
  {
    id: 'sunset',
    name: 'Sunset',
    palette: ['#e85d3f', '#f59e0b', '#db2777', '#7c3aed', '#0891b2'],
    canvas: '#fff7ed',
  },
  {
    id: 'mono',
    name: 'Monochrome',
    palette: ['#111827', '#374151', '#6b7280', '#9ca3af', '#d1d5db'],
    canvas: '#f4f4f5',
  },
];

type LegacyWidget = Omit<ChartWidget, 'pageId'> & { pageId?: string };
type LegacyPage = Omit<ReportPage, 'drillthroughFields' | 'keepAllFilters'> & {
  drillthroughFields?: ReportPage['drillthroughFields'];
  keepAllFilters?: boolean;
};
type LegacyFilter = Omit<ReportFilter, 'operator' | 'scope'> & {
  operator?: ReportFilter['operator'];
  scope?: ReportFilter['scope'];
};
type LegacyBookmark = Omit<ReportBookmark, 'filters'> & {
  filters: LegacyFilter[];
};
type LegacyReport = Omit<
  ReportDocument,
  | 'schemaVersion'
  | 'pages'
  | 'bookmarks'
  | 'theme'
  | 'widgets'
  | 'roleRules'
  | 'filters'
  | 'parameters'
> & {
  schemaVersion: 2 | 3 | 4 | 5;
  pages?: LegacyPage[];
  bookmarks?: LegacyBookmark[];
  theme?: ReportTheme;
  widgets: LegacyWidget[];
  querySteps?: ReportDocument['querySteps'];
  measures?: ReportDocument['measures'];
  roleRules?: RoleRule[];
  filters?: LegacyFilter[];
  parameters?: ReportDocument['parameters'];
};

export function upgradeReport(value: unknown): ReportDocument {
  if (!value || typeof value !== 'object') {
    throw new Error('This is not a Pivora report bundle.');
  }
  const candidate = value as Record<string, unknown>;
  if (
    ![2, 3, 4, 5].includes(Number(candidate.schemaVersion)) ||
    !Array.isArray(candidate.tables) ||
    !Array.isArray(candidate.widgets)
  ) {
    throw new Error('This is not a supported Pivora report bundle.');
  }

  const legacy = value as LegacyReport;
  const firstLegacyPage = legacy.pages?.[0];
  const page: ReportPage = firstLegacyPage
    ? {
        ...firstLegacyPage,
        drillthroughFields: firstLegacyPage.drillthroughFields ?? [],
        keepAllFilters: firstLegacyPage.keepAllFilters ?? true,
      }
    : {
        id: 'page_overview',
        name: 'Overview',
        hidden: false,
        background: REPORT_THEMES[0].canvas,
        drillthroughFields: [],
        keepAllFilters: true,
      };
  const pages: ReportPage[] = legacy.pages?.length
    ? legacy.pages.map((item) => ({
        ...item,
        drillthroughFields: item.drillthroughFields ?? [],
        keepAllFilters: item.keepAllFilters ?? true,
      }))
    : [page];
  const pageIds = new Set(pages.map((item) => item.id));
  const widgets = legacy.widgets.map((widget) => ({
    ...widget,
    pageId:
      widget.pageId && pageIds.has(widget.pageId) ? widget.pageId : page.id,
    sortDirection: widget.sortDirection ?? 'none',
    calculation: widget.calculation ?? 'none',
    topN: widget.topN ?? 20,
    hidden: widget.hidden ?? false,
    hierarchy: widget.hierarchy ?? [],
    drillLevel: widget.drillLevel ?? 0,
    conditionalFormatting: widget.conditionalFormatting ?? false,
    conditionalMinColor: widget.conditionalMinColor ?? '#dbeafe',
    conditionalMaxColor: widget.conditionalMaxColor ?? widget.color,
  }));
  const upgradeFilter = (filter: LegacyFilter): ReportFilter => ({
    ...filter,
    operator: filter.operator ?? 'equals',
    scope: filter.scope ?? (filter.sourceWidgetId ? 'interaction' : 'report'),
  });

  return {
    ...legacy,
    schemaVersion: 5,
    pages,
    bookmarks: (legacy.bookmarks ?? []).map((bookmark) => ({
      ...bookmark,
      filters: bookmark.filters.map(upgradeFilter),
    })),
    theme: legacy.theme ?? REPORT_THEMES[0],
    relationships: legacy.relationships.map((relationship) => ({
      ...relationship,
      cardinality: relationship.cardinality ?? 'many-to-one',
      crossFilterDirection: relationship.crossFilterDirection ?? 'single',
      active: relationship.active ?? true,
    })),
    transforms: legacy.transforms.map((transform) => ({
      ...transform,
      remove: transform.remove ?? false,
    })),
    querySteps: legacy.querySteps ?? [],
    parameters: legacy.parameters ?? [],
    measures: legacy.measures ?? [],
    roleRules: legacy.roleRules ?? [],
    filters: (legacy.filters ?? []).map(upgradeFilter),
    widgets,
  };
}
