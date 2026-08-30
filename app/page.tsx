"use client";

import { toPng } from "html-to-image";
import {
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
  Save,
  Settings2,
  Share2,
  Sun,
  Table2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactGridLayout, {
  type Layout,
  useContainerWidth,
  verticalCompactor,
} from "react-grid-layout";

import { ChartVisual } from "@/components/bi/chart-visual";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { aggregateRows, type Aggregation, inferFields } from "@/lib/analytics";
import {
  createId,
  filterRows,
  materializedFields,
  materializeTable,
  validateCalculatedExpression,
  validateRelationship,
} from "@/lib/bi-model";
import type {
  CalculatedField,
  ChartKind,
  ChartWidget,
  ColumnTransform,
  DataTable,
  NumberFormat,
  Relationship,
  ReportDocument,
  ReportRole,
  ReportSummary,
} from "@/lib/bi-types";
import { parseDataFile } from "@/lib/data-import";
import {
  deleteReport,
  listReports,
  loadReport,
  saveReport,
} from "@/lib/report-storage";
import { createSampleReport } from "@/lib/sample-report";

type View = "dashboard" | "data" | "model";
type LocalFileHandle = { name: string; getFile: () => Promise<File> };

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function defaultWidget(
  table: DataTable,
  rows: DataTable["rows"],
  y: number,
): ChartWidget {
  const fields = inferFields(rows);
  const dimension =
    fields.find((field) => field.kind !== "number") ?? fields[0];
  const measure = fields.find((field) => field.kind === "number");
  return {
    id: createId("widget"),
    title: `New visual · ${table.name}`,
    tableId: table.id,
    kind: measure ? "bar" : "table",
    dimension: dimension?.name ?? "",
    measure: measure?.name ?? "__rows",
    aggregation: measure ? "sum" : "count",
    color: "#4f6df5",
    showGrid: true,
    showLegend: false,
    numberFormat: "compact",
    interactions: true,
    layout: { x: 0, y, w: 6, h: 7 },
  };
}

export default function Home() {
  const [report, setReport] = useState<ReportDocument>(() =>
    createSampleReport(),
  );
  const [view, setView] = useState<View>("dashboard");
  const [activeTableId, setActiveTableId] = useState("table_sales");
  const [selectedWidgetId, setSelectedWidgetId] = useState("widget_revenue");
  const [dark, setDark] = useState(false);
  const [notice, setNotice] = useState("");
  const [importing, setImporting] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [savedReports, setSavedReports] = useState<ReportSummary[]>([]);
  const [dataPage, setDataPage] = useState(0);
  const [dataSearch, setDataSearch] = useState("");
  const [relationDraft, setRelationDraft] = useState({
    leftTableId: "table_sales",
    leftField: "product_id",
    rightTableId: "table_products",
    rightField: "product_id",
  });
  const [calcDraft, setCalcDraft] = useState({
    tableId: "table_sales",
    name: "",
    expression: "",
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

  const canEdit = report.role !== "viewer";
  const canManage = report.role === "owner";
  const activeTable =
    report.tables.find((table) => table.id === activeTableId) ??
    report.tables[0];
  const selectedWidget = report.widgets.find(
    (widget) => widget.id === selectedWidgetId,
  );

  const updateReport = useCallback(
    (updater: (current: ReportDocument) => ReportDocument) => {
      setReport((current) => {
        const next = updater(current);
        return next === current
          ? current
          : { ...next, updatedAt: new Date().toISOString() };
      });
    },
    [],
  );

  const materialized = useMemo(() => {
    const map = new Map<string, DataTable["rows"]>();
    for (const table of report.tables) {
      map.set(
        table.id,
        materializeTable({
          tableId: table.id,
          tables: report.tables,
          relationships: report.relationships,
          calculatedFields: report.calculatedFields,
          transforms: report.transforms,
        }),
      );
    }
    return map;
  }, [
    report.calculatedFields,
    report.relationships,
    report.tables,
    report.transforms,
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
        )?.kind ?? "text";
      return aggregateRows({
        rows: filtered,
        dimension: widget.dimension,
        dimensionKind,
        measure: widget.measure,
        aggregation: widget.aggregation,
      });
    },
    [fieldsFor, materialized, report.filters, report.tables],
  );

  const refreshLibrary = useCallback(async () => {
    setSavedReports(await listReports());
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void saveReport(report).then(refreshLibrary);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [refreshLibrary, report]);

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3600);
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
          widgets = [defaultWidget(reconciled[0], reconciled[0].rows, 0)];
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
      showNotice(error instanceof Error ? error.message : "Import failed.");
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
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        dataInput.current?.click();
      }
    }
  }

  async function refreshSources(silent = false) {
    const handles = Array.from(fileHandles.current.values());
    if (!handles.length) {
      if (!silent)
        showNotice(
          "Re-import with the file picker once to grant refresh access.",
        );
      return;
    }
    const files = await Promise.all(handles.map((handle) => handle.getFile()));
    await mergeFiles(files, handles, silent);
    if (!silent) showNotice("Local sources refreshed.");
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
    if (!canEdit || !activeTable) return;
    const y = report.widgets.reduce(
      (maximum, widget) => Math.max(maximum, widget.layout.y + widget.layout.h),
      0,
    );
    const widget = defaultWidget(
      activeTable,
      materialized.get(activeTable.id) ?? activeTable.rows,
      y,
    );
    updateReport((current) => ({
      ...current,
      widgets: [...current.widgets, widget],
    }));
    setSelectedWidgetId(widget.id);
    setView("dashboard");
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
      id: createId("widget"),
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
    setSelectedWidgetId("");
  }

  function applyCrossFilter(widget: ChartWidget, value: string) {
    if (!widget.interactions) return;
    const [prefix, ...rest] = widget.dimension.split(".");
    const related = rest.length
      ? report.tables.find((table) => table.name === prefix)
      : undefined;
    const tableId = related?.id ?? widget.tableId;
    const field = related ? rest.join(".") : widget.dimension;
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
            id: createId("filter"),
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
        id: existing?.id ?? createId("transform"),
        tableId,
        field,
        kind: inferred?.kind ?? "text",
        trim: false,
        fillNull: "",
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
      id: createId("relation"),
      ...relationDraft,
    };
    updateReport((current) => ({
      ...current,
      relationships: [...current.relationships, relationship],
    }));
    showNotice(
      "Relationship added. Related fields are now available to visuals.",
    );
  }

  function addCalculatedField() {
    const error = validateCalculatedExpression(calcDraft.expression);
    if (!calcDraft.name.trim()) return showNotice("Name the calculated field.");
    if (error) return showNotice(error);
    const field: CalculatedField = {
      id: createId("calc"),
      tableId: calcDraft.tableId,
      name: calcDraft.name.trim(),
      expression: calcDraft.expression,
    };
    updateReport((current) => ({
      ...current,
      calculatedFields: [...current.calculatedFields, field],
    }));
    setCalcDraft((current) => ({ ...current, name: "", expression: "" }));
    showNotice("Calculated field added.");
  }

  async function saveNow() {
    await saveReport(report);
    await refreshLibrary();
    showNotice("Report saved to this browser.");
  }

  function exportReport() {
    downloadBlob(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
      `${report.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.llbi`,
    );
  }

  async function importReport(file?: File) {
    if (!file) return;
    try {
      const value = JSON.parse(await file.text()) as ReportDocument;
      if (value.schemaVersion !== 2 || !Array.isArray(value.tables)) {
        throw new Error("This is not a LocalLens BI report bundle.");
      }
      setReport(value);
      setActiveTableId(value.tables[0]?.id ?? "");
      setSelectedWidgetId(value.widgets[0]?.id ?? "");
      await saveReport(value);
      await refreshLibrary();
      showNotice("Report bundle opened.");
    } catch (error) {
      showNotice(
        error instanceof Error ? error.message : "Could not open report.",
      );
    }
  }

  async function exportDashboard(kind: "png" | "pdf") {
    if (!dashboardRef.current) return;
    showNotice(`Preparing ${kind.toUpperCase()}…`);
    const dataUrl = await toPng(dashboardRef.current, {
      cacheBust: true,
      pixelRatio: 2,
      backgroundColor: dark ? "#151a24" : "#f5f7fb",
    });
    if (kind === "png") {
      const response = await fetch(dataUrl);
      downloadBlob(await response.blob(), `${report.name}.png`);
      return;
    }
    const { jsPDF } = await import("jspdf");
    const image = new Image();
    await new Promise<void>((resolve) => {
      image.onload = () => resolve();
      image.src = dataUrl;
    });
    const pdf = new jsPDF({
      orientation: "landscape",
      unit: "px",
      format: [image.width, image.height],
    });
    pdf.addImage(dataUrl, "PNG", 0, 0, image.width, image.height);
    pdf.save(`${report.name}.pdf`);
  }

  const activeRows = materialized.get(activeTable?.id ?? "") ?? [];
  const activeFields = materializedFields(activeRows);
  const searchedRows = dataSearch
    ? activeRows.filter((row) =>
        Object.values(row).some((value) =>
          String(value ?? "")
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
    (field) => field.kind === "number",
  );
  const rawActiveFields = inferFields(activeTable?.rows ?? []);

  return (
    <main className="bi-shell min-h-screen bg-background text-foreground">
      <input
        ref={dataInput}
        type="file"
        multiple
        accept=".csv,.json,.xlsx,.xls,.xlsm,.sqlite,.sqlite3,.db"
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
          <button aria-label="Dismiss" onClick={() => setNotice("")}>
            <X />
          </button>
        </output>
      )}

      <div
        className={`bi-workspace ${view === "dashboard" ? "with-inspector" : ""}`}
      >
        <aside className="bi-sidebar">
          <nav className="space-y-1" aria-label="Workspace">
            <button
              className={`nav-item ${view === "dashboard" ? "nav-item-active" : ""}`}
              onClick={() => setView("dashboard")}
            >
              <LayoutDashboard />
              Dashboard
            </button>
            <button
              className={`nav-item ${view === "data" ? "nav-item-active" : ""}`}
              onClick={() => setView("data")}
            >
              <Table2 />
              Data & clean
            </button>
            <button
              className={`nav-item ${view === "model" ? "nav-item-active" : ""}`}
              onClick={() => setView("model")}
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
                className={`table-source ${activeTable?.id === table.id ? "active" : ""}`}
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
                    {table.rows.length.toLocaleString()} rows ·{" "}
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
          {view === "dashboard" && (
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
                  <Button variant="outline" size="sm" onClick={exportReport}>
                    <Share2 />
                    Report bundle
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void exportDashboard("png")}
                  >
                    <ImageDown />
                    PNG
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void exportDashboard("pdf")}
                  >
                    <FileDown />
                    PDF
                  </Button>
                </div>
              </div>

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

              <div ref={dashboardRef} className="dashboard-export">
                <div ref={gridContainerRef} className="dashboard-grid-host">
                  {gridMounted && (
                    <ReactGridLayout
                      width={gridWidth}
                      layout={report.widgets.map((widget) => ({
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
                        handle: ".drag-handle",
                        cancel: "button,input,select",
                      }}
                      resizeConfig={{ enabled: canEdit, handles: ["se"] }}
                      compactor={verticalCompactor}
                      onLayoutChange={updateLayout}
                    >
                      {report.widgets.map((widget) => (
                        <article
                          key={widget.id}
                          className={`visual-card ${selectedWidgetId === widget.id ? "selected" : ""}`}
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

          {view === "data" && activeTable && (
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
                                  "date" | "number" | "text",
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
                            />{" "}
                            Trim
                          </label>
                          <input
                            className="form-input h-7"
                            placeholder="Fill null"
                            value={transform?.fillNull ?? ""}
                            disabled={!canEdit}
                            onChange={(event) =>
                              setTransform(activeTable.id, field.name, {
                                fillNull: event.target.value,
                              })
                            }
                          />
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
                      ).toLocaleString()}{" "}
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

          {view === "model" && (
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
                            )[0]?.name ?? "",
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
                            )[0]?.name ?? "",
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
                            matches{" "}
                            {
                              report.tables.find(
                                (table) => table.id === relation.rightTableId,
                              )?.name
                            }
                            .{relation.rightField}
                          </small>
                        </span>
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
                        {report.tables.length} tables ·{" "}
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
                              {field.kind === "number"
                                ? "#"
                                : field.kind === "date"
                                  ? "◷"
                                  : "Aa"}
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

        {view === "dashboard" && (
          <aside className="bi-inspector">
            <div className="inspector-heading">
              <PanelRight />
              <div>
                <strong>Visual inspector</strong>
                <small>
                  {selectedWidget
                    ? "Configure the selected visual"
                    : "Select a visual"}
                </small>
              </div>
            </div>
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
                    {["bar", "line", "area", "pie", "kpi", "table"].map(
                      (kind) => (
                        <NativeSelectOption key={kind} value={kind}>
                          {kind}
                        </NativeSelectOption>
                      ),
                    )}
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
                  </NativeSelect>
                </div>
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
                      {saved.tableCount} tables · {saved.widgetCount} visuals ·{" "}
                      {new Date(saved.updatedAt).toLocaleString()}
                    </small>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void loadReport(saved.id).then((loaded) => {
                        if (loaded) {
                          setReport(loaded);
                          setActiveTableId(loaded.tables[0]?.id ?? "");
                          setSelectedWidgetId(loaded.widgets[0]?.id ?? "");
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
