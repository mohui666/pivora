import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
  throw new Error('The packaged desktop smoke test currently targets Windows.');
}

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const releaseDirectory = join(repositoryRoot, 'release');
const executable = join(releaseDirectory, 'win-unpacked', 'Pivora.exe');
const resultPath = join(releaseDirectory, 'desktop-smoke.json');
const userDataDirectory = join(releaseDirectory, 'smoke-user-data');

if (!existsSync(executable)) {
  throw new Error(`Packaged executable is missing: ${executable}`);
}

for (const generatedPath of [resultPath, userDataDirectory]) {
  const resolved = resolve(generatedPath);
  if (
    dirname(resolved) !== releaseDirectory &&
    resolved !== userDataDirectory
  ) {
    throw new Error(`Refusing to clean an unexpected path: ${resolved}`);
  }
  rmSync(resolved, { force: true, recursive: true });
}

const child = spawn(executable, [`--user-data-dir=${userDataDirectory}`], {
  env: {
    ...process.env,
    PIVORA_DESKTOP_SMOKE: '1',
    PIVORA_DESKTOP_SMOKE_RESULT: resultPath,
  },
  stdio: 'ignore',
  windowsHide: true,
});

let timeout;
const exitCode = await Promise.race([
  new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolveExit(code ?? 1));
  }),
  new Promise((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error('Desktop smoke test timed out.')),
      60_000,
    );
  }),
])
  .catch((error) => {
    if (child.pid) {
      spawnSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    }
    throw error;
  })
  .finally(() => clearTimeout(timeout));

if (exitCode !== 0) {
  throw new Error(`Packaged Pivora exited with code ${exitCode}.`);
}
if (!existsSync(resultPath)) {
  throw new Error('Packaged Pivora did not write its smoke result.');
}

const result = JSON.parse(readFileSync(resultPath, 'utf8'));
if (
  result.ok !== true ||
  result.packaged !== true ||
  !String(result.title).includes('Pivora')
) {
  throw new Error(`Desktop smoke result is invalid: ${JSON.stringify(result)}`);
}

console.log(JSON.stringify(result, null, 2));
