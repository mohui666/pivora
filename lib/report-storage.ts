import type { ReportDocument, ReportSummary } from "./bi-types";

const DATABASE = "locallens-bi";
const STORE = "reports";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveReport(report: ReportDocument): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(report);
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
  return report;
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
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}
