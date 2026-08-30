import type {
  Aggregation,
  DataRow,
  FieldKind,
  QuickCalculation,
} from './analytics';

export type SourceKind =
  | 'sample'
  | 'csv'
  | 'json'
  | 'xml'
  | 'parquet'
  | 'web'
  | 'data-lake'
  | 'odbc'
  | 'sql'
  | 'excel'
  | 'sqlite';
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
export type LayoutMode = 'snap' | 'free';
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

export type ReportParameter = {
  id: string;
  name: string;
  minimum: number;
  maximum: number;
  step: number;
  value: number;
};

export type SemanticMeasure = {
  id: string;
  tableId: string;
  name: string;
  field: string;
  aggregation: Aggregation;
  calculation: QuickCalculation;
  numberFormat: NumberFormat;
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

export type DataCategory =
  | 'uncategorized'
  | 'address'
  | 'place'
  | 'continent'
  | 'county'
  | 'city'
  | 'state-or-province'
  | 'country'
  | 'postal-code'
  | 'latitude'
  | 'longitude'
  | 'barcode'
  | 'web-url'
  | 'image-url';

export type ColumnMetadata = {
  id: string;
  tableId: string;
  field: string;
  displayName: string;
  description: string;
  category: DataCategory;
  hidden: boolean;
  sortByField?: string;
  numberFormat?: NumberFormat;
};

export type QueryStepKind =
  | 'filter'
  | 'sort'
  | 'remove-duplicates'
  | 'limit'
  | 'add-index'
  | 'replace-values'
  | 'rename-column'
  | 'split-column'
  | 'custom-column'
  | 'group-by'
  | 'append-table'
  | 'merge-table'
  | 'unpivot-columns'
  | 'pivot-column';
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
  replacement?: string;
  separator?: string;
  targetField?: string;
  aggregation?: Aggregation;
  sourceTableId?: string;
  sourceField?: string;
  fields?: string[];
  joinType?: 'left' | 'inner';
};

export type ReportFilter = {
  id: string;
  tableId: string;
  field: string;
  operator: QueryOperator;
  value: string;
  scope: 'report' | 'page' | 'visual' | 'interaction';
  pageId?: string;
  widgetId?: string;
  sourceWidgetId?: string;
};

export type RoleRule = {
  id: string;
  role: Exclude<ReportRole, 'owner'>;
  tableId: string;
  field: string;
  operator: QueryOperator;
  value: string;
  enabled: boolean;
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
  syncGroup?: string;
  sortDirection?: SortDirection;
  topN?: number;
  hidden?: boolean;
  hierarchy?: string[];
  drillLevel?: number;
  conditionalFormatting?: boolean;
  conditionalMinColor?: string;
  conditionalMaxColor?: string;
  layout: WidgetLayout;
};

export type VisualInteraction = {
  id: string;
  sourceWidgetId: string;
  targetWidgetId: string;
  mode: 'filter' | 'none';
};

export type ReportPage = {
  id: string;
  name: string;
  hidden: boolean;
  background: string;
  drillthroughFields: Array<{
    id: string;
    tableId: string;
    field: string;
  }>;
  keepAllFilters: boolean;
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
  schemaVersion: 8;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  role: ReportRole;
  refreshSeconds: number;
  layoutMode: LayoutMode;
  pages: ReportPage[];
  bookmarks: ReportBookmark[];
  theme: ReportTheme;
  tables: DataTable[];
  relationships: Relationship[];
  calculatedFields: CalculatedField[];
  parameters: ReportParameter[];
  measures: SemanticMeasure[];
  columnMetadata: ColumnMetadata[];
  transforms: ColumnTransform[];
  querySteps: QueryStep[];
  roleRules: RoleRule[];
  filters: ReportFilter[];
  visualInteractions: VisualInteraction[];
  widgets: ChartWidget[];
};

export type ReportSummary = {
  id: string;
  name: string;
  updatedAt: string;
  tableCount: number;
  widgetCount: number;
};

export type ReportSnapshotSummary = {
  id: string;
  reportId: string;
  reportName: string;
  createdAt: string;
  reason: 'automatic' | 'manual' | 'before-restore' | 'before-switch';
  tableCount: number;
  widgetCount: number;
};
