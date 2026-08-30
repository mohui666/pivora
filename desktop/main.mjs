import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  app,
  BrowserWindow,
  ipcMain,
  session,
  shell,
  utilityProcess,
} from 'electron';

import { listOdbcSources, runOdbcQuery } from './odbc-bridge.mjs';

const HOST = '127.0.0.1';
const PORT = 4173;
const APP_ORIGIN = `http://${HOST}:${PORT}`;
const STARTUP_TIMEOUT_MS = 45_000;
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const smokeMode = process.env.PIVORA_DESKTOP_SMOKE === '1';

let mainWindow = null;
let serverProcess = null;
let serverExitCode = null;
let expectedServerExit = false;
let quitting = false;
let restartPromise = null;
let odbcQueryPromise = null;
let logPath = '';
let failureMessage = 'The local runtime has not started yet.';
const serverTail = [];

function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  if (logPath) {
    try {
      appendFileSync(logPath, line, 'utf8');
    } catch {
      // Logging must never prevent the application from opening its error UI.
    }
  }
}

function writeSmokeResult(result) {
  const resultPath = process.env.PIVORA_DESKTOP_SMOKE_RESULT;
  if (!resultPath) return;
  mkdirSync(dirname(resultPath), { recursive: true });
  writeFileSync(
    resultPath,
    `${JSON.stringify(
      {
        ...result,
        origin: APP_ORIGIN,
        packaged: app.isPackaged,
        version: app.getVersion(),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

function rememberServerOutput(prefix, chunk) {
  const lines = String(chunk)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    const entry = `${prefix}: ${line}`;
    serverTail.push(entry);
    if (serverTail.length > 40) serverTail.shift();
    log(entry);
  }
}

function resourcePaths() {
  if (app.isPackaged) {
    return {
      config: join(process.resourcesPath, 'dist', 'server', 'wrangler.json'),
      runner: join(moduleDirectory, 'runtime-runner.cjs'),
      wrangler: join(
        process.resourcesPath,
        'runtime',
        'node_modules',
        'wrangler',
        'wrangler-dist',
        'cli.js',
      ),
    };
  }

  const root = app.getAppPath();
  return {
    config: join(root, 'dist', 'server', 'wrangler.json'),
    runner: join(moduleDirectory, 'runtime-runner.cjs'),
    wrangler: join(root, 'node_modules', 'wrangler', 'wrangler-dist', 'cli.js'),
  };
}

async function assertPortAvailable() {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', (error) => reject(error));
    probe.listen(PORT, HOST, () => probe.close(resolve));
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForRuntime(child) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (serverProcess !== child || serverExitCode !== null) {
      throw new Error(
        `Local runtime exited with code ${String(serverExitCode)}.`,
      );
    }
    try {
      const response = await fetch(APP_ORIGIN, {
        cache: 'no-store',
        signal: AbortSignal.timeout(1_500),
      });
      const html = await response.text();
      if (response.ok && html.includes('Pivora')) return;
    } catch {
      // The worker needs a few seconds to load its local modules.
    }
    await delay(250);
  }
  throw new Error(
    `Local runtime did not answer within ${STARTUP_TIMEOUT_MS / 1000}s.`,
  );
}

async function stopRuntime() {
  const child = serverProcess;
  serverProcess = null;
  if (!child?.pid) return;

  expectedServerExit = true;
  const childPid = child.pid;
  child.postMessage({ type: 'stop' });
  const exited = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    delay(4_000).then(() => false),
  ]);
  if (exited) return;

  if (process.platform === 'win32') {
    const killer = spawn(
      'taskkill.exe',
      ['/pid', String(childPid), '/T', '/F'],
      { stdio: 'ignore', windowsHide: true },
    );
    await Promise.race([
      new Promise((resolve) => killer.once('exit', resolve)),
      delay(3_000),
    ]);
  } else {
    child.kill();
  }
}

async function startRuntime() {
  const paths = resourcePaths();
  for (const [label, value] of Object.entries(paths)) {
    if (!existsSync(value)) {
      throw new Error(`Packaged ${label} is missing: ${value}`);
    }
  }

  await assertPortAvailable();
  serverTail.length = 0;
  expectedServerExit = false;
  const persistenceDirectory = join(app.getPath('userData'), 'worker-state');
  mkdirSync(persistenceDirectory, { recursive: true });

  const child = utilityProcess.fork(paths.runner, [], {
    cwd: dirname(paths.config),
    env: {
      ...process.env,
      CI: 'true',
      NO_COLOR: '1',
      PIVORA_RUNTIME_CONFIG: paths.config,
      PIVORA_RUNTIME_HOST: HOST,
      PIVORA_RUNTIME_PERSISTENCE: persistenceDirectory,
      PIVORA_RUNTIME_PORT: String(PORT),
      PIVORA_WRANGLER_ENTRY: paths.wrangler,
      WRANGLER_SEND_METRICS: 'false',
    },
    serviceName: 'Pivora Local Runtime',
    stdio: 'pipe',
  });
  serverProcess = child;
  serverExitCode = null;
  child.stdout?.on('data', (chunk) => rememberServerOutput('runtime', chunk));
  child.stderr?.on('data', (chunk) => rememberServerOutput('runtime', chunk));
  child.once('error', (type, location, report) => {
    failureMessage = `${type} in the local runtime at ${location}.`;
    log(`runtime process error: ${failureMessage}\n${report}`);
  });
  child.once('exit', (code) => {
    serverExitCode = code;
    log(
      expectedServerExit
        ? `runtime stopped code=${String(code)}`
        : `runtime exited code=${String(code)}`,
    );
    if (serverProcess === child) serverProcess = null;
    if (!expectedServerExit && !quitting) {
      failureMessage = `The local runtime stopped unexpectedly (code ${String(code)}).`;
      void showFailure(failureMessage);
    }
  });

  await waitForRuntime(child);
  log(`runtime ready at ${APP_ORIGIN}`);
}

function safeExternalUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

function isApplicationUrl(rawUrl) {
  try {
    return new URL(rawUrl).origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

function assertTrustedApplicationIpc(event) {
  const senderUrl = event.senderFrame?.url ?? event.sender.getURL();
  if (!isApplicationUrl(senderUrl)) {
    throw new Error('The connector request did not come from Pivora.');
  }
}

function secureWebContents(webContents) {
  webContents.setWindowOpenHandler(({ url }) => {
    const external = safeExternalUrl(url);
    if (external && !isApplicationUrl(url))
      void shell.openExternal(external.href);
    return { action: 'deny' };
  });
  webContents.on('will-navigate', (event, url) => {
    if (isApplicationUrl(url)) return;
    event.preventDefault();
    const external = safeExternalUrl(url);
    if (external) void shell.openExternal(external.href);
  });
  webContents.on('will-attach-webview', (event) => event.preventDefault());
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 960,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f3f6fb',
    title: 'Pivora',
    webPreferences: {
      preload: join(moduleDirectory, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
    },
  });
  if (!smokeMode) window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  mainWindow = window;
  return window;
}

async function showFailure(error) {
  failureMessage = error instanceof Error ? error.message : String(error);
  if (serverTail.length) {
    failureMessage += ` Last runtime output: ${serverTail.at(-1)}`;
  }
  log(`startup failure: ${failureMessage}`);
  const window =
    mainWindow && !mainWindow.isDestroyed() ? mainWindow : createWindow();
  await window.loadFile(join(moduleDirectory, 'error.html'));
  if (!window.isVisible()) window.show();
}

async function startAndLoad() {
  const window =
    mainWindow && !mainWindow.isDestroyed() ? mainWindow : createWindow();
  try {
    await stopRuntime();
    await startRuntime();
    await window.loadURL(APP_ORIGIN);
    if (smokeMode) {
      const odbc = await listOdbcSources();
      writeSmokeResult({
        ok: true,
        title: window.webContents.getTitle(),
        odbc: {
          available: odbc.available === true,
          driverCount: odbc.drivers?.length ?? 0,
          sourceCount: odbc.sources?.length ?? 0,
        },
      });
      quitting = true;
      app.quit();
      return { ok: true };
    }
    if (process.env.PIVORA_DESKTOP_DEVTOOLS === '1') {
      window.webContents.openDevTools({ mode: 'detach' });
    }
    if (!window.isVisible()) window.show();
    return { ok: true };
  } catch (error) {
    await stopRuntime();
    if (smokeMode) {
      failureMessage = error instanceof Error ? error.message : String(error);
      writeSmokeResult({ ok: false, message: failureMessage });
      quitting = true;
      app.exit(1);
      return { ok: false, message: failureMessage };
    }
    await showFailure(error);
    return { ok: false, message: failureMessage };
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  void app
    .whenReady()
    .then(async () => {
      logPath = join(app.getPath('logs'), 'pivora-desktop.log');
      mkdirSync(dirname(logPath), { recursive: true });
      log(
        `Pivora ${app.getVersion()} starting; packaged=${String(app.isPackaged)}`,
      );

      session.defaultSession.setPermissionRequestHandler(
        (_webContents, _permission, callback) => callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      app.on('web-contents-created', (_event, webContents) => {
        secureWebContents(webContents);
      });

      ipcMain.handle('pivora:runtime-status', () => ({
        message: failureMessage,
        logPath,
        running: Boolean(serverProcess?.pid),
      }));
      ipcMain.handle('pivora:retry-runtime', () => {
        restartPromise ??= startAndLoad().finally(() => {
          restartPromise = null;
        });
        return restartPromise;
      });
      ipcMain.handle('pivora:odbc-sources', (event) => {
        assertTrustedApplicationIpc(event);
        return listOdbcSources();
      });
      ipcMain.handle('pivora:odbc-query', (event, request) => {
        assertTrustedApplicationIpc(event);
        if (odbcQueryPromise) {
          throw new Error('An ODBC query is already running.');
        }
        odbcQueryPromise = runOdbcQuery(request).finally(() => {
          odbcQueryPromise = null;
        });
        return odbcQueryPromise;
      });

      createWindow();
      await startAndLoad();
    })
    .catch((error) => {
      void showFailure(error);
    });

  app.on('activate', () => {
    if (!mainWindow) {
      createWindow();
      void startAndLoad();
    }
  });

  let shutdownStarted = false;
  app.on('before-quit', (event) => {
    if (!serverProcess || shutdownStarted) return;
    event.preventDefault();
    shutdownStarted = true;
    quitting = true;
    void stopRuntime().finally(() => app.quit());
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
