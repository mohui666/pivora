'use client';

import {
  AreaChart as AreaChartIcon,
  BarChart3,
  Database,
  Download,
  FileSpreadsheet,
  FileUp,
  Filter,
  LayoutDashboard,
  LineChart as LineChartIcon,
  Moon,
  PieChart as PieChartIcon,
  Plus,
  Search,
  Sigma,
  Sun,
  Table2,
  X,
} from 'lucide-react';
import Papa from 'papaparse';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  type Aggregation,
  aggregateRows,
  type DataRow,
  type Field,
  formatMetric,
  inferFields,
  normalizeRows,
  summarize,
} from '@/lib/analytics';

type ChartKind = 'bar' | 'line' | 'area' | 'pie';
type View = 'report' | 'data';

const COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

const sampleRows: DataRow[] = [
  ['2026-01-08', 'North', 'Hardware', 18600, 42, 4200],
  ['2026-01-19', 'East', 'Software', 24000, 18, 11200],
  ['2026-02-03', 'South', 'Services', 15300, 31, 5800],
  ['2026-02-24', 'West', 'Hardware', 32800, 66, 7400],
  ['2026-03-02', 'North', 'Software', 27400, 21, 12600],
  ['2026-03-18', 'East', 'Services', 24300, 39, 8900],
  ['2026-04-07', 'South', 'Hardware', 35200, 74, 8100],
  ['2026-04-21', 'West', 'Software', 24000, 17, 10500],
  ['2026-05-04', 'North', 'Services', 26700, 45, 9200],
  ['2026-05-15', 'East', 'Hardware', 36400, 79, 8400],
  ['2026-06-06', 'South', 'Software', 39800, 26, 18100],
  ['2026-06-22', 'West', 'Services', 33000, 52, 11600],
  ['2026-07-01', 'North', 'Hardware', 42100, 88, 9800],
  ['2026-07-17', 'East', 'Software', 35400, 24, 15900],
  ['2026-08-09', 'South', 'Services', 31600, 49, 10900],
  ['2026-08-25', 'West', 'Hardware', 46700, 94, 10800],
].map(([order_date, region, category, revenue, units, profit]) => ({
  order_date,
  region,
  category,
  revenue,
  units,
  profit,
}));

