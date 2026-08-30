import type { Aggregation, DataRow, FieldKind } from "./analytics";

export type SourceKind = "sample" | "csv" | "json" | "excel" | "sqlite";
export type ChartKind = "bar" | "line" | "area" | "pie" | "kpi" | "table";
export type ReportRole = "owner" | "editor" | "viewer";
export type NumberFormat = "compact" | "standard" | "currency" | "percent";

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
  title: string;
  tableId: string;
  kind: ChartKind;
  dimension: string;
  measure: string;
  aggregation: Aggregation;
  color: string;
  showGrid: boolean;
  showLegend: boolean;
  numberFormat: NumberFormat;
  interactions: boolean;
  layout: WidgetLayout;
};

export type ReportDocument = {
  schemaVersion: 2;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  role: ReportRole;
  refreshSeconds: number;
  tables: DataTable[];
  relationships: Relationship[];
  calculatedFields: CalculatedField[];
  transforms: ColumnTransform[];
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
