import type { DataRow } from './analytics';

export type OdbcSourceInfo = {
  name: string;
  driver: string;
  type: string;
  platform: string;
};

export type OdbcDriverInfo = {
  name: string;
  platform: string;
};

export type OdbcSourceDiscovery = {
  available: boolean;
  sources: OdbcSourceInfo[];
  drivers: OdbcDriverInfo[];
  message?: string;
};

export type OdbcQueryRequest = {
  connectionString: string;
  query: string;
  maxRows: number;
  commandTimeoutSeconds: number;
};

export type OdbcQueryResult = {
  columns: string[];
  rows: DataRow[];
  truncated: boolean;
  durationMs: number;
  driver: string;
  dataSource: string;
  database: string;
};

export type PivoraDesktopBridge = {
  platform: string;
  listOdbcSources: () => Promise<OdbcSourceDiscovery>;
  runOdbcQuery: (request: OdbcQueryRequest) => Promise<OdbcQueryResult>;
  retryRuntime: () => Promise<{ ok: boolean; message?: string }>;
  runtimeStatus: () => Promise<{
    message: string;
    logPath: string;
    running: boolean;
  }>;
};

declare global {
  interface Window {
    pivoraDesktop?: PivoraDesktopBridge;
  }
}

export function getDesktopBridge(): PivoraDesktopBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.pivoraDesktop;
}
