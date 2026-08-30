import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const runtimeDirectory = join(repositoryRoot, 'desktop', 'runtime');
const npmCli = process.env.npm_execpath;

if (!npmCli || !existsSync(npmCli)) {
  throw new Error('Run the desktop runtime preparation through an npm script.');
}

const child = spawn(
  process.execPath,
  [npmCli, 'ci', '--omit=dev', '--no-audit', '--no-fund'],
  {
    cwd: runtimeDirectory,
    stdio: 'inherit',
    windowsHide: true,
  },
);

const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code) => resolve(code ?? 1));
});

if (exitCode !== 0) {
  throw new Error(`Desktop runtime installation failed with code ${exitCode}.`);
}

const wranglerCli = join(
  runtimeDirectory,
  'node_modules',
  'wrangler',
  'wrangler-dist',
  'cli.js',
);
if (!existsSync(wranglerCli)) {
  throw new Error(`Wrangler runtime is missing at ${wranglerCli}.`);
}

console.log('Desktop runtime is ready.');
