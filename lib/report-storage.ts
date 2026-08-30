import type {
  ReportDocument,
  ReportSnapshotSummary,
  ReportSummary,
} from './bi-types';
import { upgradeReport } from './report-schema';

// Preserve the original storage identifier so the Pivora rebrand never hides
// reports that users already saved locally.
const DATABASE = 'locallens-bi';
const STORE = 'reports';
const SNAPSHOT_STORE = 'snapshots';
const SETTING_STORE = 'settings';
const LAST_REPORT_KEY = 'last-open-report';
const MAX_SNAPSHOTS_PER_REPORT = 30;

type StoredSnapshot = {
  id: string;
  reportId: string;
  reportName: string;
  createdAt: string;
  reason: ReportSnapshotSummary['reason'];
  tableCount?: number;
  widgetCount?: number;
  report?: ReportDocument;
  compressedReport?: Blob;
};

type StoredSetting = {
  key: string;
  value: string;
};

async function encodeSnapshotReport(
  report: ReportDocument,
): Promise<Pick<StoredSnapshot, 'report' | 'compressedReport'>> {
  if (typeof CompressionStream === 'undefined') {
    return { report: structuredClone(report) };
  }
  const stream = new Blob([JSON.stringify(report)], {
    type: 'application/json',
  })
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  return {
    compressedReport: await new Response(stream).blob(),
  };
}

