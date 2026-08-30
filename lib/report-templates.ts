import { createId } from './bi-model';
import type { ReportDocument, ReportTheme } from './bi-types';
import { REPORT_THEMES } from './report-schema';
import { createSampleReport } from './sample-report';

export type ReportTemplate = {
  id: 'blank' | 'retail' | 'executive' | 'scenario';
  name: string;
  eyebrow: string;
  description: string;
  accent: string;
  features: string[];
  create: () => ReportDocument;
};

function freshen(
  source: ReportDocument,
  name: string,
  theme: ReportTheme,
): ReportDocument {
  const report = structuredClone(source);
  const now = new Date().toISOString();
  return {
    ...report,
    id: createId('report'),
    name,
    createdAt: now,
    updatedAt: now,
    theme,
    role: 'owner',
    filters: [],
    bookmarks: [],
    pages: report.pages.map((page) => ({
      ...page,
      background: theme.canvas,
    })),
    widgets: report.widgets.map((widget, index) => ({
      ...widget,
      color: theme.palette[index % theme.palette.length],
    })),
  };
}

export function createBlankReport(): ReportDocument {
  const now = new Date().toISOString();
  const theme = REPORT_THEMES[0];
  return {
    schemaVersion: 7,
    id: createId('report'),
    name: 'Untitled report',
    createdAt: now,
    updatedAt: now,
    role: 'owner',
    refreshSeconds: 0,
    pages: [
      {
        id: createId('page'),
        name: 'Page 1',
        hidden: false,
        background: theme.canvas,
        drillthroughFields: [],
        keepAllFilters: true,
      },
    ],
    bookmarks: [],
    theme,
    tables: [],
    relationships: [],
    calculatedFields: [],
    parameters: [],
    measures: [],
    columnMetadata: [],
    transforms: [],
    querySteps: [],
    roleRules: [],
    filters: [],
    visualInteractions: [],
    widgets: [],
  };
}

function createRetailTemplate() {
  return freshen(createSampleReport(), 'Retail performance', REPORT_THEMES[0]);
}

function createExecutiveTemplate() {
  const report = freshen(
    createSampleReport(),
    'Executive scorecard',
    REPORT_THEMES[1],
  );
  return {
    ...report,
    widgets: report.widgets.map((widget) => ({
      ...widget,
      title:
        widget.id === 'widget_revenue'
          ? 'Revenue trajectory'
          : widget.id === 'widget_total'
            ? 'Net sales'
            : widget.title,
    })),
  };
}

function createScenarioTemplate() {
  const report = freshen(
    createSampleReport(),
    'Scenario planning',
    REPORT_THEMES[2],
  );
  return {
    ...report,
    widgets: report.widgets.map((widget) =>
      widget.id === 'widget_revenue'
        ? {
            ...widget,
            title: 'Scenario revenue trend',
            measure: 'scenario_revenue',
          }
        : widget,
    ),
  };
}

export const REPORT_TEMPLATES: ReportTemplate[] = [
  {
    id: 'blank',
    name: 'Blank canvas',
    eyebrow: 'START CLEAN',
    description:
      'Begin with an empty local report and import only the files you need.',
    accent: '#2563eb',
    features: ['Empty semantic model', 'Single report page', 'Import-first'],
    create: createBlankReport,
  },
  {
    id: 'retail',
    name: 'Retail performance',
    eyebrow: 'GUIDED SAMPLE',
    description:
      'Explore a complete sales model with relationships, profit, and regional visuals.',
    accent: '#7c5ce7',
    features: ['2 related tables', '4 visuals', 'What-if parameter'],
    create: createRetailTemplate,
  },
  {
    id: 'executive',
    name: 'Executive scorecard',
    eyebrow: 'LEADERSHIP',
    description:
      'A high-contrast KPI and trend layout for concise management reporting.',
    accent: '#111827',
    features: ['Executive theme', 'KPI summary', 'Portable PDF'],
    create: createExecutiveTemplate,
  },
  {
    id: 'scenario',
    name: 'Scenario planning',
    eyebrow: 'WHAT-IF',
    description:
      'Model a live uplift assumption and compare its impact across the report.',
    accent: '#15803d',
    features: ['Live parameter', 'Calculated scenario', 'Interactive filters'],
    create: createScenarioTemplate,
  },
];
