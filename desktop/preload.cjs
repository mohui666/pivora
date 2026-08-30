/* oxlint-disable typescript/no-require-imports -- Electron sandboxed preloads use CommonJS. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'pivoraDesktop',
  Object.freeze({
    platform: process.platform,
    listOdbcSources: () => ipcRenderer.invoke('pivora:odbc-sources'),
    runOdbcQuery: (request) => ipcRenderer.invoke('pivora:odbc-query', request),
    retryRuntime: () => ipcRenderer.invoke('pivora:retry-runtime'),
    runtimeStatus: () => ipcRenderer.invoke('pivora:runtime-status'),
  }),
);
