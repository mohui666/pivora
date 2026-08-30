'use client';

import { toPng } from 'html-to-image';
import {
  ArrowUpFromLine,
  ArrowDownToLine,
  Activity,
  BookmarkPlus,
  BookOpen,
  Calculator,
  Copy,
  Database,
  FileDown,
  FilePlus2,
  FileSpreadsheet,
  Filter,
  FolderOpen,
  Globe2,
  GripHorizontal,
  ImageDown,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Moon,
  PanelRight,
  PencilRuler,
  Plus,
  RefreshCw,
  Redo2,
  Save,
  Settings2,
  Share2,
  SquareTerminal,
  Sun,
  Table2,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import ReactGridLayout, {
  type Layout,
  useContainerWidth,
  verticalCompactor,
} from 'react-grid-layout';

import { ChartVisual } from '@/components/bi/chart-visual';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  aggregateRows,
  applyQuickCalculation,
  type Aggregation,
  inferFields,
  profileColumn,
  type QuickCalculation,
} from '@/lib/analytics';
import {
  analyzeRelationship,
  createId,
  filterRows,
  filtersForContext,
  filtersForDrillthrough,
  makeTable,
  materializedFields,
  materializeTable,
  validateCalculatedExpression,
  validateRelationship,
} from '@/lib/bi-model';
import type {
  CalculatedField,
  ChartKind,
  ChartWidget,
  ColumnTransform,
  DataTable,
  NumberFormat,
  QueryStep,
  Relationship,
  ReportDocument,
  ReportFilter,
  ReportPage,
  ReportParameter,
  ReportRole,
  ReportSummary,
  RoleRule,
  SemanticMeasure,
} from '@/lib/bi-types';
import { parseDataFile } from '@/lib/data-import';
import { REPORT_THEMES, upgradeReport } from '@/lib/report-schema';
import {
  deleteReport,
  listReports,
  loadReport,
  saveReport,
} from '@/lib/report-storage';
import { createSampleReport } from '@/lib/sample-report';
import type { LocalSqlResult } from '@/lib/duckdb-engine';

type View = 'dashboard' | 'data' | 'model' | 'sql';
type LocalFileHandle = { name: string; getFile: () => Promise<File> };
type VisualPerformance = {
  durationMs: number;
  inputRows: number;
  outputPoints: number;
  measuredAt: string;
};

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function defaultWidget(
  table: DataTable,
  rows: DataTable['rows'],
  y: number,
  pageId: string,
): ChartWidget {
  const fields = inferFields(rows);
  const dimension =
    fields.find((field) => field.kind !== 'number') ?? fields[0];
  const measure = fields.find((field) => field.kind === 'number');
  return {
    id: createId('widget'),
    pageId,
    title: `New visual · ${table.name}`,
    tableId: table.id,
    kind: measure ? 'bar' : 'table',
    dimension: dimension?.name ?? '',
    measure: measure?.name ?? '__rows',
    aggregation: measure ? 'sum' : 'count',
    calculation: 'none',
    color: '#4f6df5',
    showGrid: true,
    showLegend: false,
    numberFormat: 'compact',
    interactions: true,
    layout: { x: 0, y, w: 6, h: 7 },
  };
}

function describeQueryStep(step: QueryStep): string {
  if (step.kind === 'filter')
    return `${step.field} · ${step.operator} ${step.value}`;
  if (step.kind === 'sort') return `${step.field} · ${step.direction}`;
  if (step.kind === 'remove-duplicates') return step.field;
  if (step.kind === 'limit') return `${step.count} rows`;
  if (step.kind === 'add-index') return `${step.name} from ${step.start}`;
  if (step.kind === 'replace-values')
    return `${step.field}: ${step.value} → ${step.replacement ?? ''}`;
  if (step.kind === 'rename-column') return `${step.field} → ${step.name}`;
  if (step.kind === 'split-column')
    return `${step.field} by “${step.separator || ','}”`;
  if (step.kind === 'custom-column') return `${step.name} = ${step.value}`;
  return `${step.field} · ${step.aggregation ?? 'sum'}(${step.targetField}) → ${step.name}`;
}

