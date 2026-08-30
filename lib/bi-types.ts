import type {
  Aggregation,
  DataRow,
  FieldKind,
  QuickCalculation,
} from './analytics';

export type SourceKind = 'sample' | 'csv' | 'json' | 'xml' | 'excel' | 'sqlite';
export type ChartKind =
  | 'bar'
  | 'line'
  | 'area'
  | 'pie'
  | 'kpi'
  | 'table'
  | 'matrix'
  | 'scatter'
  | 'funnel'
  | 'waterfall'
  | 'treemap'
  | 'gauge'
  | 'combo'
  | 'slicer';
export type ReportRole = 'owner' | 'editor' | 'viewer';
export type NumberFormat = 'compact' | 'standard' | 'currency' | 'percent';
export type SortDirection = 'none' | 'ascending' | 'descending';
export type RelationshipCardinality =
  | 'one-to-one'
  | 'one-to-many'
  | 'many-to-one'
  | 'many-to-many';
export type CrossFilterDirection = 'single' | 'both';

export type DataTable = {
  id: string;
  name: string;
  rows: DataRow[];
  sourceKind: SourceKind;
  sourceName: string;
  importedAt: string;
  truncated?: boolean;
};

export type Relationship = {
  id: string;
  leftTableId: string;
  leftField: string;
  rightTableId: string;
  rightField: string;
  cardinality?: RelationshipCardinality;
  crossFilterDirection?: CrossFilterDirection;
  active?: boolean;
};

export type CalculatedField = {
  id: string;
  tableId: string;
  name: string;
  expression: string;
};

export type ColumnTransform = {
  id: string;
  tableId: string;
  field: string;
  kind: FieldKind;
  trim: boolean;
  fillNull: string;
  remove?: boolean;
};

export type QueryStepKind =
  | 'filter'
  | 'sort'
  | 'remove-duplicates'
  | 'limit'
  | 'add-index';
export type QueryOperator =
  | 'equals'
  | 'not-equals'
  | 'contains'
  | 'greater-than'
  | 'less-than'
  | 'is-blank'
  | 'not-blank';
export type QueryStep = {
  id: string;
  tableId: string;
  kind: QueryStepKind;
  field: string;
  operator: QueryOperator;
  value: string;
  direction: 'ascending' | 'descending';
  count: number;
  name: string;
  start: number;
  enabled: boolean;
};

export type ReportFilter = {
  id: string;
  tableId: string;
  field: string;
  value: string;
  sourceWidgetId?: string;
};

export type WidgetLayout = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type ChartWidget = {
  id: string;
  pageId: string;
  title: string;
  tableId: string;
  kind: ChartKind;
  dimension: string;
  measure: string;
  secondaryMeasure?: string;
  gaugeTarget?: number;
  aggregation: Aggregation;
  calculation?: QuickCalculation;
  color: string;
  showGrid: boolean;
  showLegend: boolean;
  numberFormat: NumberFormat;
  interactions: boolean;
  sortDirection?: SortDirection;
  topN?: number;
  hidden?: boolean;
  layout: WidgetLayout;
};

export type ReportPage = {
  id: string;
  name: string;
  hidden: boolean;
  background: string;
};

export type ReportBookmark = {
  id: string;
  name: string;
  pageId: string;
  filters: ReportFilter[];
  hiddenWidgetIds: string[];
  createdAt: string;
};

export type ReportTheme = {
  id: 'ocean' | 'executive' | 'forest' | 'sunset' | 'mono';
  name: string;
  palette: string[];
  canvas: string;
};

export type ReportDocument = {
  schemaVersion: 3;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  role: ReportRole;
  refreshSeconds: number;
  pages: ReportPage[];
  bookmarks: ReportBookmark[];
  theme: ReportTheme;
  tables: DataTable[];
  relationships: Relationship[];
  calculatedFields: CalculatedField[];
  transforms: ColumnTransform[];
  querySteps: QueryStep[];
  filters: ReportFilter[];
  widgets: ChartWidget[];
};

export type ReportSummary = {
  id: string;
  name: string;
  updatedAt: string;
  tableCount: number;
  widgetCount: number;
};