async function decodeSnapshotReport(
  snapshot: StoredSnapshot,
): Promise<ReportDocument | null> {
  if (snapshot.report) return upgradeReport(snapshot.report);
  if (!snapshot.compressedReport || typeof DecompressionStream === 'undefined')
    return null;
  const stream = snapshot.compressedReport
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return upgradeReport(JSON.parse(await new Response(stream).text()));
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'id' });
      }
      if (!request.result.objectStoreNames.contains(SNAPSHOT_STORE)) {
        const snapshots = request.result.createObjectStore(SNAPSHOT_STORE, {
          keyPath: 'id',
        });
        snapshots.createIndex('reportId', 'reportId');
      }
      if (!request.result.objectStoreNames.contains(SETTING_STORE)) {
        request.result.createObjectStore(SETTING_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveReport(report: ReportDocument): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(
      [STORE, SETTING_STORE],
      'readwrite',
    );
    transaction.objectStore(STORE).put(report);
    transaction.objectStore(SETTING_STORE).put({
      key: LAST_REPORT_KEY,
      value: report.id,
    } satisfies StoredSetting);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function loadLastReport(): Promise<ReportDocument | null> {
  const database = await openDatabase();
  const report = await new Promise<ReportDocument | null>((resolve, reject) => {
    const transaction = database.transaction([STORE, SETTING_STORE]);
    const resolveMostRecent = () => {
      const reportsRequest = transaction.objectStore(STORE).getAll();
      reportsRequest.onsuccess = () => {
        const reports = reportsRequest.result as ReportDocument[];
        resolve(
          reports.sort((left, right) =>
            right.updatedAt.localeCompare(left.updatedAt),
          )[0] ?? null,
        );
      };
      reportsRequest.onerror = () => reject(reportsRequest.error);
    };
    const settingRequest = transaction
      .objectStore(SETTING_STORE)
      .get(LAST_REPORT_KEY);
    settingRequest.onsuccess = () => {
      const id = (settingRequest.result as StoredSetting | undefined)?.value;
      if (id) {
        const reportRequest = transaction.objectStore(STORE).get(id);
        reportRequest.onsuccess = () => {
          const saved = reportRequest.result as ReportDocument | undefined;
          if (saved) resolve(saved);
          else resolveMostRecent();
        };
        reportRequest.onerror = () => reject(reportRequest.error);
        return;
      }
      resolveMostRecent();
    };
    settingRequest.onerror = () => reject(settingRequest.error);
  });
  database.close();
  return report ? upgradeReport(report) : null;
}

export async function createReportSnapshot(
  report: ReportDocument,
  reason: ReportSnapshotSummary['reason'] = 'manual',
): Promise<string> {
  const database = await openDatabase();
  const id = `snapshot_${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
  const snapshot: StoredSnapshot = {
    id,
    reportId: report.id,
    reportName: report.name,
    createdAt: new Date().toISOString(),
    reason,
    tableCount: report.tables.length,
    widgetCount: report.widgets.length,
    ...(await encodeSnapshotReport(report)),
  };
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(SNAPSHOT_STORE, 'readwrite');
    transaction.objectStore(SNAPSHOT_STORE).put(snapshot);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
  const snapshots = await listReportSnapshots(report.id);
  await Promise.all(
    snapshots
      .slice(MAX_SNAPSHOTS_PER_REPORT)
      .map((item) => deleteReportSnapshot(item.id)),
  );
  return id;
}

export async function listReportSnapshots(
  reportId: string,
): Promise<ReportSnapshotSummary[]> {
  const database = await openDatabase();
  const snapshots = await new Promise<StoredSnapshot[]>((resolve, reject) => {
    const request = database
      .transaction(SNAPSHOT_STORE)
      .objectStore(SNAPSHOT_STORE)
      .index('reportId')
      .getAll(reportId);
    request.onsuccess = () => resolve(request.result as StoredSnapshot[]);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return snapshots
    .map((snapshot) => ({
      id: snapshot.id,
      reportId: snapshot.reportId,
      reportName: snapshot.reportName,
      createdAt: snapshot.createdAt,
      reason: snapshot.reason,
      tableCount: snapshot.tableCount ?? snapshot.report?.tables.length ?? 0,
      widgetCount: snapshot.widgetCount ?? snapshot.report?.widgets.length ?? 0,
    }))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function loadReportSnapshot(
  id: string,
): Promise<ReportDocument | null> {
  const database = await openDatabase();
  const snapshot = await new Promise<StoredSnapshot | null>(
    (resolve, reject) => {
      const request = database
        .transaction(SNAPSHOT_STORE)
        .objectStore(SNAPSHOT_STORE)
        .get(id);
      request.onsuccess = () =>
        resolve((request.result as StoredSnapshot | undefined) ?? null);
      request.onerror = () => reject(request.error);
    },
  );
  database.close();
  return snapshot ? decodeSnapshotReport(snapshot) : null;
}

export async function deleteReportSnapshot(id: string): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(SNAPSHOT_STORE, 'readwrite');
    transaction.objectStore(SNAPSHOT_STORE).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function loadReport(id: string): Promise<ReportDocument | null> {
  const database = await openDatabase();
  const report = await new Promise<ReportDocument | null>((resolve, reject) => {
    const request = database.transaction(STORE).objectStore(STORE).get(id);
    request.onsuccess = () =>
      resolve((request.result as ReportDocument | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return report ? upgradeReport(report) : null;
}

export async function listReports(): Promise<ReportSummary[]> {
  const database = await openDatabase();
  const reports = await new Promise<ReportDocument[]>((resolve, reject) => {
    const request = database.transaction(STORE).objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result as ReportDocument[]);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return reports
    .map((report) => upgradeReport(report))
    .map((report) => ({
      id: report.id,
      name: report.name,
      updatedAt: report.updatedAt,
      tableCount: report.tables.length,
      widgetCount: report.widgets.length,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteReport(id: string): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(
      [STORE, SNAPSHOT_STORE, SETTING_STORE],
      'readwrite',
    );
    transaction.objectStore(STORE).delete(id);
    const snapshotStore = transaction.objectStore(SNAPSHOT_STORE);
    const snapshotRequest = snapshotStore.index('reportId').getAllKeys(id);
    snapshotRequest.onsuccess = () => {
      for (const key of snapshotRequest.result) snapshotStore.delete(key);
    };
    const settingStore = transaction.objectStore(SETTING_STORE);
    const settingRequest = settingStore.get(LAST_REPORT_KEY);
    settingRequest.onsuccess = () => {
      if ((settingRequest.result as StoredSetting | undefined)?.value === id) {
        settingStore.delete(LAST_REPORT_KEY);
      }
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}