function ChartVisual({
  kind,
  points,
}: {
  kind: ChartKind;
  points: { label: string; value: number }[];
}) {
  const tooltip = (
    <Tooltip
      cursor={{ fill: 'var(--muted)' }}
      contentStyle={{
        borderRadius: 10,
        borderColor: 'var(--border)',
        background: 'var(--card)',
        color: 'var(--card-foreground)',
      }}
      formatter={(value) => [formatMetric(Number(value)), 'Value']}
    />
  );
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
      <XAxis
        dataKey="label"
        axisLine={false}
        tickLine={false}
        tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
      />
      <YAxis
        axisLine={false}
        tickLine={false}
        width={48}
        tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
        tickFormatter={formatMetric}
      />
    </>
  );

  if (!points.length) {
    return (
      <div className="grid h-full place-items-center text-center text-sm text-muted-foreground">
        <div><Database className="mx-auto mb-2 size-6 opacity-50" />No matching rows</div>
      </div>
    );
  }
  if (kind === 'line') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          {axes}{tooltip}
          <Line type="monotone" dataKey="value" stroke="var(--chart-1)" strokeWidth={3} dot={{ r: 3, fill: 'var(--card)' }} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    );
  }
  if (kind === 'area') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <defs><linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} /><stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} /></linearGradient></defs>
          {axes}{tooltip}
          <Area type="monotone" dataKey="value" stroke="var(--chart-1)" strokeWidth={3} fill="url(#areaFill)" />
        </AreaChart>
      </ResponsiveContainer>
    );
  }
  if (kind === 'pie') {
    const piePoints = points.map((point, index) => ({
      ...point,
      fill: COLORS[index % COLORS.length],
    }));
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          {tooltip}
          <Pie data={piePoints} dataKey="value" nameKey="label" innerRadius="44%" outerRadius="76%" paddingAngle={2} label={({ name }) => String(name)} labelLine={false} />
        </PieChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        {axes}{tooltip}
        <Bar dataKey="value" fill="var(--chart-1)" radius={[6, 6, 2, 2]} maxBarSize={56} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function VisualSettings({
  compact = false,
  chartKind,
  dimension,
  measure,
  aggregation,
  fields,
  numericFields,
  onChartKind,
  onDimension,
  onMeasure,
  onAggregation,
}: {
  compact?: boolean;
  chartKind: ChartKind;
  dimension: string;
  measure: string;
  aggregation: Aggregation;
  fields: Field[];
  numericFields: Field[];
  onChartKind: (value: ChartKind) => void;
  onDimension: (value: string) => void;
  onMeasure: (value: string) => void;
  onAggregation: (value: Aggregation) => void;
}) {
  return (
    <div className={compact ? 'grid gap-3 sm:grid-cols-2' : 'space-y-5'}>
      <div><label className="control-label" htmlFor={compact ? 'mobile-chart-type' : 'chart-type'}>Chart type</label><NativeSelect className="mt-1.5 w-full" id={compact ? 'mobile-chart-type' : 'chart-type'} value={chartKind} onChange={(event) => onChartKind(event.target.value as ChartKind)}><NativeSelectOption value="bar">Bar chart</NativeSelectOption><NativeSelectOption value="line">Line chart</NativeSelectOption><NativeSelectOption value="area">Area chart</NativeSelectOption><NativeSelectOption value="pie">Donut chart</NativeSelectOption></NativeSelect></div>
      <div><label className="control-label" htmlFor={compact ? 'mobile-dimension' : 'dimension'}>Dimension</label><NativeSelect className="mt-1.5 w-full" id={compact ? 'mobile-dimension' : 'dimension'} value={dimension} onChange={(event) => onDimension(event.target.value)}>{fields.map((field) => <NativeSelectOption key={field.name} value={field.name}>{field.name}</NativeSelectOption>)}</NativeSelect></div>
      <div><label className="control-label" htmlFor={compact ? 'mobile-measure' : 'measure'}>Measure</label><NativeSelect className="mt-1.5 w-full" id={compact ? 'mobile-measure' : 'measure'} value={measure} onChange={(event) => onMeasure(event.target.value)}>{numericFields.map((field) => <NativeSelectOption key={field.name} value={field.name}>{field.name}</NativeSelectOption>)}<NativeSelectOption value="__rows">Row count</NativeSelectOption></NativeSelect></div>
      <div><label className="control-label" htmlFor={compact ? 'mobile-aggregation' : 'aggregation'}>Aggregation</label><NativeSelect className="mt-1.5 w-full" id={compact ? 'mobile-aggregation' : 'aggregation'} value={aggregation} onChange={(event) => onAggregation(event.target.value as Aggregation)}><NativeSelectOption value="sum">Sum</NativeSelectOption><NativeSelectOption value="average">Average</NativeSelectOption><NativeSelectOption value="count">Count</NativeSelectOption></NativeSelect></div>
    </div>
  );
}

export default function Home() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<View>('report');
  const [rows, setRows] = useState<DataRow[]>(sampleRows);
  const [fileName, setFileName] = useState('retail_sales_sample.csv');
  const [dimension, setDimension] = useState('order_date');
  const [measure, setMeasure] = useState('revenue');
  const [aggregation, setAggregation] = useState<Aggregation>('sum');
  const [chartKind, setChartKind] = useState<ChartKind>('bar');
  const [filterValue, setFilterValue] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [fieldSearch, setFieldSearch] = useState('');
  const [dark, setDark] = useState(false);
  const [notice, setNotice] = useState('');

  const fields = useMemo(() => inferFields(rows), [rows]);
  const numericFields = fields.filter((field) => field.kind === 'number');
  const dimensionField = fields.find((field) => field.name === dimension) ?? fields[0];
  const unfilteredPoints = useMemo(
    () =>
      aggregateRows({
        rows,
        dimension,
        dimensionKind: dimensionField?.kind ?? 'text',
        measure,
        aggregation,
      }),
    [aggregation, dimension, dimensionField?.kind, measure, rows],
  );
  const points = useMemo(
    () =>
      aggregateRows({
        rows,
        dimension,
        dimensionKind: dimensionField?.kind ?? 'text',
        measure,
        aggregation,
        filterValue: filterValue || undefined,
      }),
    [aggregation, dimension, dimensionField?.kind, filterValue, measure, rows],
  );
  const summary = useMemo(() => summarize(rows, measure), [measure, rows]);
  const visibleFields = fields.filter((field) =>
    field.name.toLowerCase().includes(fieldSearch.toLowerCase()),
  );

  useEffect(() => {
    const saved = localStorage.getItem('locallens-view');
    if (!saved) return;
    const timer = window.setTimeout(() => {
      try {
        const config = JSON.parse(saved) as Partial<{
          dimension: string;
          measure: string;
          aggregation: Aggregation;
          chartKind: ChartKind;
          dark: boolean;
        }>;
        if (config.dimension) setDimension(config.dimension);
        if (config.measure) setMeasure(config.measure);
        if (config.aggregation) setAggregation(config.aggregation);
        if (config.chartKind) setChartKind(config.chartKind);
        if (config.dark !== undefined) setDark(config.dark);
      } catch {
        localStorage.removeItem('locallens-view');
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem(
      'locallens-view',
      JSON.stringify({ dimension, measure, aggregation, chartKind, dark }),
    );
  }, [aggregation, chartKind, dark, dimension, measure]);

  function importCsv(file?: File) {
    if (!file) return;
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (result) => {
        const normalized = normalizeRows(result.data);
        const nextFields = inferFields(normalized);
        if (!normalized.length || !nextFields.length) {
          setNotice('This CSV has no readable rows or headers.');
          return;
        }
        const firstNumeric = nextFields.find((field) => field.kind === 'number');
        const firstDimension = nextFields.find((field) => field.kind !== 'number') ?? nextFields[0];
        setRows(normalized);
        setFileName(file.name);
        setDimension(firstDimension.name);
        setMeasure(firstNumeric?.name ?? '__rows');
        setAggregation(firstNumeric ? 'sum' : 'count');
        setFilterValue('');
        setNotice(`Imported ${normalized.length.toLocaleString()} rows from ${file.name}.`);
        setTimeout(() => setNotice(''), 3600);
      },
      error: (error) => setNotice(`Could not read this CSV: ${error.message}`),
    });
  }

  function resetView() {
    const firstDimension = fields.find((field) => field.kind !== 'number') ?? fields[0];
    setDimension(firstDimension?.name ?? '');
    setMeasure(numericFields[0]?.name ?? '__rows');
    setAggregation(numericFields.length ? 'sum' : 'count');
    setChartKind('bar');
    setFilterValue('');
    setNotice('Started a fresh analysis view.');
    setTimeout(() => setNotice(''), 2600);
  }

  function exportView() {
    const payload = {
      app: 'LocalLens BI',
      dataset: fileName,
      exportedAt: new Date().toISOString(),
      view: { dimension, measure, aggregation, chartKind, filterValue },
      result: points,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'locallens-view.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const settingsProps = {
    chartKind,
    dimension,
    measure,
    aggregation,
    fields,
    numericFields,
    onChartKind: setChartKind,
    onDimension: (value: string) => { setDimension(value); setFilterValue(''); },
    onMeasure: (value: string) => { setMeasure(value); if (value === '__rows') setAggregation('count'); },
    onAggregation: setAggregation,
  };

  return (
    <main className="app-shell min-h-screen bg-background text-foreground">
      <input ref={fileInput} type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => importCsv(event.target.files?.[0])} />
      <header className="flex h-14 items-center justify-between border-b bg-card px-3 sm:px-5">
        <div className="flex items-center gap-2.5">
          <span className="brand-mark">L</span>
          <div><p className="text-sm font-semibold leading-none">LocalLens BI</p><p className="mt-1 hidden text-[9px] font-bold tracking-[0.13em] text-muted-foreground sm:block">LOCAL-FIRST ANALYTICS</p></div>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="hidden lg:inline-flex"><span className="mr-1 size-1.5 rounded-full bg-emerald-500" />Data stays on this device</Badge>
          <Button variant="ghost" size="icon-sm" aria-label={dark ? 'Use light theme' : 'Use dark theme'} onClick={() => setDark((value) => !value)}>{dark ? <Sun /> : <Moon />}</Button>
          <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}><FileUp /><span className="hidden sm:inline">Import CSV</span></Button>
          <Button size="sm" onClick={resetView}><Plus /><span className="hidden sm:inline">New view</span></Button>
        </div>
      </header>

      {notice && <output className="notice">{notice}<button aria-label="Dismiss" onClick={() => setNotice('')}><X /></button></output>}

      <div className="workspace-grid">
        <aside className="left-rail border-r bg-card p-3">
          <nav className="space-y-1" aria-label="Workspace">
            <button className={`nav-item ${view === 'report' ? 'nav-item-active' : ''}`} onClick={() => setView('report')} type="button"><LayoutDashboard />Report</button>
            <button className={`nav-item ${view === 'data' ? 'nav-item-active' : ''}`} onClick={() => setView('data')} type="button"><Table2 />Data preview</button>
          </nav>
          <div className="mt-7 px-2"><p className="eyebrow">Dataset</p></div>
          <div className="mt-2 rounded-xl border bg-background p-3">
            <div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary"><FileSpreadsheet className="size-4" /></span><div className="min-w-0"><p className="truncate text-xs font-semibold" title={fileName}>{fileName}</p><p className="text-[11px] text-muted-foreground">{rows.length.toLocaleString()} rows · {fields.length} fields</p></div></div>
          </div>
          <div className="relative mt-4"><Search className="absolute left-2.5 top-2 size-3.5 text-muted-foreground" /><Input className="h-8 pl-8 text-xs" placeholder="Find a field" value={fieldSearch} onChange={(event) => setFieldSearch(event.target.value)} /></div>
          <div className="mt-3 max-h-[calc(100vh-290px)] space-y-1 overflow-auto">
            {visibleFields.map((field) => <button className="field-row" key={field.name} type="button" onClick={() => field.kind === 'number' ? setMeasure(field.name) : setDimension(field.name)}><span className={field.kind === 'number' ? 'field-icon metric' : 'field-icon'}>{field.kind === 'number' ? '#' : field.kind === 'date' ? '◷' : 'Aa'}</span><span className="truncate">{field.name}</span><span className="ml-auto text-[10px] text-muted-foreground">{field.uniqueCount}</span></button>)}
          </div>
        </aside>

        <section className="report-canvas min-w-0 overflow-auto p-4 lg:p-6">
          <div className="mx-auto max-w-5xl">
            {view === 'report' ? (
              <>
                <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
                  <div><div className="mb-1 flex items-center gap-2"><p className="eyebrow">Analysis view</p><Badge variant="secondary">Auto-saved</Badge></div><h1 className="text-2xl font-semibold tracking-tight">Explore {fileName.replace(/\.csv$/i, '')}</h1><p className="mt-1 text-sm text-muted-foreground">Change any field to recalculate the report instantly.</p></div>
                  <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setShowFilter((value) => !value)}><Filter />Filter</Button><Button variant="outline" size="sm" onClick={exportView}><Download />Export view</Button></div>
                </div>

                {showFilter && <div className="filter-bar"><div><p className="text-xs font-semibold">Filter by {dimension}</p><p className="text-[11px] text-muted-foreground">Limit the report to one dimension value.</p></div><NativeSelect className="w-full sm:w-56" value={filterValue} onChange={(event) => setFilterValue(event.target.value)}><NativeSelectOption value="">All values</NativeSelectOption>{unfilteredPoints.map((point) => <NativeSelectOption key={point.label} value={point.label}>{point.label}</NativeSelectOption>)}</NativeSelect><Button variant="ghost" size="icon-sm" aria-label="Close filter" onClick={() => { setShowFilter(false); setFilterValue(''); }}><X /></Button></div>}

                <div className="mobile-settings mb-4 rounded-xl border bg-card p-4"><div className="mb-3 flex items-center gap-2"><BarChart3 className="size-4 text-primary" /><p className="text-sm font-semibold">Visual settings</p></div><VisualSettings compact {...settingsProps} /></div>

                <div className="mb-4 grid gap-3 sm:grid-cols-3">
                  {[['Total', formatMetric(summary.total), 'selected measure'], ['Rows', summary.rows.toLocaleString(), `${fields.length} detected fields`], ['Average', formatMetric(summary.average), `${summary.populated.toLocaleString()} numeric values`]].map(([label, value, detail]) => <article className="metric-card" key={label}><p className="text-xs font-medium text-muted-foreground">{label}</p><strong className="mt-2 block text-2xl font-semibold tracking-tight">{value}</strong><p className="mt-1 text-[11px] text-muted-foreground">{detail}</p></article>)}
                </div>

                <article className="chart-card">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4"><div><p className="font-semibold">{aggregation.toUpperCase()}({measure === '__rows' ? 'rows' : measure}) by {dimension}</p><p className="text-xs text-muted-foreground">{points.length} groups · {filterValue || 'all values'}</p></div><Badge variant="outline">{chartKind === 'bar' ? <BarChart3 /> : chartKind === 'line' ? <LineChartIcon /> : chartKind === 'area' ? <AreaChartIcon /> : <PieChartIcon />}{chartKind}</Badge></div>
                  <div className="h-[380px] p-3 pt-6 sm:p-5"><ChartVisual kind={chartKind} points={points} /></div>
                </article>
              </>
            ) : (
              <>
                <div className="mb-5"><p className="eyebrow">Data preview</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">{fileName}</h1><p className="mt-1 text-sm text-muted-foreground">Showing the first 100 rows. Values are parsed locally.</p></div>
                <div className="overflow-hidden rounded-xl border bg-card"><div className="overflow-auto"><table className="data-table"><thead><tr>{fields.map((field) => <th key={field.name}><span>{field.name}</span><small>{field.kind}</small></th>)}</tr></thead><tbody>{rows.slice(0, 100).map((row, index) => <tr key={index}>{fields.map((field) => <td key={field.name}>{row[field.name] === null ? <span className="text-muted-foreground">null</span> : String(row[field.name])}</td>)}</tr>)}</tbody></table></div><div className="border-t px-4 py-3 text-xs text-muted-foreground">{Math.min(rows.length, 100).toLocaleString()} of {rows.length.toLocaleString()} rows shown</div></div>
              </>
            )}
          </div>
        </section>

        <aside className="right-panel border-l bg-card p-4">
          <div className="flex items-center gap-2"><BarChart3 className="size-4 text-primary" /><h2 className="text-sm font-semibold">Visual settings</h2></div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Shape the chart using fields detected from your file.</p>
          <div className="mt-5"><VisualSettings {...settingsProps} /></div>
          <div className="mt-7 rounded-xl border border-dashed p-3 text-xs leading-relaxed text-muted-foreground"><Sigma className="mb-2 size-4 text-primary" />Calculations run in this tab. LocalLens does not send imported rows to a server.</div>
        </aside>
      </div>
    </main>
  );
}
