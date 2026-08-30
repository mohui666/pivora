'use client';

import { toPng } from 'html-to-image';
import {
  BookmarkPlus,
  BookOpen,
  Calculator,
  Copy,
  Database,
  FileDown,
  FilePlus2,
  FileSpreadsheet,
  Filter,
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
} from '@/lib/analytics';
import {
  createId,
  filterRows,
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
  ReportPage,
  ReportRole,
  ReportSummary,
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

type View = 'dashboard' | 'data' | 'model';
type LocalFileHandle = { name: string; getFile: () => Promise<File> };

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
  const [savedReports, setSavedReports] = useState<ReportSummary[]>([]);
  const [dataPage, setDataPage] = useState(0);
  const [dataSearch, setDataSearch] = useState('');
  const [relationDraft, setRelationDraft] = useState<Omit<Relationship, 'id'>>({
    leftTableId: 'table_sales',
    leftField: 'product_id',
    rightTableId: 'table_products',
    rightField: 'product_id',
    cardinality: 'many-to-one',
    crossFilterDirection: 'single',
    active: true,
  });
  const [calcDraft, setCalcDraft] = useState({
    tableId: 'table_sales',
    name: '',
    expression: '',
  });
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
  });
  const dataInput = useRef<HTMLInputElement>(null);
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
    updateReport((current) => ({
      ...current,
      pages: current.pages.filter((page) => page.id !== activePage.id),
      widgets: current.widgets.filter(
        (widget) => widget.pageId !== activePage.id,
      ),
      bookmarks: current.bookmarks.filter(
        (bookmark) => bookmark.pageId !== activePage.id,
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
        }),
      );
    }
    return map;
  }, [
    report.calculatedFields,
    report.relationships,
    report.tables,
    report.transforms,
    report.querySteps,
  ]);

  const fieldsFor = useCallback(
    (tableId: string) => materializedFields(materialized.get(tableId) ?? []),
    [materialized],
  );

  const pointsFor = useCallback(
    (widget: ChartWidget) => {
      const rows = materialized.get(widget.tableId) ?? [];
      const filters = report.filters.filter(
        (filter) => filter.sourceWidgetId !== widget.id,
      );
      const filtered = filterRows(rows, filters, widget.tableId, report.tables);
      const dimensionKind =
        fieldsFor(widget.tableId).find(
          (field) => field.name === widget.dimension,
        )?.kind ?? 'text';
      let points = aggregateRows({
        rows: filtered,
        dimension: widget.dimension,
        dimensionKind,
        measure: widget.measure,
        aggregation: widget.aggregation,
      });
      points = applyQuickCalculation(points, widget.calculation);
      if (widget.sortDirection !== 'none') {
        const direction = widget.sortDirection === 'ascending' ? 1 : -1;
        points = [...points].sort((a, b) => (a.value - b.value) * direction);
      }
      return points.slice(0, Math.max(1, widget.topN ?? 20));
    },
    [fieldsFor, materialized, report.filters, report.tables],
  );

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
      filters: current.filters.filter((filter) => filter.sourceWidgetId !== id),
    }));
    setSelectedWidgetId('');
  }

  function applyCrossFilter(widget: ChartWidget, value: string) {
    if (!widget.interactions) return;
    const [prefix, ...rest] = widget.dimension.split('.');
    const related = rest.length
      ? report.tables.find((table) => table.name === prefix)
      : undefined;
    const tableId = related?.id ?? widget.tableId;
    const field = related ? rest.join('.') : widget.dimension;
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
            value,
            sourceWidgetId: widget.id,
          },
        ],
      };
    });
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

  function addQueryStep() {
    if (!canEdit || !activeTable) return;
    if (
      ['filter', 'sort', 'remove-duplicates'].includes(queryDraft.kind) &&
      !queryDraft.field
    ) {
      return showNotice('Choose a field for this query step.');
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
      `${report.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.llbi`,
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

  const activeRows = materialized.get(activeTable?.id ?? '') ?? [];
  const activeFields = materializedFields(activeRows);
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

  return (
    <main className="bi-shell min-h-screen bg-background text-foreground">
      <input
        ref={dataInput}
        type="file"
        multiple
        accept=".csv,.json,.xml,.xlsx,.xls,.xlsm,.sqlite,.sqlite3,.db"
        className="sr-only"
        onChange={(event) =>
          void mergeFiles(Array.from(event.target.files ?? []))
        }
      />
      <input
        ref={reportInput}
        type="file"
        accept=".llbi,application/json"
        className="sr-only"
        onChange={(event) => void importReport(event.target.files?.[0])}
      />

      <header className="bi-header">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="brand-mark">L</span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">LocalLens BI</p>
            <p className="hidden text-[9px] font-bold tracking-[.13em] text-muted-foreground sm:block">
              LOCAL ANALYTICS STUDIO
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
                    onClick={() => void exportDashboard('png')}
                  >
                    <ImageDown />
                    PNG
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void exportDashboard('pdf')}
                  >
                    <FileDown />
                    PDF
                  </Button>
                </div>
              </div>

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
                        {
                          report.tables.find(
                            (table) => table.id === filter.tableId,
                          )?.name
                        }
                        .{filter.field}
                      </span>
                      <strong>{filter.value}</strong>
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
                            {canEdit && (
                              <div className="visual-actions">
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
                              </div>
                            )}
                          </header>
                          <div className="visual-body">
                            <ChartVisual
                              widget={widget}
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
                                applyCrossFilter(widget, value)
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
                </div>
              </div>

              <div className="data-prep-grid">
                <section className="prep-panel query-steps-panel">
                  <div className="panel-title">
                    <Filter />
                    <div>
                      <strong>Applied query steps</strong>
                      <small>
                        Filter, sort, deduplicate, limit, and add an index in
                        order.
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
                    </NativeSelect>
                    {['filter', 'sort', 'remove-duplicates'].includes(
                      queryDraft.kind,
                    ) && (
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
                          <small>
                            {step.kind === 'filter'
                              ? `${step.field} · ${step.operator} ${step.value}`
                              : step.kind === 'sort'
                                ? `${step.field} · ${step.direction}`
                                : step.kind === 'remove-duplicates'
                                  ? step.field
                                  : step.kind === 'limit'
                                    ? `${step.count} rows`
                                    : `${step.name} from ${step.start}`}
                          </small>
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
                    {report.relationships.map((relation) => (
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
                  Measure
                  <NativeSelect
                    value={selectedWidget.measure}
                    disabled={!canEdit}
                    onChange={(event) =>
                      updateWidget(selectedWidget.id, {
                        measure: event.target.value,
                      })
                    }
                  >
                    {selectedNumericFields.map((field) => (
                      <NativeSelectOption key={field.name} value={field.name}>
                        {field.name}
                      </NativeSelectOption>
                    ))}
                    <NativeSelectOption value="__rows">
                      Row count
                    </NativeSelectOption>
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
                    value={selectedWidget.aggregation}
                    disabled={!canEdit}
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
                    value={selectedWidget.calculation ?? 'none'}
                    disabled={!canEdit}
                    onChange={(event) =>
                      updateWidget(selectedWidget.id, {
                        calculation: event.target.value as
                          | 'none'
                          | 'running-total'
                          | 'percent-of-total'
                          | 'difference',
                        numberFormat:
                          event.target.value === 'percent-of-total'
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
