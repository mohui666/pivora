/* oxlint-disable typescript/no-require-imports -- Electron sandboxed preloads use CommonJS. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'pivoraDesktop',
  Object.freeze({
    platform: process.platform,
    retryRuntime: () => ipcRenderer.invoke('pivora:retry-runtime'),
    runtimeStatus: () => ipcRenderer.invoke('pivora:runtime-status'),
  }),
);