function formatProfileValue(value: number | undefined): string {
  return value === undefined
    ? '—'
    : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function effectiveDimension(widget: ChartWidget): string {
  return (
    widget.hierarchy?.[
      Math.min(widget.drillLevel ?? 0, widget.hierarchy.length - 1)
    ] ?? widget.dimension
  );
}

type ReportHistory = {
  past: ReportDocument[];
  present: ReportDocument;
  future: ReportDocument[];
};

export default function Home() {
  const [history, setHistory] = useState<ReportHistory>(() => ({
    past: [],
    present: createSampleReport(),
    future: [],
  }));
  const report = history.present;
  const [view, setView] = useState<View>('dashboard');
  const [activePageId, setActivePageId] = useState('page_overview');
  const [activeTableId, setActiveTableId] = useState('table_sales');
  const [selectedWidgetId, setSelectedWidgetId] = useState('widget_revenue');
  const [dark, setDark] = useState(false);
  const [notice, setNotice] = useState('');
  const [importing, setImporting] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showPerformance, setShowPerformance] = useState(false);
  const [showFilterPane, setShowFilterPane] = useState(false);
  const [performanceProfiles, setPerformanceProfiles] = useState<
    Record<string, VisualPerformance>
  >({});
  const [savedReports, setSavedReports] = useState<ReportSummary[]>([]);
  const [dataPage, setDataPage] = useState(0);
  const [dataSearch, setDataSearch] = useState('');
  const [profileField, setProfileField] = useState('revenue');
  const [sqlText, setSqlText] = useState(
    'SELECT region, SUM(revenue) AS revenue\nFROM "Sales"\nGROUP BY region\nORDER BY revenue DESC',
  );
  const [sqlResult, setSqlResult] = useState<LocalSqlResult>();
  const [sqlError, setSqlError] = useState('');
  const [sqlRunning, setSqlRunning] = useState(false);
  const [sqlHistory, setSqlHistory] = useState<string[]>([]);
  const [showWebConnector, setShowWebConnector] = useState(false);
  const [webUrl, setWebUrl] = useState('');
  const [webTableName, setWebTableName] = useState('');
  const [webHeaders, setWebHeaders] = useState('');
  const [webLoading, setWebLoading] = useState(false);
  const [filterDraft, setFilterDraft] = useState<
    Pick<ReportFilter, 'tableId' | 'field' | 'operator' | 'value' | 'scope'>
  >({
    tableId: 'table_sales',
    field: 'region',
    operator: 'equals',
    value: 'North',
    scope: 'report',
  });
  const [relationDraft, setRelationDraft] = useState<Omit<Relationship, 'id'>>({
    leftTableId: 'table_sales',
    leftField: 'product_id',
    rightTableId: 'table_products',
    rightField: 'product_id',
    cardinality: 'many-to-one',
    crossFilterDirection: 'single',
    active: true,
  });
  const [roleRuleDraft, setRoleRuleDraft] = useState<
    Omit<RoleRule, 'id' | 'enabled'>
  >({
    role: 'viewer',
    tableId: 'table_sales',
    field: 'region',
    operator: 'equals',
    value: 'North',
  });
  const [calcDraft, setCalcDraft] = useState({
    tableId: 'table_sales',
    name: '',
    expression: '',
  });
  const [parameterDraft, setParameterDraft] = useState<
    Omit<ReportParameter, 'id'>
  >({
    name: '',
    minimum: 0,
    maximum: 100,
    step: 1,
    value: 10,
  });
  const [drillthroughDraft, setDrillthroughDraft] = useState({
    tableId: 'table_sales',
    field: 'region',
  });
  const [measureDraft, setMeasureDraft] = useState<Omit<SemanticMeasure, 'id'>>(
    {
      tableId: 'table_sales',
      name: '',
      field: 'revenue',
      aggregation: 'sum',
      calculation: 'none',
      numberFormat: 'compact',
    },
  );
  const [queryDraft, setQueryDraft] = useState<
    Pick<
      QueryStep,
      | 'kind'
      | 'field'
      | 'operator'
      | 'value'
      | 'direction'
      | 'count'
      | 'name'
      | 'start'
      | 'replacement'
      | 'separator'
      | 'targetField'
      | 'aggregation'
    >
  >({
    kind: 'filter',
    field: 'order_id',
    operator: 'contains',
    value: '',
    direction: 'ascending',
    count: 1000,
    name: 'Index',
    start: 1,
    replacement: '',
    separator: ',',
    targetField: 'revenue',
    aggregation: 'sum',
  });
  const dataInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const reportInput = useRef<HTMLInputElement>(null);
  const dashboardRef = useRef<HTMLDivElement>(null);
  const fileHandles = useRef(new Map<string, LocalFileHandle>());
  const {
    width: gridWidth,
    containerRef: gridContainerRef,
    mounted: gridMounted,
  } = useContainerWidth({ initialWidth: 1100 });

  const canEdit = report.role !== 'viewer';
  const canManage = report.role === 'owner';
  const activeTable =
    report.tables.find((table) => table.id === activeTableId) ??
    report.tables[0];
  const selectedWidget = report.widgets.find(
    (widget) => widget.id === selectedWidgetId,
  );
  const selectedSemanticMeasure = report.measures.find(
    (measure) => measure.id === selectedWidget?.measure,
  );
  const activePage =
    report.pages.find((page) => page.id === activePageId) ?? report.pages[0];
  const pageWidgets = report.widgets.filter(
    (widget) => widget.pageId === activePage?.id && !widget.hidden,
  );

  const updateReport = useCallback(
    (updater: (current: ReportDocument) => ReportDocument) => {
      setHistory((current) => {
        const next = updater(current.present);
        if (next === current.present) return current;
        return {
          past: [...current.past, current.present].slice(-60),
          present: { ...next, updatedAt: new Date().toISOString() },
          future: [],
        };
      });
    },
    [],
  );

  function replaceReport(next: ReportDocument) {
    setHistory({ past: [], present: upgradeReport(next), future: [] });
  }

  function undo() {
    setHistory((current) => {
      const previous = current.past.at(-1);
      if (!previous) return current;
      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future].slice(0, 60),
      };
    });
  }

  function redo() {
    setHistory((current) => {
      const next = current.future[0];
      if (!next) return current;
      return {
        past: [...current.past, current.present].slice(-60),
        present: next,
        future: current.future.slice(1),
      };
    });
  }

  function selectPage(pageId: string) {
    setActivePageId(pageId);
    const first = report.widgets.find(
      (widget) => widget.pageId === pageId && !widget.hidden,
    );
    setSelectedWidgetId(first?.id ?? '');
  }

  function addPage() {
    if (!canEdit) return;
    const page: ReportPage = {
      id: createId('page'),
      name: `Page ${report.pages.length + 1}`,
      hidden: false,
      background: report.theme.canvas,
      drillthroughFields: [],
      keepAllFilters: true,
    };
    updateReport((current) => ({
      ...current,
      pages: [...current.pages, page],
    }));
    setActivePageId(page.id);
    setSelectedWidgetId('');
  }

  function duplicatePage() {
    if (!canEdit || !activePage) return;
    const page: ReportPage = {
      ...activePage,
      id: createId('page'),
      name: `${activePage.name} copy`,
    };
    const copies = report.widgets
      .filter((widget) => widget.pageId === activePage.id)
      .map((widget) => ({
        ...widget,
        id: createId('widget'),
        pageId: page.id,
        layout: { ...widget.layout },
      }));
    updateReport((current) => ({
      ...current,
      pages: [...current.pages, page],
      widgets: [...current.widgets, ...copies],
    }));
    setActivePageId(page.id);
    setSelectedWidgetId(copies[0]?.id ?? '');
  }

  function removePage() {
    if (!canEdit || !activePage) return;
    if (report.pages.length === 1) {
      showNotice('A report must contain at least one page.');
      return;
    }
    const next = report.pages.find((page) => page.id !== activePage.id);
    const removedWidgetIds = new Set(
      report.widgets
        .filter((widget) => widget.pageId === activePage.id)
        .map((widget) => widget.id),
    );
    updateReport((current) => ({
      ...current,
      pages: current.pages.filter((page) => page.id !== activePage.id),
      widgets: current.widgets.filter(
        (widget) => widget.pageId !== activePage.id,
      ),
      bookmarks: current.bookmarks.filter(
        (bookmark) => bookmark.pageId !== activePage.id,
      ),
      filters: current.filters.filter(
        (filter) =>
          filter.pageId !== activePage.id &&
          !removedWidgetIds.has(filter.widgetId ?? '') &&
          !Array.from(removedWidgetIds).some((widgetId) =>
            filter.sourceWidgetId?.startsWith(widgetId),
          ),
      ),
    }));
    if (next) selectPage(next.id);
  }

  function addBookmark() {
    if (!canEdit || !activePage) return;
    updateReport((current) => ({
      ...current,
      bookmarks: [
        ...current.bookmarks,
        {
          id: createId('bookmark'),
          name: `Bookmark ${current.bookmarks.length + 1}`,
          pageId: activePage.id,
          filters: current.filters.map((filter) => ({ ...filter })),
          hiddenWidgetIds: current.widgets
            .filter((widget) => widget.hidden)
            .map((widget) => widget.id),
          createdAt: new Date().toISOString(),
        },
      ],
    }));
    showNotice('Bookmark captured with page, filters, and visibility.');
  }

  function applyBookmark(bookmarkId: string) {
    const bookmark = report.bookmarks.find((item) => item.id === bookmarkId);
    if (!bookmark) return;
    setActivePageId(bookmark.pageId);
    updateReport((current) => ({
      ...current,
      filters: bookmark.filters.map((filter) => ({ ...filter })),
      widgets: current.widgets.map((widget) => ({
        ...widget,
        hidden: bookmark.hiddenWidgetIds.includes(widget.id),
      })),
    }));
  }

  function applyTheme(themeId: string) {
    const theme = REPORT_THEMES.find((item) => item.id === themeId);
    if (!theme) return;
    updateReport((current) => ({
      ...current,
      theme,
      pages: current.pages.map((page) => ({
        ...page,
        background: theme.canvas,
      })),
      widgets: current.widgets.map((widget, index) => ({
        ...widget,
        color: theme.palette[index % theme.palette.length],
      })),
    }));
  }

  function addManualFilter() {
    if (!canEdit) return;
    if (!filterDraft.field) return showNotice('Choose a field to filter.');
    if (filterDraft.scope === 'visual' && !selectedWidget) {
      return showNotice('Select a visual before adding a visual filter.');
    }
    const filter: ReportFilter = {
      id: createId('filter'),
      ...filterDraft,
      scope: filterDraft.scope,
      pageId: filterDraft.scope === 'page' ? activePage?.id : undefined,
      widgetId: filterDraft.scope === 'visual' ? selectedWidget?.id : undefined,
    };
    updateReport((current) => ({
      ...current,
      filters: [
        ...current.filters.filter(
          (candidate) =>
            candidate.scope === 'interaction' ||
            candidate.scope !== filter.scope ||
            candidate.tableId !== filter.tableId ||
            candidate.field !== filter.field ||
            candidate.pageId !== filter.pageId ||
            candidate.widgetId !== filter.widgetId,
        ),
        filter,
      ],
    }));
    showNotice(`${filter.scope} filter applied.`);
  }

  function addDrillthroughField() {
    if (!canEdit || !activePage || !drillthroughDraft.field) return;
    if (
      activePage.drillthroughFields.some(
        (item) =>
          item.tableId === drillthroughDraft.tableId &&
          item.field === drillthroughDraft.field,
      )
    ) {
      return showNotice('That drillthrough field is already configured.');
    }
    updateReport((current) => ({
      ...current,
      pages: current.pages.map((page) =>
        page.id === activePage.id
          ? {
              ...page,
              drillthroughFields: [
                ...page.drillthroughFields,
                { id: createId('drillthrough'), ...drillthroughDraft },
              ],
            }
          : page,
      ),
    }));
    showNotice('Drillthrough field added to this page.');
  }

  function openDrillthrough(page: ReportPage, sourceFilter: ReportFilter) {
    updateReport((current) => ({
      ...current,
      filters: filtersForDrillthrough(
        current.filters,
        activePage?.id ?? '',
        selectedWidgetId,
        page.id,
        sourceFilter.id,
        page.keepAllFilters,
      ),
    }));
    selectPage(page.id);
    setView('dashboard');
    showNotice(`Drilled through to ${page.name}.`);
  }

  const materialized = useMemo(() => {
    const map = new Map<string, DataTable['rows']>();
    for (const table of report.tables) {
      map.set(
        table.id,
        materializeTable({
          tableId: table.id,
          tables: report.tables,
          relationships: report.relationships,
          calculatedFields: report.calculatedFields,
          transforms: report.transforms,
          querySteps: report.querySteps,
          parameters: report.parameters,
        }),
      );
    }
    return map;
  }, [
    report.calculatedFields,
    report.parameters,
    report.relationships,
    report.tables,
    report.transforms,
    report.querySteps,
  ]);

  const fieldsFor = useCallback(
    (tableId: string) => materializedFields(materialized.get(tableId) ?? []),
    [materialized],
  );

  const relationshipDiagnostics = useMemo(
    () =>
      new Map(
        report.relationships.map((relationship) => [
          relationship.id,
          analyzeRelationship(relationship, report.tables),
        ]),
      ),
    [report.relationships, report.tables],
  );

  const pointsFor = useCallback(
    (widget: ChartWidget) => {
      const rows = materialized.get(widget.tableId) ?? [];
      const filters = filtersForContext(
        report.filters,
        widget.pageId,
        widget.id,
      );
      const filtered = filterRows(
        rows,
        filters,
        widget.tableId,
        report.tables,
        report.roleRules,
        report.role,
      );
      const dimension = effectiveDimension(widget);
      const dimensionKind =
        fieldsFor(widget.tableId).find((field) => field.name === dimension)
          ?.kind ?? 'text';
      const semanticMeasure = report.measures.find(
        (measure) => measure.id === widget.measure,
      );
      let points = aggregateRows({
        rows: filtered,
        dimension,
        dimensionKind,
        measure: semanticMeasure?.field ?? widget.measure,
        aggregation: semanticMeasure?.aggregation ?? widget.aggregation,
      });
      points = applyQuickCalculation(
        points,
        semanticMeasure?.calculation ?? widget.calculation,
      );
      if (widget.sortDirection !== 'none') {
        const direction = widget.sortDirection === 'ascending' ? 1 : -1;
        points = [...points].sort((a, b) => (a.value - b.value) * direction);
      }
      return points.slice(0, Math.max(1, widget.topN ?? 20));
    },
    [
      fieldsFor,
      materialized,
      report.filters,
      report.measures,
      report.role,
      report.roleRules,
      report.tables,
    ],
  );

  function openPerformanceAnalyzer() {
    const profiles: Record<string, VisualPerformance> = {};
    for (const widget of pageWidgets) {
      const startedAt = performance.now();
      const points = pointsFor(widget);
      profiles[widget.id] = {
        durationMs: performance.now() - startedAt,
        inputRows: materialized.get(widget.tableId)?.length ?? 0,
        outputPoints: points.length,
        measuredAt: new Date().toISOString(),
      };
    }
    setPerformanceProfiles(profiles);
    setShowPerformance(true);
  }

  const refreshLibrary = useCallback(async () => {
    setSavedReports(await listReports());
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void saveReport(report).then(refreshLibrary);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [refreshLibrary, report]);

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3600);
  }

  async function mergeFiles(
    files: File[],
    handles: LocalFileHandle[] = [],
    silent = false,
  ) {
    if (!files.length) return;
    setImporting(true);
    try {
      const imported: DataTable[] = [];
      for (const file of files) imported.push(...(await parseDataFile(file)));
      for (const handle of handles)
        fileHandles.current.set(handle.name, handle);
      updateReport((current) => {
        const sourceNames = new Set(files.map((file) => file.name));
        const retained = current.tables.filter(
          (table) => !sourceNames.has(table.sourceName),
        );
        const reconciled = imported.map((table) => {
          const existing = current.tables.find(
            (candidate) =>
              candidate.sourceName === table.sourceName &&
              candidate.name === table.name,
          );
          return existing ? { ...table, id: existing.id } : table;
        });
        const tables = [...retained, ...reconciled];
        let widgets = current.widgets;
        if (!widgets.length && reconciled[0]) {
          widgets = [
            defaultWidget(
              reconciled[0],
              reconciled[0].rows,
              0,
              current.pages[0]?.id ?? 'page_overview',
            ),
          ];
        }
        return { ...current, tables, widgets };
      });
      const firstExisting = report.tables.find(
        (table) =>
          table.sourceName === imported[0]?.sourceName &&
          table.name === imported[0]?.name,
      );
      setActiveTableId(firstExisting?.id ?? imported[0]?.id ?? activeTableId);
      if (!silent) {
        const rowCount = imported.reduce(
          (sum, table) => sum + table.rows.length,
          0,
        );
        showNotice(
          `Imported ${imported.length} table(s), ${rowCount.toLocaleString()} rows.`,
        );
      }
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Import failed.');
    } finally {
      setImporting(false);
    }
  }

  async function importWebSource() {
    if (!canEdit || !webUrl.trim()) return;
    setWebLoading(true);
    try {
      const parsedUrl = new URL(webUrl.trim());
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('Web connectors require an HTTP or HTTPS URL.');
      }

      let headers: Record<string, string> | undefined;
      if (webHeaders.trim()) {
        const candidate = JSON.parse(webHeaders) as unknown;
        if (
          !candidate ||
          typeof candidate !== 'object' ||
          Array.isArray(candidate) ||
          Object.values(candidate).some((value) => typeof value !== 'string')
        ) {
          throw new Error('Request headers must be a JSON object of strings.');
        }
        headers = candidate as Record<string, string>;
      }

      const response = await fetch(parsedUrl, {
        method: 'GET',
        headers,
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`Web source returned HTTP ${response.status}.`);
      }
      const contentType = response.headers.get('content-type') ?? '';
      const body = await response.text();
      const trimmed = body.trimStart();
      const extension =
        contentType.includes('json') || /^[{[]/.test(trimmed)
          ? 'json'
          : contentType.includes('xml') || trimmed.startsWith('<')
            ? 'xml'
            : 'csv';
      const pathName = parsedUrl.pathname.split('/').filter(Boolean).at(-1);
      const fileName = `${webTableName.trim() || pathName?.replace(/\.[^.]+$/, '') || 'web-data'}.${extension}`;
      const file = new File([body], fileName, { type: contentType });
      const sourceLabel = `${parsedUrl.origin}${parsedUrl.pathname}`;
      const parsedTables = await parseDataFile(file);
      const imported = parsedTables.map((table) => ({
        ...table,
        name:
          webTableName.trim() && parsedTables.length > 1
            ? `${webTableName.trim()} · ${table.name}`
            : webTableName.trim() || table.name,
        sourceKind: 'web' as const,
        sourceName: sourceLabel,
      }));
      const firstExisting = report.tables.find(
        (table) =>
          table.sourceName === sourceLabel && table.name === imported[0]?.name,
      );

      updateReport((current) => {
        const importedNames = new Set(imported.map((table) => table.name));
        const retained = current.tables.filter(
          (table) =>
            table.sourceName !== sourceLabel || !importedNames.has(table.name),
        );
        const reconciled = imported.map((table) => {
          const existing = current.tables.find(
            (candidate) =>
              candidate.sourceName === sourceLabel &&
              candidate.name === table.name,
          );
          return existing ? { ...table, id: existing.id } : table;
        });
        return { ...current, tables: [...retained, ...reconciled] };
      });
      setActiveTableId(firstExisting?.id ?? imported[0]?.id ?? activeTableId);
      setShowWebConnector(false);
      showNotice(
        `Fetched ${imported.length} web table(s), ${imported.reduce((sum, table) => sum + table.rows.length, 0).toLocaleString()} rows.`,
      );
    } catch (error) {
      showNotice(
        error instanceof Error ? error.message : 'Web source import failed.',
      );
    } finally {
      setWebLoading(false);
    }
  }

  async function chooseDataFiles() {
    if (!canEdit) return;
    const picker = (
      window as unknown as {
        showOpenFilePicker?: (options: {
          multiple: boolean;
        }) => Promise<LocalFileHandle[]>;
      }
    ).showOpenFilePicker;
    if (!picker) {
      dataInput.current?.click();
      return;
    }
    try {
      const handles = await picker({ multiple: true });
      const files = await Promise.all(
        handles.map((handle) => handle.getFile()),
      );
      await mergeFiles(files, handles);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        dataInput.current?.click();
      }
    }
  }

  function chooseDataFolder() {
    if (!canEdit) return;
    folderInput.current?.click();
  }

  async function refreshSources(silent = false) {
    const handles = Array.from(fileHandles.current.values());
    if (!handles.length) {
      if (!silent)
        showNotice(
          'Re-import with the file picker once to grant refresh access.',
        );
      return;
    }
    const files = await Promise.all(handles.map((handle) => handle.getFile()));
    await mergeFiles(files, handles, silent);
    if (!silent) showNotice('Local sources refreshed.');
  }

  const onAutoRefresh = useEffectEvent(() => {
    void refreshSources(true);
  });

  useEffect(() => {
    if (!report.refreshSeconds) return;
    const timer = window.setInterval(() => {
      onAutoRefresh();
    }, report.refreshSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [report.refreshSeconds]);

  function addWidget() {
    if (!canEdit || !activeTable || !activePage) return;
    const y = pageWidgets.reduce(
      (maximum, widget) => Math.max(maximum, widget.layout.y + widget.layout.h),
      0,
    );
    const widget = defaultWidget(
      activeTable,
      materialized.get(activeTable.id) ?? activeTable.rows,
      y,
      activePage.id,
    );
    updateReport((current) => ({
      ...current,
      widgets: [...current.widgets, widget],
    }));
    setSelectedWidgetId(widget.id);
    setView('dashboard');
  }

  function updateWidget(id: string, patch: Partial<ChartWidget>) {
    if (!canEdit) return;
    updateReport((current) => ({
      ...current,
      widgets: current.widgets.map((widget) =>
        widget.id === id ? { ...widget, ...patch } : widget,
      ),
    }));
  }

  function duplicateWidget(widget: ChartWidget) {
    const copy: ChartWidget = {
      ...widget,
      id: createId('widget'),
      title: `${widget.title} copy`,
      layout: { ...widget.layout, y: widget.layout.y + widget.layout.h },
    };
    updateReport((current) => ({
      ...current,
      widgets: [...current.widgets, copy],
    }));
    setSelectedWidgetId(copy.id);
  }

  function removeWidget(id: string) {
    updateReport((current) => ({
      ...current,
      widgets: current.widgets.filter((widget) => widget.id !== id),
      filters: current.filters.filter(
        (filter) => filter.sourceWidgetId !== id && filter.widgetId !== id,
      ),
    }));
    setSelectedWidgetId('');
  }

  function applyCrossFilter(widget: ChartWidget, value: string) {
    if (!widget.interactions) return;
    const [prefix, ...rest] = effectiveDimension(widget).split('.');
    const related = rest.length
      ? report.tables.find((table) => table.name === prefix)
      : undefined;
    const tableId = related?.id ?? widget.tableId;
    const field = related ? rest.join('.') : effectiveDimension(widget);
    updateReport((current) => {
      const previous = current.filters.find(
        (filter) => filter.sourceWidgetId === widget.id,
      );
      const filters = current.filters.filter(
        (filter) => filter.sourceWidgetId !== widget.id,
      );
      if (previous?.value === value) return { ...current, filters };
      return {
        ...current,
        filters: [
          ...filters,
          {
            id: createId('filter'),
            tableId,
            field,
            operator: 'equals',
            value,
            scope: 'interaction',
            pageId: widget.pageId,
            sourceWidgetId: widget.id,
          },
        ],
      };
    });
  }

  function applyVisualPoint(widget: ChartWidget, value: string) {
    const level = widget.drillLevel ?? 0;
    const hierarchy = widget.hierarchy ?? [];
    if (hierarchy[level + 1]) {
      updateReport((current) => ({
        ...current,
        widgets: current.widgets.map((candidate) =>
          candidate.id === widget.id
            ? { ...candidate, drillLevel: level + 1 }
            : candidate,
        ),
        filters: [
          ...current.filters.filter(
            (filter) => filter.sourceWidgetId !== `${widget.id}:drill:${level}`,
          ),
          {
            id: createId('filter'),
            tableId: widget.tableId,
            field: hierarchy[level] ?? widget.dimension,
            operator: 'equals',
            value,
            scope: 'interaction',
            pageId: widget.pageId,
            sourceWidgetId: `${widget.id}:drill:${level}`,
          },
        ],
      }));
      return;
    }
    applyCrossFilter(widget, value);
  }

  function drillUp(widget: ChartWidget) {
    const level = widget.drillLevel ?? 0;
    if (!level) return;
    updateReport((current) => ({
      ...current,
      widgets: current.widgets.map((candidate) =>
        candidate.id === widget.id
          ? { ...candidate, drillLevel: level - 1 }
          : candidate,
      ),
      filters: current.filters.filter(
        (filter) => filter.sourceWidgetId !== `${widget.id}:drill:${level - 1}`,
      ),
    }));
  }

  function drillNext(widget: ChartWidget) {
    const level = widget.drillLevel ?? 0;
    if (!widget.hierarchy?.[level + 1]) return;
    updateWidget(widget.id, { drillLevel: level + 1 });
  }

  function updateLayout(layout: Layout) {
    if (!canEdit) return;
    updateReport((current) => {
      let changed = false;
      const widgets = current.widgets.map((widget) => {
        const item = layout.find((candidate) => candidate.i === widget.id);
        if (!item) return widget;
        const nextLayout = { x: item.x, y: item.y, w: item.w, h: item.h };
        const same =
          widget.layout.x === nextLayout.x &&
          widget.layout.y === nextLayout.y &&
          widget.layout.w === nextLayout.w &&
          widget.layout.h === nextLayout.h;
        if (same) return widget;
        changed = true;
        return { ...widget, layout: nextLayout };
      });
      return changed ? { ...current, widgets } : current;
    });
  }

  function setTransform(
    tableId: string,
    field: string,
    patch: Partial<ColumnTransform>,
  ) {
    if (!canEdit) return;
    const inferred = inferFields(
      report.tables.find((table) => table.id === tableId)?.rows ?? [],
    ).find((candidate) => candidate.name === field);
    updateReport((current) => {
      const existing = current.transforms.find(
        (transform) =>
          transform.tableId === tableId && transform.field === field,
      );
      const transform: ColumnTransform = {
        id: existing?.id ?? createId('transform'),
        tableId,
        field,
        kind: inferred?.kind ?? 'text',
        trim: false,
        fillNull: '',
        remove: false,
        ...existing,
        ...patch,
      };
      return {
        ...current,
        transforms: [
          ...current.transforms.filter(
            (candidate) =>
              !(candidate.tableId === tableId && candidate.field === field),
          ),
          transform,
        ],
      };
    });
  }

  function addRelationship() {
    const error = validateRelationship(relationDraft, report.tables);
    if (error) return showNotice(error);
    const relationship: Relationship = {
      id: createId('relation'),
      ...relationDraft,
    };
    updateReport((current) => ({
      ...current,
      relationships: [...current.relationships, relationship],
    }));
    showNotice(
      'Relationship added. Related fields are now available to visuals.',
    );
  }

  function addRoleRule() {
    if (!canManage) return showNotice('Switch to Owner to manage role rules.');
    if (!roleRuleDraft.field) return showNotice('Choose a field for the rule.');
    const rule: RoleRule = {
      id: createId('role-rule'),
      ...roleRuleDraft,
      enabled: true,
    };
    updateReport((current) => ({
      ...current,
      roleRules: [...current.roleRules, rule],
    }));
    showNotice('Role row rule added. Switch role mode to preview it.');
  }

  function addCalculatedField() {
    const error = validateCalculatedExpression(calcDraft.expression);
    if (!calcDraft.name.trim()) return showNotice('Name the calculated field.');
    if (error) return showNotice(error);
    const field: CalculatedField = {
      id: createId('calc'),
      tableId: calcDraft.tableId,
      name: calcDraft.name.trim(),
      expression: calcDraft.expression,
    };
    updateReport((current) => ({
      ...current,
      calculatedFields: [...current.calculatedFields, field],
    }));
    setCalcDraft((current) => ({ ...current, name: '', expression: '' }));
    showNotice('Calculated field added.');
  }

  function addParameter() {
    if (!canEdit || !parameterDraft.name.trim()) {
      return showNotice('Name the what-if parameter.');
    }
    if (
      report.parameters.some(
        (parameter) =>
          parameter.name.toLowerCase() ===
          parameterDraft.name.trim().toLowerCase(),
      )
    ) {
      return showNotice('Parameter names must be unique.');
    }
    const minimum = Math.min(parameterDraft.minimum, parameterDraft.maximum);
    const maximum = Math.max(parameterDraft.minimum, parameterDraft.maximum);
    const step = Math.max(Number.EPSILON, Math.abs(parameterDraft.step));
    const parameter: ReportParameter = {
      id: createId('parameter'),
      ...parameterDraft,
      name: parameterDraft.name.trim(),
      minimum,
      maximum,
      step,
      value: Math.min(maximum, Math.max(minimum, parameterDraft.value)),
    };
    updateReport((current) => ({
      ...current,
      parameters: [...current.parameters, parameter],
    }));
    setParameterDraft((current) => ({ ...current, name: '' }));
    showNotice(`What-if parameter “${parameter.name}” added.`);
  }

  function addSemanticMeasure() {
    if (!canEdit || !measureDraft.name.trim()) {
      return showNotice('Name the reusable measure.');
    }
    const measure: SemanticMeasure = {
      id: createId('measure'),
      ...measureDraft,
      name: measureDraft.name.trim(),
    };
    updateReport((current) => ({
      ...current,
      measures: [...current.measures, measure],
    }));
    setMeasureDraft((current) => ({ ...current, name: '' }));
    showNotice('Reusable measure added to the semantic model.');
  }

  function addQueryStep() {
    if (!canEdit || !activeTable) return;
    if (
      !['limit', 'add-index', 'custom-column'].includes(queryDraft.kind) &&
      !queryDraft.field
    ) {
      return showNotice('Choose a field for this query step.');
    }
    if (queryDraft.kind === 'custom-column') {
      if (!queryDraft.name.trim()) return showNotice('Name the custom column.');
      const error = validateCalculatedExpression(queryDraft.value);
      if (error) return showNotice(error);
    }
    if (
      ['rename-column', 'split-column', 'group-by'].includes(queryDraft.kind) &&
      !queryDraft.name.trim()
    ) {
      return showNotice('Name the output column.');
    }
    const step: QueryStep = {
      id: createId('query'),
      tableId: activeTable.id,
      enabled: true,
      ...queryDraft,
      count: Math.max(0, queryDraft.count),
      name: queryDraft.name.trim() || 'Index',
    };
    updateReport((current) => ({
      ...current,
      querySteps: [...current.querySteps, step],
    }));
    showNotice('Query step applied non-destructively.');
  }

  async function saveNow() {
    await saveReport(report);
    await refreshLibrary();
    showNotice('Report saved to this browser.');
  }

  function exportReport() {
    downloadBlob(
      new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
      `${report.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pivora`,
    );
  }

  async function importReport(file?: File) {
    if (!file) return;
    try {
      const value = upgradeReport(JSON.parse(await file.text()));
      replaceReport(value);
      setActiveTableId(value.tables[0]?.id ?? '');
      setSelectedWidgetId(value.widgets[0]?.id ?? '');
      setActivePageId(value.pages[0]?.id ?? '');
      await saveReport(value);
      await refreshLibrary();
      showNotice('Report bundle opened.');
    } catch (error) {
      showNotice(
        error instanceof Error ? error.message : 'Could not open report.',
      );
    }
  }

  async function exportDashboard(kind: 'png' | 'pdf') {
    if (!dashboardRef.current) return;
    showNotice(`Preparing ${kind.toUpperCase()}…`);
    const dataUrl = await toPng(dashboardRef.current, {
      cacheBust: true,
      pixelRatio: 2,
      backgroundColor: activePage?.background ?? (dark ? '#151a24' : '#f5f7fb'),
    });
    if (kind === 'png') {
      const response = await fetch(dataUrl);
      downloadBlob(await response.blob(), `${report.name}.png`);
      return;
    }
    const { jsPDF } = await import('jspdf');
    const image = new Image();
    await new Promise<void>((resolve) => {
      image.onload = () => resolve();
      image.src = dataUrl;
    });
    const pdf = new jsPDF({
      orientation: 'landscape',
      unit: 'px',
      format: [image.width, image.height],
    });
    pdf.addImage(dataUrl, 'PNG', 0, 0, image.width, image.height);
    pdf.save(`${report.name}.pdf`);
  }

  async function exportAllPagesPdf() {
    const pages = report.pages.filter((page) => !page.hidden);
    if (!dashboardRef.current || !pages.length) return;
    const originalPageId = activePage?.id ?? pages[0].id;
    showNotice(`Rendering ${pages.length} report pages…`);
    const captures: { dataUrl: string; width: number; height: number }[] = [];
    try {
      for (const page of pages) {
        setActivePageId(page.id);
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        if (!dashboardRef.current) continue;
        const dataUrl = await toPng(dashboardRef.current, {
          cacheBust: true,
          pixelRatio: 2,
          backgroundColor: page.background,
        });
        const image = new Image();
        await new Promise<void>((resolve) => {
          image.onload = () => resolve();
          image.src = dataUrl;
        });
        captures.push({ dataUrl, width: image.width, height: image.height });
      }
      const first = captures[0];
      if (!first) return;
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'px',
        format: [first.width, first.height],
      });
      captures.forEach((capture, index) => {
        if (index) {
          pdf.addPage([capture.width, capture.height], 'landscape');
        }
        pdf.addImage(
          capture.dataUrl,
          'PNG',
          0,
          0,
          capture.width,
          capture.height,
        );
      });
      pdf.save(`${report.name}-all-pages.pdf`);
      showNotice(`Exported ${captures.length} pages to PDF.`);
    } finally {
      setActivePageId(originalPageId);
    }
  }

  async function executeLocalSql() {
    setSqlRunning(true);
    setSqlError('');
    try {
      const { runLocalSql } = await import('@/lib/duckdb-engine');
      const tables = report.tables.map((table) => ({
        ...table,
        rows: filterRows(
          materialized.get(table.id) ?? table.rows,
          [],
          table.id,
          report.tables,
          report.roleRules,
          report.role,
        ),
      }));
      const result = await runLocalSql(tables, sqlText);
      setSqlResult(result);
      setSqlHistory((history) =>
        [sqlText, ...history.filter((query) => query !== sqlText)].slice(0, 12),
      );
    } catch (error) {
      setSqlResult(undefined);
      setSqlError(error instanceof Error ? error.message : 'SQL query failed.');
    } finally {
      setSqlRunning(false);
    }
  }

  function addSqlResultToModel() {
    if (!sqlResult?.rows.length || !canEdit) return;
    const table = makeTable({
      name: `SQL Result ${report.tables.filter((item) => item.sourceKind === 'sql').length + 1}`,
      rows: sqlResult.rows,
      sourceKind: 'sql',
      sourceName: 'DuckDB local query',
    });
    updateReport((current) => ({
      ...current,
      tables: [...current.tables, table],
    }));
    setActiveTableId(table.id);
    setView('data');
    showNotice('SQL result added as a reusable local table.');
  }

  async function resetSqlEngine() {
    const { resetLocalSqlEngine } = await import('@/lib/duckdb-engine');
    await resetLocalSqlEngine();
    setSqlResult(undefined);
    setSqlError('');
    showNotice('DuckDB local engine reset.');
  }

  const activeRows = filterRows(
    materialized.get(activeTable?.id ?? '') ?? [],
    [],
    activeTable?.id ?? '',
    report.tables,
    report.roleRules,
    report.role,
  );
  const activeFields = materializedFields(activeRows);
  const effectiveProfileField = activeFields.some(
    (field) => field.name === profileField,
  )
    ? profileField
    : (activeFields[0]?.name ?? '');
  const activeColumnProfile = effectiveProfileField
    ? profileColumn(
        activeRows,
        effectiveProfileField,
        activeFields.find((field) => field.name === effectiveProfileField)
          ?.kind,
      )
    : undefined;
  const searchedRows = dataSearch
    ? activeRows.filter((row) =>
        Object.values(row).some((value) =>
          String(value ?? '')
            .toLowerCase()
            .includes(dataSearch.toLowerCase()),
        ),
      )
    : activeRows;
  const pageSize = 100;
  const pagedRows = searchedRows.slice(
    dataPage * pageSize,
    (dataPage + 1) * pageSize,
  );
  const selectedFields = selectedWidget
    ? fieldsFor(selectedWidget.tableId)
    : [];
  const selectedNumericFields = selectedFields.filter(
    (field) => field.kind === 'number',
  );
  const rawActiveFields = inferFields(activeTable?.rows ?? []);
  const drillthroughActions = report.filters.flatMap((filter) => {
    const inCurrentContext =
      filter.scope === 'report' ||
      (filter.scope === 'page' && filter.pageId === activePage?.id) ||
      (filter.scope === 'interaction' &&
        (!filter.pageId || filter.pageId === activePage?.id)) ||
      (filter.scope === 'visual' && filter.widgetId === selectedWidgetId);
    if (!inCurrentContext) return [];
    return report.pages
      .filter(
        (page) =>
          page.id !== activePage?.id &&
          page.drillthroughFields.some(
            (item) =>
              item.tableId === filter.tableId && item.field === filter.field,
          ),
      )
      .map((page) => ({ page, filter }));
  });

  return (
    <main className="bi-shell min-h-screen bg-background text-foreground">
      <input
        ref={dataInput}
        type="file"
        multiple
        accept=".csv,.json,.xml,.parquet,.xlsx,.xls,.xlsm,.sqlite,.sqlite3,.db"
        className="sr-only"
        onChange={(event) =>
          void mergeFiles(Array.from(event.target.files ?? []))
        }
      />
      <input
        ref={folderInput}
        type="file"
        multiple
        className="sr-only"
        {...({
          webkitdirectory: '',
        } as React.InputHTMLAttributes<HTMLInputElement>)}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []).filter((file) =>
            /\.(csv|json|xml|parquet|xlsx?|xlsm|sqlite3?|db)$/i.test(file.name),
          );
          void mergeFiles(files);
          event.target.value = '';
        }}
      />
      <input
        ref={reportInput}
        type="file"
        accept=".pivora,.llbi,application/json"
        className="sr-only"
        onChange={(event) => void importReport(event.target.files?.[0])}
      />

      <header className="bi-header">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="brand-mark">P</span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">Pivora</p>
            <p className="hidden text-[9px] font-bold tracking-[.13em] text-muted-foreground sm:block">
              LOCAL-FIRST ANALYTICS
            </p>
          </div>
        </div>
        <div className="header-report-name">
          <input
            aria-label="Report name"
            value={report.name}
            disabled={!canEdit}
            onChange={(event) =>
              updateReport((current) => ({
                ...current,
                name: event.target.value,
              }))
            }
          />
        </div>
        <div className="flex items-center gap-1.5">
          <NativeSelect
            size="sm"
            value={report.role}
            aria-label="Local role mode"
            onChange={(event) =>
              updateReport((current) => ({
                ...current,
                role: event.target.value as ReportRole,
              }))
            }
          >
            <NativeSelectOption value="owner">Owner</NativeSelectOption>
            <NativeSelectOption value="editor">Editor</NativeSelectOption>
            <NativeSelectOption value="viewer">Viewer</NativeSelectOption>
          </NativeSelect>
          <NativeSelect
            size="sm"
            value={report.theme.id}
            aria-label="Report theme"
            disabled={!canEdit}
            onChange={(event) => applyTheme(event.target.value)}
          >
            {REPORT_THEMES.map((theme) => (
              <NativeSelectOption key={theme.id} value={theme.id}>
                {theme.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Undo"
            disabled={!history.past.length}
            onClick={undo}
          >
            <Undo2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Redo"
            disabled={!history.future.length}
            onClick={redo}
          >
            <Redo2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Toggle theme"
            onClick={() => setDark((value) => !value)}
          >
            {dark ? <Sun /> : <Moon />}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!canEdit || importing}
            onClick={() => void chooseDataFiles()}
          >
            {importing ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <FilePlus2 />
            )}
            <span className="hidden lg:inline">Import</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => void saveNow()}>
            <Save />
            <span className="hidden lg:inline">Save</span>
          </Button>
          <Button size="sm" disabled={!canEdit} onClick={addWidget}>
            <Plus />
            <span className="hidden sm:inline">Visual</span>
          </Button>
        </div>
      </header>

      {notice && (
        <output className="notice">
          {notice}
          <button aria-label="Dismiss" onClick={() => setNotice('')}>
            <X />
          </button>
        </output>
      )}

      <div
        className={`bi-workspace ${view === 'dashboard' ? 'with-inspector' : ''}`}
      >
        <aside className="bi-sidebar">
          <nav className="space-y-1" aria-label="Workspace">
            <button
              className={`nav-item ${view === 'dashboard' ? 'nav-item-active' : ''}`}
              onClick={() => setView('dashboard')}
            >
              <LayoutDashboard />
              Dashboard
            </button>
            <button
              className={`nav-item ${view === 'data' ? 'nav-item-active' : ''}`}
              onClick={() => setView('data')}
            >
              <Table2 />
              Data & clean
            </button>
            <button
              className={`nav-item ${view === 'model' ? 'nav-item-active' : ''}`}
              onClick={() => setView('model')}
            >
              <Link2 />
              Model
            </button>
            <button
              className={`nav-item ${view === 'sql' ? 'nav-item-active' : ''}`}
              onClick={() => setView('sql')}
            >
              <SquareTerminal />
              SQL workbench
            </button>
          </nav>

          <div className="sidebar-section-title">
            <span>Tables</span>
            <button
              onClick={() => void chooseDataFiles()}
              disabled={!canEdit}
              aria-label="Import data"
            >
              <Plus />
            </button>
          </div>
          <div className="space-y-1">
            {report.tables.map((table) => (
              <button
                key={table.id}
                className={`table-source ${activeTable?.id === table.id ? 'active' : ''}`}
                onClick={() => {
                  setActiveTableId(table.id);
                  setDataPage(0);
                }}
              >
                <span className="source-icon">
                  <Database />
                </span>
                <span className="min-w-0 flex-1">
                  <strong>{table.name}</strong>
                  <small>
                    {table.rows.length.toLocaleString()} rows ·{' '}
                    {table.sourceKind}
                  </small>
                </span>
                {table.truncated && <Badge variant="destructive">limit</Badge>}
              </button>
            ))}
          </div>

          <div className="mt-auto space-y-1 border-t pt-3">
            <button className="nav-item" onClick={() => setShowLibrary(true)}>
              <BookOpen />
              Report library
            </button>
            <button className="nav-item" onClick={() => void refreshSources()}>
              <RefreshCw />
              Refresh sources
            </button>
            <div className="px-2 pt-2">
              <label
                className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
                htmlFor="refresh-interval"
              >
                Auto refresh
              </label>
              <NativeSelect
                id="refresh-interval"
                size="sm"
                className="mt-1 w-full"
                value={String(report.refreshSeconds)}
                disabled={!canEdit}
                onChange={(event) =>
                  updateReport((current) => ({
                    ...current,
                    refreshSeconds: Number(event.target.value),
                  }))
                }
              >
                <NativeSelectOption value="0">Off</NativeSelectOption>
                <NativeSelectOption value="30">
                  Every 30 seconds
                </NativeSelectOption>
                <NativeSelectOption value="60">Every minute</NativeSelectOption>
                <NativeSelectOption value="300">
                  Every 5 minutes
                </NativeSelectOption>
              </NativeSelect>
            </div>
          </div>
        </aside>

        <section className="bi-main">
          {view === 'dashboard' && (
            <div className="dashboard-page">
              <div className="page-toolbar">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="eyebrow">Interactive report</p>
                    <Badge variant="secondary">
                      {report.widgets.length} visuals
                    </Badge>
                    {report.refreshSeconds > 0 && (
                      <Badge variant="outline">
                        <RefreshCw />
                        {report.refreshSeconds}s
                      </Badge>
                    )}
                  </div>
                  <h1>{report.name}</h1>
                  <p>
                    Drag, resize, configure, filter, and export the complete
                    report canvas.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canEdit}
                    onClick={addBookmark}
                  >
                    <BookmarkPlus />
                    Bookmark
                  </Button>
                  <Button variant="outline" size="sm" onClick={exportReport}>
                    <Share2 />
                    Report bundle
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={
                      showPerformance
                        ? () => setShowPerformance(false)
                        : openPerformanceAnalyzer
                    }
                  >
                    <Activity />
                    Performance
                  </Button>
                  <Button
                    variant={showFilterPane ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={() => setShowFilterPane((visible) => !visible)}
                  >
                    <Filter />
                    Filters
                    {report.filters.length > 0 && (
                      <span className="toolbar-count">
                        {report.filters.length}
                      </span>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void exportDashboard('png')}
                  >
                    <ImageDown />
                    PNG
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void exportAllPagesPdf()}
                  >
                    <FileDown />
                    PDF all
                  </Button>
                </div>
              </div>

              {showPerformance && (
                <section className="performance-panel">
                  <header>
                    <div>
                      <strong>Visual performance analyzer</strong>
                      <small>
                        Last local aggregation pass; rendering and export time
                        are excluded.
                      </small>
                    </div>
                    <button
                      aria-label="Close performance analyzer"
                      onClick={() => setShowPerformance(false)}
                    >
                      <X />
                    </button>
                  </header>
                  <div>
                    {pageWidgets.map((widget) => {
                      const profile = performanceProfiles[widget.id];
                      return (
                        <article key={widget.id}>
                          <span>{widget.title}</span>
                          <strong>
                            {profile?.durationMs.toFixed(2) ?? '—'} ms
                          </strong>
                          <small>
                            {(profile?.inputRows ?? 0).toLocaleString()} rows →{' '}
                            {profile?.outputPoints ?? 0} points
                          </small>
                        </article>
                      );
                    })}
                  </div>
                </section>
              )}

              {showFilterPane && (
                <section className="filter-pane">
                  <header>
                    <div>
                      <strong>Filter context</strong>
                      <small>
                        Author report, page, or selected-visual filters. Visual
                        interactions remain separate and removable below.
                      </small>
                    </div>
                    <button
                      aria-label="Close filter pane"
                      onClick={() => setShowFilterPane(false)}
                    >
                      <X />
                    </button>
                  </header>
                  <div className="filter-authoring-form">
                    <label htmlFor="filter-scope">
                      Scope
                      <NativeSelect
                        id="filter-scope"
                        aria-label="Filter scope"
                        value={filterDraft.scope}
                        disabled={!canEdit}
                        onChange={(event) =>
                          setFilterDraft((draft) => ({
                            ...draft,
                            scope: event.target.value as ReportFilter['scope'],
                          }))
                        }
                      >
                        <NativeSelectOption value="report">
                          Entire report
                        </NativeSelectOption>
                        <NativeSelectOption value="page">
                          Current page
                        </NativeSelectOption>
                        <NativeSelectOption value="visual">
                          Selected visual
                        </NativeSelectOption>
                      </NativeSelect>
                    </label>
                    <label htmlFor="filter-table">
                      Table
                      <NativeSelect
                        id="filter-table"
                        aria-label="Filter table"
                        value={filterDraft.tableId}
                        disabled={!canEdit}
                        onChange={(event) => {
                          const tableId = event.target.value;
                          setFilterDraft((draft) => ({
                            ...draft,
                            tableId,
                            field: fieldsFor(tableId)[0]?.name ?? '',
                          }));
                        }}
                      >
                        {report.tables.map((table) => (
                          <NativeSelectOption key={table.id} value={table.id}>
                            {table.name}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </label>
                    <label htmlFor="filter-field">
                      Field
                      <NativeSelect
                        id="filter-field"
                        aria-label="Filter field"
                        value={filterDraft.field}
                        disabled={!canEdit}
                        onChange={(event) =>
                          setFilterDraft((draft) => ({
                            ...draft,
                            field: event.target.value,
                          }))
                        }
                      >
                        {fieldsFor(filterDraft.tableId).map((field) => (
                          <NativeSelectOption
                            key={field.name}
                            value={field.name}
                          >
                            {field.name}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </label>
                    <label htmlFor="filter-operator">
                      Operator
                      <NativeSelect
                        id="filter-operator"
                        aria-label="Filter operator"
                        value={filterDraft.operator}
                        disabled={!canEdit}
                        onChange={(event) =>
                          setFilterDraft((draft) => ({
                            ...draft,
                            operator: event.target
                              .value as ReportFilter['operator'],
                          }))
                        }
                      >
                        {[
                          'equals',
                          'not-equals',
                          'contains',
                          'greater-than',
                          'less-than',
                          'is-blank',
                          'not-blank',
                        ].map((operator) => (
                          <NativeSelectOption key={operator} value={operator}>
                            {operator.replaceAll('-', ' ')}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </label>
                    <label htmlFor="filter-value">
                      Value
                      <input
                        id="filter-value"
                        className="form-input"
                        aria-label="Filter value"
                        value={filterDraft.value}
                        disabled={
                          !canEdit ||
                          ['is-blank', 'not-blank'].includes(
                            filterDraft.operator,
                          )
                        }
                        onChange={(event) =>
                          setFilterDraft((draft) => ({
                            ...draft,
                            value: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <Button
                      size="sm"
                      onClick={addManualFilter}
                      disabled={
                        !canEdit ||
                        (filterDraft.scope === 'visual' && !selectedWidget)
                      }
                    >
                      <Plus /> Apply filter
                    </Button>
                  </div>
                  {filterDraft.scope === 'page' && activePage && (
                    <p className="filter-target-copy">
                      Target page: <strong>{activePage.name}</strong>
                    </p>
                  )}
                  {filterDraft.scope === 'visual' && (
                    <p className="filter-target-copy">
                      Target visual:{' '}
                      <strong>
                        {selectedWidget?.title ?? 'None selected'}
                      </strong>
                    </p>
                  )}
                  <div className="filter-context-list">
                    {report.filters.length ? (
                      report.filters.map((filter) => (
                        <article key={filter.id}>
                          <Badge
                            variant={
                              filter.scope === 'interaction'
                                ? 'secondary'
                                : 'outline'
                            }
                          >
                            {filter.scope}
                          </Badge>
                          <span>
                            <strong>
                              {
                                report.tables.find(
                                  (table) => table.id === filter.tableId,
                                )?.name
                              }
                              .{filter.field}
                            </strong>
                            <small>
                              {filter.operator.replaceAll('-', ' ')}{' '}
                              {!['is-blank', 'not-blank'].includes(
                                filter.operator,
                              )
                                ? filter.value
                                : ''}
                            </small>
                          </span>
                          <button
                            aria-label={`Remove ${filter.scope} filter`}
                            onClick={() =>
                              updateReport((current) => ({
                                ...current,
                                filters: current.filters.filter(
                                  (candidate) => candidate.id !== filter.id,
                                ),
                              }))
                            }
                          >
                            <Trash2 />
                          </button>
                        </article>
                      ))
                    ) : (
                      <p>No active filter contexts.</p>
                    )}
                  </div>
                </section>
              )}

              <div className="report-page-bar">
                <div
                  className="page-tabs"
                  role="tablist"
                  aria-label="Report pages"
                >
                  {report.pages
                    .filter((page) => !page.hidden || canEdit)
                    .map((page) => (
                      <button
                        key={page.id}
                        role="tab"
                        aria-selected={page.id === activePage?.id}
                        className={page.id === activePage?.id ? 'active' : ''}
                        onClick={() => selectPage(page.id)}
                      >
                        {page.name}
                        {page.hidden && <small>hidden</small>}
                      </button>
                    ))}
                  {canEdit && (
                    <button
                      className="page-icon-button"
                      onClick={addPage}
                      aria-label="Add report page"
                    >
                      <Plus />
                    </button>
                  )}
                </div>
                {canEdit && (
                  <div className="page-actions">
                    <Button variant="ghost" size="sm" onClick={duplicatePage}>
                      <Copy /> Duplicate page
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Delete page"
                      onClick={removePage}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                )}
              </div>

              {report.bookmarks.length > 0 && (
                <div className="bookmark-strip">
                  <BookOpen />
                  {report.bookmarks.map((bookmark) => (
                    <span className="bookmark-chip" key={bookmark.id}>
                      <button onClick={() => applyBookmark(bookmark.id)}>
                        {bookmark.name}
                      </button>
                      {canEdit && (
                        <button
                          aria-label={`Delete ${bookmark.name}`}
                          onClick={() =>
                            updateReport((current) => ({
                              ...current,
                              bookmarks: current.bookmarks.filter(
                                (item) => item.id !== bookmark.id,
                              ),
                            }))
                          }
                        >
                          <X />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}

              {report.filters.length > 0 && (
                <div className="filter-strip">
                  <Filter />
                  {report.filters.map((filter) => (
                    <button
                      key={filter.id}
                      onClick={() =>
                        updateReport((current) => ({
                          ...current,
                          filters: current.filters.filter(
                            (candidate) => candidate.id !== filter.id,
                          ),
                        }))
                      }
                    >
                      <span>
                        {filter.scope} ·{' '}
                        {
                          report.tables.find(
                            (table) => table.id === filter.tableId,
                          )?.name
                        }
                        .{filter.field}
                      </span>
                      <strong>
                        {filter.operator.replaceAll('-', ' ')}{' '}
                        {!['is-blank', 'not-blank'].includes(filter.operator)
                          ? filter.value
                          : ''}
                      </strong>
                      <X />
                    </button>
                  ))}
                  <button
                    className="clear-filters"
                    onClick={() =>
                      updateReport((current) => ({ ...current, filters: [] }))
                    }
                  >
                    Clear all
                  </button>
                </div>
              )}

              {drillthroughActions.length > 0 && (
                <div className="drillthrough-strip">
                  <ArrowDownToLine />
                  <span>Drillthrough</span>
                  {drillthroughActions.map(({ page, filter }) => (
                    <Button
                      key={`${page.id}-${filter.id}`}
                      size="sm"
                      variant="outline"
                      onClick={() => openDrillthrough(page, filter)}
                    >
                      {page.name} · {filter.field} = {filter.value}
                    </Button>
                  ))}
                </div>
              )}

              <div
                ref={dashboardRef}
                className="dashboard-export"
                style={{ backgroundColor: activePage?.background }}
              >
                <div ref={gridContainerRef} className="dashboard-grid-host">
                  {gridMounted && (
                    <ReactGridLayout
                      width={gridWidth}
                      layout={pageWidgets.map((widget) => ({
                        i: widget.id,
                        ...widget.layout,
                        minW: 3,
                        minH: 3,
                      }))}
                      gridConfig={{
                        cols: 12,
                        rowHeight: 34,
                        margin: [12, 12],
                        containerPadding: [0, 0],
                      }}
                      dragConfig={{
                        enabled: canEdit,
                        handle: '.drag-handle',
                        cancel: 'button,input,select',
                      }}
                      resizeConfig={{ enabled: canEdit, handles: ['se'] }}
                      compactor={verticalCompactor}
                      onLayoutChange={updateLayout}
                    >
                      {pageWidgets.map((widget) => (
                        <article
                          key={widget.id}
                          className={`visual-card ${selectedWidgetId === widget.id ? 'selected' : ''}`}
                        >
                          <header className="drag-handle">
                            <button
                              className="visual-title-button"
                              onClick={() => setSelectedWidgetId(widget.id)}
                            >
                              <GripHorizontal />
                              <span>{widget.title}</span>
                            </button>
                            {(canEdit ||
                              (widget.drillLevel ?? 0) > 0 ||
                              !!widget.hierarchy?.[
                                (widget.drillLevel ?? 0) + 1
                              ]) && (
                              <div className="visual-actions">
                                {widget.hierarchy?.[
                                  (widget.drillLevel ?? 0) + 1
                                ] && (
                                  <button
                                    aria-label="Drill to next level"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      drillNext(widget);
                                    }}
                                  >
                                    <ArrowDownToLine />
                                  </button>
                                )}
                                {(widget.drillLevel ?? 0) > 0 && (
                                  <button
                                    aria-label="Drill up"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      drillUp(widget);
                                    }}
                                  >
                                    <ArrowUpFromLine />
                                  </button>
                                )}
                                {canEdit && (
                                  <>
                                    <button
                                      aria-label="Duplicate"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        duplicateWidget(widget);
                                      }}
                                    >
                                      <Copy />
                                    </button>
                                    <button
                                      aria-label="Delete"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        removeWidget(widget.id);
                                      }}
                                    >
                                      <Trash2 />
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                          </header>
                          <div className="visual-body">
                            <ChartVisual
                              widget={{
                                ...widget,
                                dimension: effectiveDimension(widget),
                              }}
                              points={pointsFor(widget)}
                              secondaryPoints={
                                widget.secondaryMeasure
                                  ? pointsFor({
                                      ...widget,
                                      measure: widget.secondaryMeasure,
                                    })
                                  : undefined
                              }
                              onPointClick={(value) =>
                                applyVisualPoint(widget, value)
                              }
                            />
                          </div>
                        </article>
                      ))}
                    </ReactGridLayout>
                  )}
                </div>
              </div>
            </div>
          )}

          {view === 'data' && activeTable && (
            <div className="data-page">
              <div className="page-toolbar">
                <div>
                  <p className="eyebrow">Data preparation</p>
                  <h1>{activeTable.name}</h1>
                  <p>
                    {activeRows.length.toLocaleString()} materialized rows ·
                    transformations are non-destructive.
                  </p>
                </div>
                <div className="flex gap-2">
                  <input
                    className="form-input w-52"
                    placeholder="Search values"
                    value={dataSearch}
                    onChange={(event) => {
                      setDataSearch(event.target.value);
                      setDataPage(0);
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void chooseDataFiles()}
                    disabled={!canEdit}
                  >
                    <Upload />
                    Add source
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={chooseDataFolder}
                    disabled={!canEdit}
                  >
                    <FolderOpen />
                    Add folder
                  </Button>
                  <Button
                    variant={showWebConnector ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={() => setShowWebConnector((visible) => !visible)}
                    disabled={!canEdit}
                  >
                    <Globe2 />
                    Web / API
                  </Button>
                </div>
              </div>

              {showWebConnector && (
                <section className="web-connector-panel">
                  <div className="panel-title">
                    <Globe2 />
                    <div>
                      <strong>Web & API connector</strong>
                      <small>
                        Explicit browser GET for JSON, CSV, or XML endpoints
                      </small>
                    </div>
                  </div>
                  <label>
                    Source URL
                    <input
                      className="form-input"
                      type="url"
                      placeholder="https://api.example.com/data.json"
                      value={webUrl}
                      onChange={(event) => setWebUrl(event.target.value)}
                    />
                  </label>
                  <label>
                    Table name
                    <input
                      className="form-input"
                      placeholder="Optional friendly name"
                      value={webTableName}
                      onChange={(event) => setWebTableName(event.target.value)}
                    />
                  </label>
                  <label className="web-header-field">
                    Session-only request headers
                    <textarea
                      className="form-input font-mono"
                      aria-label="Web request headers"
                      placeholder={'{"Authorization":"Bearer …"}'}
                      value={webHeaders}
                      onChange={(event) => setWebHeaders(event.target.value)}
                    />
                  </label>
                  <div className="web-connector-actions">
                    <p>
                      Headers are never saved in the report. The endpoint must
                      allow browser CORS; fetched rows stay in this local model.
                    </p>
                    <Button
                      size="sm"
                      onClick={() => void importWebSource()}
                      disabled={webLoading || !webUrl.trim()}
                    >
                      {webLoading ? (
                        <LoaderCircle className="animate-spin" />
                      ) : (
                        <Globe2 />
                      )}
                      Fetch source
                    </Button>
                  </div>
                </section>
              )}

              <div className="data-prep-grid">
                <section className="prep-panel query-steps-panel">
                  <div className="panel-title">
                    <Filter />
                    <div>
                      <strong>Applied query steps</strong>
                      <small>
                        Build an ordered, repeatable preparation pipeline
                        without changing the source.
                      </small>
                    </div>
                  </div>
                  <div className="query-step-form">
                    <NativeSelect
                      value={queryDraft.kind}
                      disabled={!canEdit}
                      onChange={(event) =>
                        setQueryDraft((draft) => ({
                          ...draft,
                          kind: event.target.value as QueryStep['kind'],
                        }))
                      }
                    >
                      <NativeSelectOption value="filter">
                        Filter rows
                      </NativeSelectOption>
                      <NativeSelectOption value="sort">
                        Sort rows
                      </NativeSelectOption>
                      <NativeSelectOption value="remove-duplicates">
                        Remove duplicates
                      </NativeSelectOption>
                      <NativeSelectOption value="limit">
                        Keep first rows
                      </NativeSelectOption>
                      <NativeSelectOption value="add-index">
                        Add index
                      </NativeSelectOption>
                      <NativeSelectOption value="replace-values">
                        Replace values
                      </NativeSelectOption>
                      <NativeSelectOption value="rename-column">
                        Rename column
                      </NativeSelectOption>
                      <NativeSelectOption value="split-column">
                        Split column
                      </NativeSelectOption>
                      <NativeSelectOption value="custom-column">
                        Custom column
                      </NativeSelectOption>
                      <NativeSelectOption value="group-by">
                        Group by
                      </NativeSelectOption>
                    </NativeSelect>
                    {[
                      'filter',
                      'sort',
                      'remove-duplicates',
                      'replace-values',
                      'rename-column',
                      'split-column',
                      'group-by',
                    ].includes(queryDraft.kind) && (
                      <NativeSelect
                        value={queryDraft.field}
                        disabled={!canEdit}
                        onChange={(event) =>
                          setQueryDraft((draft) => ({
                            ...draft,
                            field: event.target.value,
                          }))
                        }
                      >
                        {rawActiveFields.map((field) => (
                          <NativeSelectOption
                            key={field.name}
                            value={field.name}
                          >
                            {field.name}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    )}
                    {queryDraft.kind === 'filter' && (
                      <>
                        <NativeSelect
                          value={queryDraft.operator}
                          disabled={!canEdit}
                          onChange={(event) =>
                            setQueryDraft((draft) => ({
                              ...draft,
                              operator: event.target
                                .value as QueryStep['operator'],
                            }))
                          }
                        >
                          <NativeSelectOption value="equals">
                            Equals
                          </NativeSelectOption>
                          <NativeSelectOption value="not-equals">
                            Not equals
                          </NativeSelectOption>
                          <NativeSelectOption value="contains">
                            Contains
                          </NativeSelectOption>
                          <NativeSelectOption value="greater-than">
                            Greater than
                          </NativeSelectOption>
                          <NativeSelectOption value="less-than">
                            Less than
                          </NativeSelectOption>
                          <NativeSelectOption value="is-blank">
                            Is blank
                          </NativeSelectOption>
                          <NativeSelectOption value="not-blank">
                            Is not blank
                          </NativeSelectOption>
                        </NativeSelect>
                        {!queryDraft.operator.includes('blank') && (
                          <input
                            className="form-input"
                            placeholder="Filter value"
                            value={queryDraft.value}
                            disabled={!canEdit}
                            onChange={(event) =>
                              setQueryDraft((draft) => ({
                                ...draft,
                                value: event.target.value,
                              }))
                            }
                          />
                        )}
                      </>
                    )}
                    {queryDraft.kind === 'sort' && (
                      <NativeSelect
                        value={queryDraft.direction}
                        disabled={!canEdit}
                        onChange={(event) =>
                          setQueryDraft((draft) => ({
                            ...draft,
                            direction: event.target
                              .value as QueryStep['direction'],
                          }))
                        }
                      >
                        <NativeSelectOption value="ascending">
                          Ascending
                        </NativeSelectOption>
                        <NativeSelectOption value="descending">
                          Descending
                        </NativeSelectOption>
                      </NativeSelect>
                    )}
                    {queryDraft.kind === 'limit' && (
                      <input
                        className="form-input"
                        type="number"
                        min="0"
                        value={queryDraft.count}
                        disabled={!canEdit}
                        onChange={(event) =>
                          setQueryDraft((draft) => ({
                            ...draft,
                            count: Number(event.target.value),
                          }))
                        }
                      />
                    )}
                    {queryDraft.kind === 'add-index' && (
                      <>
                        <input
                          className="form-input"
                          placeholder="Index column"
                          value={queryDraft.name}
                          disabled={!canEdit}
                          onChange={(event) =>
                            setQueryDraft((draft) => ({
                              ...draft,
                              name: event.target.value,
                            }))
                          }
                        />
                        <input
                          className="form-input"
                          type="number"
                          aria-label="Index start"
                          value={queryDraft.start}
                          disabled={!canEdit}
                          onChange={(event) =>
                            setQueryDraft((draft) => ({
                              ...draft,
                              start: Number(event.target.value),
                            }))
                          }
                        />
                      </>
                    )}
                    {queryDraft.kind === 'replace-values' && (
                      <>
                        <input
                          className="form-input"
                          placeholder="Find"
                          value={queryDraft.value}
                          disabled={!canEdit}
                          onChange={(event) =>
                            setQueryDraft((draft) => ({
                              ...draft,
                              value: event.target.value,
                            }))
                          }
                        />
                        <input
                          className="form-input"
                          placeholder="Replace with"
                          value={queryDraft.replacement}
                          disabled={!canEdit}
                          onChange={(event) =>
                            setQueryDraft((draft) => ({
                              ...draft,
                              replacement: event.target.value,
                            }))
                          }
                        />
                      </>
                    )}
                    {queryDraft.kind === 'rename-column' && (
                      <input
                        className="form-input"
                        placeholder="New column name"
                        value={queryDraft.name}
                        disabled={!canEdit}
                        onChange={(event) =>
                          setQueryDraft((draft) => ({
                            ...draft,
                            name: event.target.value,
                          }))
                        }
                      />
                    )}
                    {queryDraft.kind === 'split-column' && (
                      <>
                        <input
                          className="form-input"
                          placeholder="Separator"
                          value={queryDraft.separator}
                          disabled={!canEdit}
                          onChange={(event) =>
                            setQueryDraft((draft) => ({
                              ...draft,
                              separator: event.target.value,
                            }))
                          }
                        />
                        <input
                          className="form-input"
                          placeholder="Output prefix"
                          value={queryDraft.name}
                          disabled={!canEdit}
                          onChange={(event) =>
                            setQueryDraft((draft) => ({
                              ...draft,
                              name: event.target.value,
                            }))
                          }
                        />
                      </>
                    )}
                    {queryDraft.kind === 'custom-column' && (
                      <>
                        <input
                          className="form-input"
                          placeholder="Column name"
                          value={queryDraft.name}
                          disabled={!canEdit}
                          onChange={(event) =>
                            setQueryDraft((draft) => ({
                              ...draft,
                              name: event.target.value,
                            }))
                          }
                        />
                        <input
                          className="form-input font-mono"
                          placeholder="[revenue] - [cost]"
                          value={queryDraft.value}
                          disabled={!canEdit}
                          onChange={(event) =>
                            setQueryDraft((draft) => ({
                              ...draft,
                              value: event.target.value,
                            }))
                          }
                        />
                      </>
                    )}
                    {queryDraft.kind === 'group-by' && (
                      <>
                        <NativeSelect
                          value={queryDraft.targetField}
                          disabled={!canEdit}
                          onChange={(event) =>
                            setQueryDraft((draft) => ({
                              ...draft,
                              targetField: event.target.value,
                            }))
                          }
                        >
                          {rawActiveFields
                            .filter((field) => field.kind === 'number')
                            .map((field) => (
                              <NativeSelectOption
                                key={field.name}
                                value={field.name}
                              >
                                {field.name}
                              </NativeSelectOption>
                            ))}
                        </NativeSelect>
                        <NativeSelect
                          value={queryDraft.aggregation}
                          disabled={!canEdit}
                          onChange={(event) =>
                            setQueryDraft((draft) => ({
                              ...draft,
                              aggregation: event.target.value as Aggregation,
                            }))
                          }
                        >
                          <NativeSelectOption value="sum">
                            Sum
                          </NativeSelectOption>
                          <NativeSelectOption value="average">
                            Average
                          </NativeSelectOption>
                          <NativeSelectOption value="count">
                            Count
                          </NativeSelectOption>
                          <NativeSelectOption value="minimum">
                            Minimum
                          </NativeSelectOption>
                          <NativeSelectOption value="maximum">
                            Maximum
                          </NativeSelectOption>
                          <NativeSelectOption value="distinct-count">
                            Distinct count
                          </NativeSelectOption>
                        </NativeSelect>
                        <input
                          className="form-input"
                          placeholder="Output measure"
                          value={queryDraft.name}
                          disabled={!canEdit}
                          onChange={(event) =>
                            setQueryDraft((draft) => ({
                              ...draft,
                              name: event.target.value,
                            }))
                          }
                        />
                      </>
                    )}
                    <Button
                      size="sm"
                      onClick={addQueryStep}
                      disabled={!canEdit}
                    >
                      <Plus /> Apply step
                    </Button>
                  </div>
                  <div className="query-step-list">
                    {report.querySteps
                      .filter((step) => step.tableId === activeTable.id)
                      .map((step, index) => (
                        <div key={step.id}>
                          <span>{index + 1}</span>
                          <strong>{step.kind.replaceAll('-', ' ')}</strong>
                          <small>{describeQueryStep(step)}</small>
                          <label>
                            <input
                              type="checkbox"
                              checked={step.enabled}
                              disabled={!canEdit}
                              onChange={(event) =>
                                updateReport((current) => ({
                                  ...current,
                                  querySteps: current.querySteps.map(
                                    (candidate) =>
                                      candidate.id === step.id
                                        ? {
                                            ...candidate,
                                            enabled: event.target.checked,
                                          }
                                        : candidate,
                                  ),
                                }))
                              }
                            />
                            Enabled
                          </label>
                          {canEdit && (
                            <button
                              aria-label={`Delete query step ${index + 1}`}
                              onClick={() =>
                                updateReport((current) => ({
                                  ...current,
                                  querySteps: current.querySteps.filter(
                                    (candidate) => candidate.id !== step.id,
                                  ),
                                }))
                              }
                            >
                              <Trash2 />
                            </button>
                          )}
                        </div>
                      ))}
                    {!report.querySteps.some(
                      (step) => step.tableId === activeTable.id,
                    ) && <p className="empty-inline">No query steps yet.</p>}
                  </div>
                </section>
                <section className="prep-panel">
                  <div className="panel-title">
                    <Settings2 />
                    <div>
                      <strong>Column types & cleaning</strong>
                      <small>
                        Override inference, trim text, and fill blanks.
                      </small>
                    </div>
                  </div>
                  <div className="field-clean-list">
                    {rawActiveFields.map((field) => {
                      const transform = report.transforms.find(
                        (candidate) =>
                          candidate.tableId === activeTable.id &&
                          candidate.field === field.name,
                      );
                      return (
                        <div className="field-clean-row" key={field.name}>
                          <div>
                            <strong>{field.name}</strong>
                            <small>
                              {field.uniqueCount.toLocaleString()} unique
                            </small>
                          </div>
                          <NativeSelect
                            size="sm"
                            value={transform?.kind ?? field.kind}
                            disabled={!canEdit}
                            onChange={(event) =>
                              setTransform(activeTable.id, field.name, {
                                kind: event.target.value as
                                  | 'date'
                                  | 'number'
                                  | 'text',
                              })
                            }
                          >
                            <NativeSelectOption value="text">
                              Text
                            </NativeSelectOption>
                            <NativeSelectOption value="number">
                              Number
                            </NativeSelectOption>
                            <NativeSelectOption value="date">
                              Date
                            </NativeSelectOption>
                          </NativeSelect>
                          <label>
                            <input
                              type="checkbox"
                              checked={transform?.trim ?? false}
                              disabled={!canEdit}
                              onChange={(event) =>
                                setTransform(activeTable.id, field.name, {
                                  trim: event.target.checked,
                                })
                              }
                            />{' '}
                            Trim
                          </label>
                          <input
                            className="form-input h-7"
                            placeholder="Fill null"
                            value={transform?.fillNull ?? ''}
                            disabled={!canEdit}
                            onChange={(event) =>
                              setTransform(activeTable.id, field.name, {
                                fillNull: event.target.value,
                              })
                            }
                          />
                          <label>
                            <input
                              type="checkbox"
                              checked={transform?.remove ?? false}
                              disabled={!canEdit}
                              onChange={(event) =>
                                setTransform(activeTable.id, field.name, {
                                  remove: event.target.checked,
                                })
                              }
                            />{' '}
                            Remove
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </section>
                <section className="profile-panel">
                  <div className="panel-title profile-heading">
                    <Activity />
                    <div>
                      <strong>Column profile</strong>
                      <small>
                        Quality, frequency distribution, and descriptive
                        statistics across all materialized rows.
                      </small>
                    </div>
                    <NativeSelect
                      aria-label="Profile column"
                      value={effectiveProfileField}
                      onChange={(event) => setProfileField(event.target.value)}
                    >
                      {activeFields.map((field) => (
                        <NativeSelectOption key={field.name} value={field.name}>
                          {field.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </div>
                  {activeColumnProfile ? (
                    <div className="profile-content">
                      <div className="quality-grid">
                        <article className="quality-valid">
                          <span>Valid</span>
                          <strong>
                            {activeColumnProfile.validCount.toLocaleString()}
                          </strong>
                          <small>
                            {(activeColumnProfile.validRatio * 100).toFixed(1)}%
                          </small>
                        </article>
                        <article>
                          <span>Empty</span>
                          <strong>
                            {activeColumnProfile.emptyCount.toLocaleString()}
                          </strong>
                          <small>blank or null</small>
                        </article>
                        <article className="quality-error">
                          <span>Errors</span>
                          <strong>
                            {activeColumnProfile.errorCount.toLocaleString()}
                          </strong>
                          <small>invalid {activeColumnProfile.kind}</small>
                        </article>
                        <article>
                          <span>Distinct</span>
                          <strong>
                            {activeColumnProfile.distinctCount.toLocaleString()}
                          </strong>
                          <small>unique values</small>
                        </article>
                      </div>
                      <div className="profile-details">
                        <section>
                          <h3>
                            {activeColumnProfile.distribution.length
                              ? 'Numeric distribution'
                              : 'Most frequent values'}
                          </h3>
                          <div className="distribution-list">
                            {(activeColumnProfile.distribution.length
                              ? activeColumnProfile.distribution
                              : activeColumnProfile.topValues
                            ).map((item) => {
                              const count = item.count;
                              const maximum = Math.max(
                                1,
                                ...(activeColumnProfile.distribution.length
                                  ? activeColumnProfile.distribution
                                  : activeColumnProfile.topValues
                                ).map((candidate) => candidate.count),
                              );
                              return (
                                <div key={item.label}>
                                  <span title={item.label}>{item.label}</span>
                                  <i>
                                    <b
                                      style={{
                                        width: `${(count / maximum) * 100}%`,
                                      }}
                                    />
                                  </i>
                                  <strong>{count.toLocaleString()}</strong>
                                </div>
                              );
                            })}
                          </div>
                        </section>
                        <section>
                          <h3>Statistics</h3>
                          <dl className="statistics-grid">
                            <div>
                              <dt>Minimum</dt>
                              <dd>
                                {formatProfileValue(
                                  activeColumnProfile.minimum,
                                )}
                              </dd>
                            </div>
                            <div>
                              <dt>Maximum</dt>
                              <dd>
                                {formatProfileValue(
                                  activeColumnProfile.maximum,
                                )}
                              </dd>
                            </div>
                            <div>
                              <dt>Average</dt>
                              <dd>
                                {formatProfileValue(
                                  activeColumnProfile.average,
                                )}
                              </dd>
                            </div>
                            <div>
                              <dt>Median</dt>
                              <dd>
                                {formatProfileValue(activeColumnProfile.median)}
                              </dd>
                            </div>
                            <div>
                              <dt>Std. deviation</dt>
                              <dd>
                                {formatProfileValue(
                                  activeColumnProfile.standardDeviation,
                                )}
                              </dd>
                            </div>
                            <div>
                              <dt>Rows</dt>
                              <dd>
                                {activeColumnProfile.totalCount.toLocaleString()}
                              </dd>
                            </div>
                          </dl>
                        </section>
                      </div>
                    </div>
                  ) : (
                    <p className="empty-inline">
                      No fields available to profile.
                    </p>
                  )}
                </section>
                <section className="table-preview-panel">
                  <div className="panel-title">
                    <Table2 />
                    <div>
                      <strong>Row preview</strong>
                      <small>
                        Page-based rendering stays responsive on large tables.
                      </small>
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          {activeFields.map((field) => (
                            <th key={field.name}>
                              <span>{field.name}</span>
                              <small>{field.kind}</small>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pagedRows.map((row, index) => (
                          <tr key={index}>
                            {activeFields.map((field) => (
                              <td key={field.name}>
                                {row[field.name] === null ? (
                                  <em>null</em>
                                ) : (
                                  String(row[field.name])
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <footer className="table-pager">
                    <span>
                      {(dataPage * pageSize + 1).toLocaleString()}–
                      {Math.min(
                        (dataPage + 1) * pageSize,
                        searchedRows.length,
                      ).toLocaleString()}{' '}
                      of {searchedRows.length.toLocaleString()}
                    </span>
                    <div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={dataPage === 0}
                        onClick={() => setDataPage((page) => page - 1)}
                      >
                        Previous
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          (dataPage + 1) * pageSize >= searchedRows.length
                        }
                        onClick={() => setDataPage((page) => page + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  </footer>
                </section>
              </div>
            </div>
          )}

          {view === 'model' && (
            <div className="model-page">
              <div className="page-toolbar">
                <div>
                  <p className="eyebrow">Semantic model</p>
                  <h1>Tables, relationships & formulas</h1>
                  <p>
                    Join local tables and define reusable measures without
                    changing source files.
                  </p>
                </div>
              </div>
              <div className="model-columns">
                <section className="model-section">
                  <div className="panel-title">
                    <Link2 />
                    <div>
                      <strong>Relationships</strong>
                      <small>Direct many-to-one lookup joins</small>
                    </div>
                  </div>
                  <div className="model-form">
                    <NativeSelect
                      value={relationDraft.leftTableId}
                      onChange={(event) => {
                        const id = event.target.value;
                        setRelationDraft((draft) => ({
                          ...draft,
                          leftTableId: id,
                          leftField:
                            inferFields(
                              report.tables.find((table) => table.id === id)
                                ?.rows ?? [],
                            )[0]?.name ?? '',
                        }));
                      }}
                    >
                      {report.tables.map((table) => (
                        <NativeSelectOption key={table.id} value={table.id}>
                          {table.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <NativeSelect
                      value={relationDraft.leftField}
                      onChange={(event) =>
                        setRelationDraft((draft) => ({
                          ...draft,
                          leftField: event.target.value,
                        }))
                      }
                    >
                      {inferFields(
                        report.tables.find(
                          (table) => table.id === relationDraft.leftTableId,
                        )?.rows ?? [],
                      ).map((field) => (
                        <NativeSelectOption key={field.name} value={field.name}>
                          {field.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <span className="join-arrow">→</span>
                    <NativeSelect
                      value={relationDraft.rightTableId}
                      onChange={(event) => {
                        const id = event.target.value;
                        setRelationDraft((draft) => ({
                          ...draft,
                          rightTableId: id,
                          rightField:
                            inferFields(
                              report.tables.find((table) => table.id === id)
                                ?.rows ?? [],
                            )[0]?.name ?? '',
                        }));
                      }}
                    >
                      {report.tables.map((table) => (
                        <NativeSelectOption key={table.id} value={table.id}>
                          {table.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <NativeSelect
                      value={relationDraft.rightField}
                      onChange={(event) =>
                        setRelationDraft((draft) => ({
                          ...draft,
                          rightField: event.target.value,
                        }))
                      }
                    >
                      {inferFields(
                        report.tables.find(
                          (table) => table.id === relationDraft.rightTableId,
                        )?.rows ?? [],
                      ).map((field) => (
                        <NativeSelectOption key={field.name} value={field.name}>
                          {field.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <NativeSelect
                      aria-label="Relationship cardinality"
                      value={relationDraft.cardinality}
                      onChange={(event) =>
                        setRelationDraft((draft) => ({
                          ...draft,
                          cardinality: event.target.value as NonNullable<
                            Relationship['cardinality']
                          >,
                        }))
                      }
                    >
                      <NativeSelectOption value="many-to-one">
                        Many to one
                      </NativeSelectOption>
                      <NativeSelectOption value="one-to-many">
                        One to many
                      </NativeSelectOption>
                      <NativeSelectOption value="one-to-one">
                        One to one
                      </NativeSelectOption>
                      <NativeSelectOption value="many-to-many">
                        Many to many
                      </NativeSelectOption>
                    </NativeSelect>
                    <NativeSelect
                      aria-label="Cross-filter direction"
                      value={relationDraft.crossFilterDirection}
                      onChange={(event) =>
                        setRelationDraft((draft) => ({
                          ...draft,
                          crossFilterDirection: event.target.value as
                            | 'single'
                            | 'both',
                        }))
                      }
                    >
                      <NativeSelectOption value="single">
                        Single direction
                      </NativeSelectOption>
                      <NativeSelectOption value="both">
                        Both directions
                      </NativeSelectOption>
                    </NativeSelect>
                    <Button onClick={addRelationship} disabled={!canEdit}>
                      <Plus />
                      Relate
                    </Button>
                  </div>
                  <div className="model-list">
                    {report.relationships.map((relation) => {
                      const diagnostic = relationshipDiagnostics.get(
                        relation.id,
                      );
                      return (
                        <div key={relation.id}>
                          <Link2 />
                          <span>
                            <strong>
                              {
                                report.tables.find(
                                  (table) => table.id === relation.leftTableId,
                                )?.name
                              }
                              .{relation.leftField}
                            </strong>
                            <small>
                              {relation.cardinality ?? 'many-to-one'} ·{' '}
                              {relation.crossFilterDirection ?? 'single'} ·
                              matches{' '}
                              {
                                report.tables.find(
                                  (table) => table.id === relation.rightTableId,
                                )?.name
                              }
                              .{relation.rightField}
                            </small>
                          </span>
                          {diagnostic && (
                            <div
                              className="relationship-diagnostics"
                              title={
                                diagnostic.issues.join(' ') ||
                                'Healthy relationship'
                              }
                            >
                              <Badge
                                variant={
                                  diagnostic.status === 'invalid'
                                    ? 'destructive'
                                    : diagnostic.status === 'warning'
                                      ? 'outline'
                                      : 'secondary'
                                }
                              >
                                {diagnostic.status}
                              </Badge>
                              <small>
                                {(diagnostic.matchRate * 100).toFixed(0)}%
                                matched
                              </small>
                              {!diagnostic.cardinalityValid &&
                                (diagnostic.leftDuplicates > 0 ||
                                  diagnostic.rightDuplicates > 0) && (
                                  <small>
                                    {diagnostic.leftDuplicates +
                                      diagnostic.rightDuplicates}{' '}
                                    duplicates
                                  </small>
                                )}
                              {(diagnostic.unmatchedLeft > 0 ||
                                diagnostic.unmatchedRight > 0) && (
                                <small>
                                  {diagnostic.unmatchedLeft +
                                    diagnostic.unmatchedRight}{' '}
                                  unmatched
                                </small>
                              )}
                            </div>
                          )}
                          <label className="relationship-active-toggle">
                            <input
                              type="checkbox"
                              checked={relation.active ?? true}
                              disabled={!canEdit}
                              onChange={(event) =>
                                updateReport((current) => ({
                                  ...current,
                                  relationships: current.relationships.map(
                                    (candidate) =>
                                      candidate.id === relation.id
                                        ? {
                                            ...candidate,
                                            active: event.target.checked,
                                          }
                                        : candidate,
                                  ),
                                }))
                              }
                            />
                            Active
                          </label>
                          {canEdit && (
                            <button
                              onClick={() =>
                                updateReport((current) => ({
                                  ...current,
                                  relationships: current.relationships.filter(
                                    (candidate) => candidate.id !== relation.id,
                                  ),
                                }))
                              }
                            >
                              <Trash2 />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="model-section">
                  <div className="panel-title">
                    <Activity />
                    <div>
                      <strong>What-if parameters</strong>
                      <small>
                        Reference a parameter by name in formulas, for example
                        [revenue] * (1 + [Uplift] / 100).
                      </small>
                    </div>
                  </div>
                  <div className="parameter-form">
                    <input
                      className="form-input"
                      aria-label="Parameter name"
                      placeholder="Parameter name"
                      value={parameterDraft.name}
                      disabled={!canEdit}
                      onChange={(event) =>
                        setParameterDraft((draft) => ({
                          ...draft,
                          name: event.target.value,
                        }))
                      }
                    />
                    {(
                      [
                        ['minimum', 'Minimum'],
                        ['maximum', 'Maximum'],
                        ['step', 'Step'],
                        ['value', 'Default'],
                      ] as const
                    ).map(([key, label]) => (
                      <input
                        key={key}
                        className="form-input"
                        aria-label={`Parameter ${label.toLowerCase()}`}
                        title={label}
                        type="number"
                        value={parameterDraft[key]}
                        disabled={!canEdit}
                        onChange={(event) =>
                          setParameterDraft((draft) => ({
                            ...draft,
                            [key]: Number(event.target.value),
                          }))
                        }
                      />
                    ))}
                    <Button onClick={addParameter} disabled={!canEdit}>
                      <Plus /> Add parameter
                    </Button>
                  </div>
                  <div className="parameter-list">
                    {report.parameters.map((parameter) => (
                      <article key={parameter.id}>
                        <header>
                          <span>
                            <strong>{parameter.name}</strong>
                            <small>
                              {parameter.minimum} to {parameter.maximum} · step{' '}
                              {parameter.step}
                            </small>
                          </span>
                          <output>{parameter.value}</output>
                          {canEdit && (
                            <button
                              aria-label={`Delete ${parameter.name} parameter`}
                              onClick={() =>
                                updateReport((current) => ({
                                  ...current,
                                  parameters: current.parameters.filter(
                                    (candidate) =>
                                      candidate.id !== parameter.id,
                                  ),
                                }))
                              }
                            >
                              <Trash2 />
                            </button>
                          )}
                        </header>
                        <div className="parameter-control">
                          <input
                            type="range"
                            aria-label={`${parameter.name} slider`}
                            min={parameter.minimum}
                            max={parameter.maximum}
                            step={parameter.step}
                            value={parameter.value}
                            disabled={!canEdit}
                            onChange={(event) => {
                              const value = Number(event.target.value);
                              updateReport((current) => ({
                                ...current,
                                parameters: current.parameters.map(
                                  (candidate) =>
                                    candidate.id === parameter.id
                                      ? { ...candidate, value }
                                      : candidate,
                                ),
                              }));
                            }}
                          />
                          <input
                            className="form-input"
                            type="number"
                            aria-label={`${parameter.name} value`}
                            min={parameter.minimum}
                            max={parameter.maximum}
                            step={parameter.step}
                            value={parameter.value}
                            disabled={!canEdit}
                            onChange={(event) => {
                              const value = Math.min(
                                parameter.maximum,
                                Math.max(
                                  parameter.minimum,
                                  Number(event.target.value),
                                ),
                              );
                              updateReport((current) => ({
                                ...current,
                                parameters: current.parameters.map(
                                  (candidate) =>
                                    candidate.id === parameter.id
                                      ? { ...candidate, value }
                                      : candidate,
                                ),
                              }));
                            }}
                          />
                        </div>
                      </article>
                    ))}
                  </div>
                </section>

                <section className="model-section">
                  <div className="panel-title">
                    <LockKeyhole />
                    <div>
                      <strong>Role row rules</strong>
                      <small>
                        Local row-level security preview for Editor and Viewer
                      </small>
                    </div>
                    <Badge
                      variant={
                        report.role === 'owner' ? 'outline' : 'secondary'
                      }
                    >
                      Previewing {report.role}
                    </Badge>
                  </div>
                  <div className="role-rule-form">
                    <NativeSelect
                      aria-label="Rule role"
                      value={roleRuleDraft.role}
                      disabled={!canManage}
                      onChange={(event) =>
                        setRoleRuleDraft((draft) => ({
                          ...draft,
                          role: event.target.value as RoleRule['role'],
                        }))
                      }
                    >
                      <NativeSelectOption value="viewer">
                        Viewer
                      </NativeSelectOption>
                      <NativeSelectOption value="editor">
                        Editor
                      </NativeSelectOption>
                    </NativeSelect>
                    <NativeSelect
                      aria-label="Rule table"
                      value={roleRuleDraft.tableId}
                      disabled={!canManage}
                      onChange={(event) => {
                        const tableId = event.target.value;
                        setRoleRuleDraft((draft) => ({
                          ...draft,
                          tableId,
                          field:
                            inferFields(
                              report.tables.find(
                                (table) => table.id === tableId,
                              )?.rows ?? [],
                            )[0]?.name ?? '',
                        }));
                      }}
                    >
                      {report.tables.map((table) => (
                        <NativeSelectOption key={table.id} value={table.id}>
                          {table.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <NativeSelect
                      aria-label="Rule field"
                      value={roleRuleDraft.field}
                      disabled={!canManage}
                      onChange={(event) =>
                        setRoleRuleDraft((draft) => ({
                          ...draft,
                          field: event.target.value,
                        }))
                      }
                    >
                      {inferFields(
                        report.tables.find(
                          (table) => table.id === roleRuleDraft.tableId,
                        )?.rows ?? [],
                      ).map((field) => (
                        <NativeSelectOption key={field.name} value={field.name}>
                          {field.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <NativeSelect
                      aria-label="Rule operator"
                      value={roleRuleDraft.operator}
                      disabled={!canManage}
                      onChange={(event) =>
                        setRoleRuleDraft((draft) => ({
                          ...draft,
                          operator: event.target.value as RoleRule['operator'],
                        }))
                      }
                    >
                      {[
                        'equals',
                        'not-equals',
                        'contains',
                        'greater-than',
                        'less-than',
                        'is-blank',
                        'not-blank',
                      ].map((operator) => (
                        <NativeSelectOption key={operator} value={operator}>
                          {operator.replaceAll('-', ' ')}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <input
                      className="form-input"
                      aria-label="Rule value"
                      placeholder="Allowed value"
                      value={roleRuleDraft.value}
                      disabled={
                        !canManage ||
                        ['is-blank', 'not-blank'].includes(
                          roleRuleDraft.operator,
                        )
                      }
                      onChange={(event) =>
                        setRoleRuleDraft((draft) => ({
                          ...draft,
                          value: event.target.value,
                        }))
                      }
                    />
                    <Button onClick={addRoleRule} disabled={!canManage}>
                      <Plus /> Add rule
                    </Button>
                  </div>
                  <div className="role-rule-note">
                    Owner bypasses row rules. Header values are a local preview,
                    not an authentication boundary.
                  </div>
                  <div className="model-list">
                    {report.roleRules.map((rule) => (
                      <div key={rule.id}>
                        <LockKeyhole />
                        <span>
                          <strong>
                            {rule.role} ·{' '}
                            {
                              report.tables.find(
                                (table) => table.id === rule.tableId,
                              )?.name
                            }
                            .{rule.field}
                          </strong>
                          <small>
                            {rule.operator.replaceAll('-', ' ')}{' '}
                            {!['is-blank', 'not-blank'].includes(rule.operator)
                              ? rule.value
                              : ''}
                          </small>
                        </span>
                        <label className="relationship-active-toggle">
                          <input
                            type="checkbox"
                            checked={rule.enabled}
                            disabled={!canManage}
                            onChange={(event) =>
                              updateReport((current) => ({
                                ...current,
                                roleRules: current.roleRules.map((candidate) =>
                                  candidate.id === rule.id
                                    ? {
                                        ...candidate,
                                        enabled: event.target.checked,
                                      }
                                    : candidate,
                                ),
                              }))
                            }
                          />
                          Enabled
                        </label>
                        {canManage && (
                          <button
                            aria-label="Delete role rule"
                            onClick={() =>
                              updateReport((current) => ({
                                ...current,
                                roleRules: current.roleRules.filter(
                                  (candidate) => candidate.id !== rule.id,
                                ),
                              }))
                            }
                          >
                            <Trash2 />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </section>

                <section className="model-section">
                  <div className="panel-title">
                    <Calculator />
                    <div>
                      <strong>Calculated fields</strong>
                      <small>Formula syntax: [revenue] - [cost]</small>
                    </div>
                  </div>
                  <div className="calc-form">
                    <NativeSelect
                      value={calcDraft.tableId}
                      onChange={(event) =>
                        setCalcDraft((draft) => ({
                          ...draft,
                          tableId: event.target.value,
                        }))
                      }
                    >
                      {report.tables.map((table) => (
                        <NativeSelectOption key={table.id} value={table.id}>
                          {table.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <input
                      className="form-input"
                      placeholder="Field name"
                      value={calcDraft.name}
                      onChange={(event) =>
                        setCalcDraft((draft) => ({
                          ...draft,
                          name: event.target.value,
                        }))
                      }
                    />
                    <input
                      className="form-input font-mono"
                      placeholder="[revenue] - [cost]"
                      value={calcDraft.expression}
                      onChange={(event) =>
                        setCalcDraft((draft) => ({
                          ...draft,
                          expression: event.target.value,
                        }))
                      }
                    />
                    <Button onClick={addCalculatedField} disabled={!canEdit}>
                      <Plus />
                      Add formula
                    </Button>
                  </div>
                  <div className="model-list">
                    {report.calculatedFields.map((field) => (
                      <div key={field.id}>
                        <Calculator />
                        <span>
                          <strong>
                            {
                              report.tables.find(
                                (table) => table.id === field.tableId,
                              )?.name
                            }
                            .{field.name}
                          </strong>
                          <small className="font-mono">
                            {field.expression}
                          </small>
                        </span>
                        {canEdit && (
                          <button
                            onClick={() =>
                              updateReport((current) => ({
                                ...current,
                                calculatedFields:
                                  current.calculatedFields.filter(
                                    (candidate) => candidate.id !== field.id,
                                  ),
                              }))
                            }
                          >
                            <Trash2 />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </section>

                <section className="model-section">
                  <div className="panel-title">
                    <Calculator />
                    <div>
                      <strong>Reusable measures</strong>
                      <small>
                        Centralize aggregation, formatting, and time-style
                        calculations.
                      </small>
                    </div>
                  </div>
                  <div className="measure-form">
                    <NativeSelect
                      value={measureDraft.tableId}
                      onChange={(event) => {
                        const tableId = event.target.value;
                        const field = fieldsFor(tableId).find(
                          (candidate) => candidate.kind === 'number',
                        );
                        setMeasureDraft((draft) => ({
                          ...draft,
                          tableId,
                          field: field?.name ?? '__rows',
                        }));
                      }}
                    >
                      {report.tables.map((table) => (
                        <NativeSelectOption key={table.id} value={table.id}>
                          {table.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <input
                      className="form-input"
                      placeholder="Measure name"
                      value={measureDraft.name}
                      onChange={(event) =>
                        setMeasureDraft((draft) => ({
                          ...draft,
                          name: event.target.value,
                        }))
                      }
                    />
                    <NativeSelect
                      value={measureDraft.field}
                      onChange={(event) =>
                        setMeasureDraft((draft) => ({
                          ...draft,
                          field: event.target.value,
                        }))
                      }
                    >
                      {fieldsFor(measureDraft.tableId)
                        .filter((field) => field.kind === 'number')
                        .map((field) => (
                          <NativeSelectOption
                            key={field.name}
                            value={field.name}
                          >
                            {field.name}
                          </NativeSelectOption>
                        ))}
                      <NativeSelectOption value="__rows">
                        Row count
                      </NativeSelectOption>
                    </NativeSelect>
                    <NativeSelect
                      value={measureDraft.aggregation}
                      onChange={(event) =>
                        setMeasureDraft((draft) => ({
                          ...draft,
                          aggregation: event.target.value as Aggregation,
                        }))
                      }
                    >
                      {[
                        'sum',
                        'average',
                        'count',
                        'minimum',
                        'maximum',
                        'distinct-count',
                      ].map((aggregation) => (
                        <NativeSelectOption
                          key={aggregation}
                          value={aggregation}
                        >
                          {aggregation.replace('-', ' ')}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <NativeSelect
                      value={measureDraft.calculation}
                      onChange={(event) =>
                        setMeasureDraft((draft) => ({
                          ...draft,
                          calculation: event.target.value as QuickCalculation,
                        }))
                      }
                    >
                      {[
                        'none',
                        'running-total',
                        'percent-of-total',
                        'difference',
                        'percent-change',
                        'rank',
                      ].map((calculation) => (
                        <NativeSelectOption
                          key={calculation}
                          value={calculation}
                        >
                          {calculation.replaceAll('-', ' ')}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <NativeSelect
                      value={measureDraft.numberFormat}
                      onChange={(event) =>
                        setMeasureDraft((draft) => ({
                          ...draft,
                          numberFormat: event.target.value as NumberFormat,
                        }))
                      }
                    >
                      {['compact', 'standard', 'currency', 'percent'].map(
                        (format) => (
                          <NativeSelectOption key={format} value={format}>
                            {format}
                          </NativeSelectOption>
                        ),
                      )}
                    </NativeSelect>
                    <Button onClick={addSemanticMeasure} disabled={!canEdit}>
                      <Plus /> Add measure
                    </Button>
                  </div>
                  <div className="model-list">
                    {report.measures.map((measure) => (
                      <div key={measure.id}>
                        <Calculator />
                        <span>
                          <strong>{measure.name}</strong>
                          <small>
                            {measure.aggregation}({measure.field}) ·{' '}
                            {measure.calculation}
                          </small>
                        </span>
                        {canEdit && (
                          <button
                            onClick={() =>
                              updateReport((current) => ({
                                ...current,
                                measures: current.measures.filter(
                                  (candidate) => candidate.id !== measure.id,
                                ),
                                widgets: current.widgets.map((widget) =>
                                  widget.measure === measure.id
                                    ? { ...widget, measure: measure.field }
                                    : widget,
                                ),
                              }))
                            }
                          >
                            <Trash2 />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </section>

                <section className="model-section model-map">
                  <div className="panel-title">
                    <Database />
                    <div>
                      <strong>Model map</strong>
                      <small>
                        {report.tables.length} tables ·{' '}
                        {report.relationships.length} relationships
                      </small>
                    </div>
                  </div>
                  <div className="table-map">
                    {report.tables.map((table) => (
                      <article key={table.id}>
                        <header>
                          <Database />
                          {table.name}
                          <Badge variant="outline">{table.sourceKind}</Badge>
                        </header>
                        {inferFields(table.rows).map((field) => (
                          <p key={field.name}>
                            <span>
                              {field.kind === 'number'
                                ? '#'
                                : field.kind === 'date'
                                  ? '◷'
                                  : 'Aa'}
                            </span>
                            {field.name}
                          </p>
                        ))}
                        {report.calculatedFields
                          .filter((field) => field.tableId === table.id)
                          .map((field) => (
                            <p key={field.id} className="calculated">
                              <span>ƒx</span>
                              {field.name}
                            </p>
                          ))}
                      </article>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          )}

          {view === 'sql' && (
            <div className="sql-page">
              <div className="page-toolbar">
                <div>
                  <p className="eyebrow">Local query engine</p>
                  <h1>SQL workbench</h1>
                  <p>
                    Query materialized report tables with DuckDB-WASM. The
                    engine runs in this browser and only accepts read-only SQL.
                  </p>
                </div>
                <div className="sql-toolbar-badges">
                  <Badge variant="secondary">DuckDB-WASM</Badge>
                  <Badge variant="outline">Read only</Badge>
                  <Badge variant="outline">10,000 row preview</Badge>
                </div>
              </div>

              <div className="sql-workbench">
                <section className="sql-panel sql-editor-panel">
                  <header>
                    <div className="panel-title">
                      <SquareTerminal />
                      <div>
                        <strong>Query editor</strong>
                        <small>Press Ctrl/⌘ + Enter to run</small>
                      </div>
                    </div>
                    <div className="sql-actions">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={resetSqlEngine}
                        disabled={sqlRunning}
                      >
                        <RefreshCw /> Reset
                      </Button>
                      <Button
                        size="sm"
                        onClick={executeLocalSql}
                        disabled={sqlRunning}
                      >
                        {sqlRunning ? (
                          <LoaderCircle className="animate-spin" />
                        ) : (
                          <SquareTerminal />
                        )}
                        Run query
                      </Button>
                    </div>
                  </header>
                  <textarea
                    className="sql-editor"
                    aria-label="SQL query"
                    spellCheck={false}
                    value={sqlText}
                    onChange={(event) => setSqlText(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        (event.ctrlKey || event.metaKey) &&
                        event.key === 'Enter'
                      ) {
                        event.preventDefault();
                        void executeLocalSql();
                      }
                    }}
                  />

                  <div className="sql-source-section">
                    <div className="sql-section-heading">
                      <span>Available tables</span>
                      <small>
                        Empty tables are loaded after they receive a row.
                      </small>
                    </div>
                    <div className="sql-chip-list">
                      {report.tables.map((table) => (
                        <button
                          type="button"
                          key={table.id}
                          onClick={() =>
                            setSqlText(
                              `SELECT *\nFROM "${table.name.replaceAll('"', '""')}"\nLIMIT 100`,
                            )
                          }
                        >
                          <Database />
                          <span>{table.name}</span>
                          <small>
                            {(
                              materialized.get(table.id)?.length ?? 0
                            ).toLocaleString()}
                          </small>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="sql-source-section sql-history-section">
                    <div className="sql-section-heading">
                      <span>Session history</span>
                      <small>{sqlHistory.length} saved queries</small>
                    </div>
                    {sqlHistory.length ? (
                      <div className="sql-history-list">
                        {sqlHistory.map((query, index) => (
                          <button
                            type="button"
                            key={`${query}-${index}`}
                            onClick={() => setSqlText(query)}
                          >
                            <SquareTerminal />
                            <code>{query.replace(/\s+/g, ' ')}</code>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="sql-empty-copy">
                        Successful queries appear here for this session.
                      </p>
                    )}
                  </div>
                </section>

                <section className="sql-panel sql-result-panel">
                  <header>
                    <div className="panel-title">
                      <Table2 />
                      <div>
                        <strong>Results</strong>
                        <small>
                          {sqlResult
                            ? `${sqlResult.rows.length.toLocaleString()} rows · ${sqlResult.durationMs.toFixed(1)} ms`
                            : 'Run a query to inspect its result set'}
                        </small>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canEdit || !sqlResult?.rows.length}
                      onClick={addSqlResultToModel}
                    >
                      <Plus /> Add to model
                    </Button>
                  </header>

                  {sqlError && (
                    <div className="sql-error" role="alert">
                      <strong>Query failed</strong>
                      <span>{sqlError}</span>
                    </div>
                  )}

                  {sqlRunning && (
                    <div className="sql-running">
                      <LoaderCircle className="animate-spin" />
                      Loading report tables and executing locally…
                    </div>
                  )}

                  {!sqlRunning && sqlResult && (
                    <>
                      <div className="sql-result-meta">
                        <Badge variant="outline">
                          DuckDB {sqlResult.engineVersion}
                        </Badge>
                        {sqlResult.truncated && (
                          <Badge variant="secondary">
                            Preview truncated at 10,000 rows
                          </Badge>
                        )}
                      </div>
                      <div className="sql-result-scroll">
                        <table>
                          <thead>
                            <tr>
                              {sqlResult.columns.map((column) => (
                                <th key={column}>{column}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {sqlResult.rows.map((row, rowIndex) => (
                              <tr key={rowIndex}>
                                {sqlResult.columns.map((column) => (
                                  <td key={column}>
                                    {row[column] === null ||
                                    row[column] === undefined
                                      ? '—'
                                      : String(row[column])}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}

                  {!sqlRunning && !sqlResult && !sqlError && (
                    <div className="sql-result-empty">
                      <SquareTerminal />
                      <strong>Ready for local SQL</strong>
                      <p>
                        Select a table shortcut or write SELECT, WITH, SHOW,
                        DESCRIBE, or EXPLAIN SQL.
                      </p>
                    </div>
                  )}
                </section>
              </div>
            </div>
          )}
        </section>

        {view === 'dashboard' && (
          <aside className="bi-inspector">
            <div className="inspector-heading">
              <PanelRight />
              <div>
                <strong>Visual inspector</strong>
                <small>
                  {selectedWidget
                    ? 'Configure the selected visual'
                    : 'Select a visual'}
                </small>
              </div>
            </div>
            {activePage && (
              <div className="page-inspector-controls">
                <label>
                  Page name
                  <input
                    className="form-input"
                    value={activePage.name}
                    disabled={!canEdit}
                    onChange={(event) =>
                      updateReport((current) => ({
                        ...current,
                        pages: current.pages.map((page) =>
                          page.id === activePage.id
                            ? { ...page, name: event.target.value }
                            : page,
                        ),
                      }))
                    }
                  />
                </label>
                <label>
                  Canvas
                  <input
                    type="color"
                    value={activePage.background}
                    disabled={!canEdit}
                    onChange={(event) =>
                      updateReport((current) => ({
                        ...current,
                        pages: current.pages.map((page) =>
                          page.id === activePage.id
                            ? { ...page, background: event.target.value }
                            : page,
                        ),
                      }))
                    }
                  />
                </label>
                <label className="page-hidden-toggle">
                  <input
                    type="checkbox"
                    checked={activePage.hidden}
                    disabled={!canEdit}
                    onChange={(event) =>
                      updateReport((current) => ({
                        ...current,
                        pages: current.pages.map((page) =>
                          page.id === activePage.id
                            ? { ...page, hidden: event.target.checked }
                            : page,
                        ),
                      }))
                    }
                  />
                  Hide page from viewers
                </label>
                <div className="drillthrough-config">
                  <span>Drillthrough fields</span>
                  <NativeSelect
                    aria-label="Drillthrough table"
                    value={drillthroughDraft.tableId}
                    disabled={!canEdit}
                    onChange={(event) => {
                      const tableId = event.target.value;
                      setDrillthroughDraft({
                        tableId,
                        field: fieldsFor(tableId)[0]?.name ?? '',
                      });
                    }}
                  >
                    {report.tables.map((table) => (
                      <NativeSelectOption key={table.id} value={table.id}>
                        {table.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <NativeSelect
                    aria-label="Drillthrough field"
                    value={drillthroughDraft.field}
                    disabled={!canEdit}
                    onChange={(event) =>
                      setDrillthroughDraft((draft) => ({
                        ...draft,
                        field: event.target.value,
                      }))
                    }
                  >
                    {fieldsFor(drillthroughDraft.tableId).map((field) => (
                      <NativeSelectOption key={field.name} value={field.name}>
                        {field.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={addDrillthroughField}
                    disabled={!canEdit}
                  >
                    <Plus /> Add target field
                  </Button>
                  <div className="drillthrough-field-list">
                    {activePage.drillthroughFields.map((item) => (
                      <span key={item.id}>
                        {
                          report.tables.find(
                            (table) => table.id === item.tableId,
                          )?.name
                        }
                        .{item.field}
                        {canEdit && (
                          <button
                            aria-label={`Remove ${item.field} drillthrough field`}
                            onClick={() =>
                              updateReport((current) => ({
                                ...current,
                                pages: current.pages.map((page) =>
                                  page.id === activePage.id
                                    ? {
                                        ...page,
                                        drillthroughFields:
                                          page.drillthroughFields.filter(
                                            (candidate) =>
                                              candidate.id !== item.id,
                                          ),
                                      }
                                    : page,
                                ),
                              }))
                            }
                          >
                            <X />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                  <label className="page-hidden-toggle">
                    <input
                      type="checkbox"
                      checked={activePage.keepAllFilters}
                      disabled={!canEdit}
                      onChange={(event) =>
                        updateReport((current) => ({
                          ...current,
                          pages: current.pages.map((page) =>
                            page.id === activePage.id
                              ? {
                                  ...page,
                                  keepAllFilters: event.target.checked,
                                }
                              : page,
                          ),
                        }))
                      }
                    />
                    Keep all source filters
                  </label>
                </div>
              </div>
            )}
            {selectedWidget ? (
              <div className="inspector-controls">
                <label>
                  Title
                  <input
                    className="form-input"
                    value={selectedWidget.title}
                    disabled={!canEdit}
                    onChange={(event) =>
                      updateWidget(selectedWidget.id, {
                        title: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Table
                  <NativeSelect
                    value={selectedWidget.tableId}
                    disabled={!canEdit}
                    onChange={(event) => {
                      const table = report.tables.find(
                        (candidate) => candidate.id === event.target.value,
                      );
                      if (!table) return;
                      const next = defaultWidget(
                        table,
                        materialized.get(table.id) ?? table.rows,
                        0,
                        selectedWidget.pageId,
                      );
                      updateWidget(selectedWidget.id, {
                        tableId: table.id,
                        dimension: next.dimension,
                        measure: next.measure,
                      });
                    }}
                  >
                    {report.tables.map((table) => (
                      <NativeSelectOption key={table.id} value={table.id}>
                        {table.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
                <label>
                  Visual type
                  <NativeSelect
                    value={selectedWidget.kind}
                    disabled={!canEdit}
                    onChange={(event) =>
                      updateWidget(selectedWidget.id, {
                        kind: event.target.value as ChartKind,
                      })
                    }
                  >
                    {[
                      'bar',
                      'line',
                      'area',
                      'pie',
                      'kpi',
                      'table',
                      'matrix',
                      'scatter',
                      'funnel',
                      'waterfall',
                      'treemap',
                      'gauge',
                      'combo',
                      'slicer',
                    ].map((kind) => (
                      <NativeSelectOption key={kind} value={kind}>
                        {kind}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
                <label>
                  Dimension
                  <NativeSelect
                    value={selectedWidget.dimension}
                    disabled={!canEdit}
                    onChange={(event) =>
                      updateWidget(selectedWidget.id, {
                        dimension: event.target.value,
                      })
                    }
                  >
                    {selectedFields.map((field) => (
                      <NativeSelectOption key={field.name} value={field.name}>
                        {field.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
                <label>
                  Drill hierarchy
                  <input
                    className="form-input"
                    placeholder="region, product_id"
                    key={`${selectedWidget.id}-hierarchy`}
                    defaultValue={(selectedWidget.hierarchy ?? []).join(', ')}
                    disabled={!canEdit}
                    onBlur={(event) => {
                      const hierarchy = event.target.value
                        .split(',')
                        .map((field) => field.trim())
                        .filter((field) =>
                          selectedFields.some(
                            (candidate) => candidate.name === field,
                          ),
                        );
                      updateReport((current) => ({
                        ...current,
                        widgets: current.widgets.map((widget) =>
                          widget.id === selectedWidget.id
                            ? { ...widget, hierarchy, drillLevel: 0 }
                            : widget,
                        ),
                        filters: current.filters.filter(
                          (filter) =>
                            !filter.sourceWidgetId?.startsWith(
                              `${selectedWidget.id}:drill:`,
                            ),
                        ),
                      }));
                    }}
                  />
                </label>
                <label>
                  Measure
                  <NativeSelect
                    value={selectedWidget.measure}
                    disabled={!canEdit}
                    onChange={(event) => {
                      const measure = report.measures.find(
                        (candidate) => candidate.id === event.target.value,
                      );
                      updateWidget(selectedWidget.id, {
                        measure: event.target.value,
                        numberFormat:
                          measure?.numberFormat ?? selectedWidget.numberFormat,
                      });
                    }}
                  >
                    {selectedNumericFields.map((field) => (
                      <NativeSelectOption key={field.name} value={field.name}>
                        {field.name}
                      </NativeSelectOption>
                    ))}
                    <NativeSelectOption value="__rows">
                      Row count
                    </NativeSelectOption>
                    {report.measures
                      .filter(
                        (measure) => measure.tableId === selectedWidget.tableId,
                      )
                      .map((measure) => (
                        <NativeSelectOption key={measure.id} value={measure.id}>
                          ƒ {measure.name}
                        </NativeSelectOption>
                      ))}
                  </NativeSelect>
                </label>
                {(selectedWidget.kind === 'combo' ||
                  selectedWidget.kind === 'scatter') && (
                  <label>
                    Secondary measure
                    <NativeSelect
                      value={
                        selectedWidget.secondaryMeasure ??
                        selectedWidget.measure
                      }
                      disabled={!canEdit}
                      onChange={(event) =>
                        updateWidget(selectedWidget.id, {
                          secondaryMeasure: event.target.value,
                        })
                      }
                    >
                      {selectedNumericFields.map((field) => (
                        <NativeSelectOption key={field.name} value={field.name}>
                          {field.name}
                        </NativeSelectOption>
                      ))}
                      {report.measures
                        .filter(
                          (measure) =>
                            measure.tableId === selectedWidget.tableId,
                        )
                        .map((measure) => (
                          <NativeSelectOption
                            key={measure.id}
                            value={measure.id}
                          >
                            ƒ {measure.name}
                          </NativeSelectOption>
                        ))}
                    </NativeSelect>
                  </label>
                )}
                {selectedWidget.kind === 'gauge' && (
                  <label>
                    Gauge target
                    <input
                      className="form-input"
                      type="number"
                      min="1"
                      value={selectedWidget.gaugeTarget ?? 1000000}
                      disabled={!canEdit}
                      onChange={(event) =>
                        updateWidget(selectedWidget.id, {
                          gaugeTarget: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                )}
                <div className="field-label">
                  <span>Aggregation</span>
                  <NativeSelect
                    value={
                      selectedSemanticMeasure?.aggregation ??
                      selectedWidget.aggregation
                    }
                    disabled={!canEdit || !!selectedSemanticMeasure}
                    onChange={(event) =>
                      updateWidget(selectedWidget.id, {
                        aggregation: event.target.value as Aggregation,
                      })
                    }
                  >
                    <NativeSelectOption value="sum">Sum</NativeSelectOption>
                    <NativeSelectOption value="average">
                      Average
                    </NativeSelectOption>
                    <NativeSelectOption value="count">Count</NativeSelectOption>
                    <NativeSelectOption value="minimum">
                      Minimum
                    </NativeSelectOption>
                    <NativeSelectOption value="maximum">
                      Maximum
                    </NativeSelectOption>
                    <NativeSelectOption value="distinct-count">
                      Distinct count
                    </NativeSelectOption>
                  </NativeSelect>
                </div>
                <div className="field-label">
                  <span>Quick calculation</span>
                  <NativeSelect
                    value={
                      selectedSemanticMeasure?.calculation ??
                      selectedWidget.calculation ??
                      'none'
                    }
                    disabled={!canEdit || !!selectedSemanticMeasure}
                    onChange={(event) =>
                      updateWidget(selectedWidget.id, {
                        calculation: event.target.value as QuickCalculation,
                        numberFormat:
                          event.target.value === 'percent-of-total' ||
                          event.target.value === 'percent-change'
                            ? 'percent'
                            : selectedWidget.numberFormat,
                      })
                    }
                  >
                    <NativeSelectOption value="none">None</NativeSelectOption>
                    <NativeSelectOption value="running-total">
                      Running total
                    </NativeSelectOption>
                    <NativeSelectOption value="percent-of-total">
                      Percent of total
                    </NativeSelectOption>
                    <NativeSelectOption value="difference">
                      Difference from previous
                    </NativeSelectOption>
                    <NativeSelectOption value="percent-change">
                      Percent change
                    </NativeSelectOption>
                    <NativeSelectOption value="rank">
                      Rank by value
                    </NativeSelectOption>
                  </NativeSelect>
                </div>
                <div className="field-label">
                  <span>Sort by value</span>
                  <NativeSelect
                    value={selectedWidget.sortDirection ?? 'none'}
                    disabled={!canEdit}
                    onChange={(event) =>
                      updateWidget(selectedWidget.id, {
                        sortDirection: event.target.value as
                          | 'none'
                          | 'ascending'
                          | 'descending',
                      })
                    }
                  >
                    <NativeSelectOption value="none">
                      Source order
                    </NativeSelectOption>
                    <NativeSelectOption value="ascending">
                      Ascending
                    </NativeSelectOption>
                    <NativeSelectOption value="descending">
                      Descending
                    </NativeSelectOption>
                  </NativeSelect>
                </div>
                <label>
                  Top N
                  <input
                    className="form-input"
                    type="number"
                    min="1"
                    max="200"
                    value={selectedWidget.topN ?? 20}
                    disabled={!canEdit}
                    onChange={(event) =>
                      updateWidget(selectedWidget.id, {
                        topN: Math.max(
                          1,
                          Math.min(200, Number(event.target.value)),
                        ),
                      })
                    }
                  />
                </label>
                <div className="field-label">
                  <span>Number format</span>
                  <NativeSelect
                    value={selectedWidget.numberFormat}
                    disabled={!canEdit}
                    onChange={(event) =>
                      updateWidget(selectedWidget.id, {
                        numberFormat: event.target.value as NumberFormat,
                      })
                    }
                  >
                    <NativeSelectOption value="compact">
                      Compact
                    </NativeSelectOption>
                    <NativeSelectOption value="standard">
                      Standard
                    </NativeSelectOption>
                    <NativeSelectOption value="currency">
                      Currency
                    </NativeSelectOption>
                    <NativeSelectOption value="percent">
                      Percent
                    </NativeSelectOption>
                  </NativeSelect>
                </div>
                <label>
                  Series color
                  <input
                    type="color"
                    value={selectedWidget.color}
                    disabled={!canEdit}
                    onChange={(event) =>
                      updateWidget(selectedWidget.id, {
                        color: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="inspector-check">
                  <input
                    type="checkbox"
                    checked={selectedWidget.conditionalFormatting ?? false}
                    disabled={!canEdit}
                    onChange={(event) =>
                      updateWidget(selectedWidget.id, {
                        conditionalFormatting: event.target.checked,
                      })
                    }
                  />
                  Conditional color scale
                </label>
                {selectedWidget.conditionalFormatting && (
                  <div className="conditional-colors">
                    <label>
                      Low
                      <input
                        type="color"
                        value={selectedWidget.conditionalMinColor ?? '#dbeafe'}
                        disabled={!canEdit}
                        onChange={(event) =>
                          updateWidget(selectedWidget.id, {
                            conditionalMinColor: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      High
                      <input
                        type="color"
                        value={
                          selectedWidget.conditionalMaxColor ??
                          selectedWidget.color
                        }
                        disabled={!canEdit}
                        onChange={(event) =>
                          updateWidget(selectedWidget.id, {
                            conditionalMaxColor: event.target.value,
                          })
                        }
                      />
                    </label>
                  </div>
                )}
                <div className="check-grid">
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedWidget.showGrid}
                      disabled={!canEdit}
                      onChange={(event) =>
                        updateWidget(selectedWidget.id, {
                          showGrid: event.target.checked,
                        })
                      }
                    />
                    Grid lines
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedWidget.showLegend}
                      disabled={!canEdit}
                      onChange={(event) =>
                        updateWidget(selectedWidget.id, {
                          showLegend: event.target.checked,
                        })
                      }
                    />
                    Legend
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedWidget.interactions}
                      disabled={!canEdit}
                      onChange={(event) =>
                        updateWidget(selectedWidget.id, {
                          interactions: event.target.checked,
                        })
                      }
                    />
                    Cross-filter
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedWidget.hidden ?? false}
                      disabled={!canEdit}
                      onChange={(event) =>
                        updateWidget(selectedWidget.id, {
                          hidden: event.target.checked,
                        })
                      }
                    />
                    Hide visual
                  </label>
                </div>
                <div className="inspector-actions">
                  <Button
                    variant="outline"
                    onClick={() => duplicateWidget(selectedWidget)}
                    disabled={!canEdit}
                  >
                    <Copy />
                    Duplicate
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => removeWidget(selectedWidget.id)}
                    disabled={!canEdit}
                  >
                    <Trash2 />
                    Delete
                  </Button>
                </div>
              </div>
            ) : (
              <div className="empty-inspector">
                <PencilRuler />
                <p>
                  Choose a chart on the canvas to edit its data, visual style,
                  and interactions.
                </p>
              </div>
            )}
          </aside>
        )}
      </div>

      {showLibrary && (
        <dialog open className="modal-backdrop">
          <section className="report-library" aria-label="Report library">
            <header>
              <div>
                <p className="eyebrow">Local workspace</p>
                <h2>Report library</h2>
                <p>
                  Saved in IndexedDB on this browser. Share a portable bundle
                  for collaboration.
                </p>
              </div>
              <button onClick={() => setShowLibrary(false)}>
                <X />
              </button>
            </header>
            <div className="library-actions">
              <Button onClick={() => void saveNow()}>
                <Save />
                Save current
              </Button>
              <Button variant="outline" onClick={exportReport}>
                <Share2 />
                Export bundle
              </Button>
              <Button
                variant="outline"
                onClick={() => reportInput.current?.click()}
              >
                <Upload />
                Open bundle
              </Button>
            </div>
            <div className="role-note">
              <LockKeyhole />
              <span>
                <strong>Local role simulation</strong>
                <small>
                  Owner, Editor, and Viewer modes control this UI. They are
                  workflow guards, not server security.
                </small>
              </span>
            </div>
            <div className="saved-report-list">
              {savedReports.map((saved) => (
                <article key={saved.id}>
                  <FileSpreadsheet />
                  <div>
                    <strong>{saved.name}</strong>
                    <small>
                      {saved.tableCount} tables · {saved.widgetCount} visuals ·{' '}
                      {new Date(saved.updatedAt).toLocaleString()}
                    </small>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void loadReport(saved.id).then((loaded) => {
                        if (loaded) {
                          replaceReport(loaded);
                          setActiveTableId(loaded.tables[0]?.id ?? '');
                          setSelectedWidgetId(loaded.widgets[0]?.id ?? '');
                          setActivePageId(loaded.pages[0]?.id ?? '');
                          setShowLibrary(false);
                        }
                      })
                    }
                  >
                    Open
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    disabled={!canManage}
                    aria-label="Delete saved report"
                    onClick={() =>
                      void deleteReport(saved.id).then(refreshLibrary)
                    }
                  >
                    <Trash2 />
                  </Button>
                </article>
              ))}
            </div>
          </section>
        </dialog>
      )}
    </main>
  );
}
