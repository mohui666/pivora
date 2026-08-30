/* oxlint-disable typescript/no-require-imports -- UtilityProcess runs this CommonJS entry. */
const nodePath = require('node:path');

const config = process.env.PIVORA_RUNTIME_CONFIG;
const host = process.env.PIVORA_RUNTIME_HOST;
const persistence = process.env.PIVORA_RUNTIME_PERSISTENCE;
const port = Number(process.env.PIVORA_RUNTIME_PORT);
const wranglerEntry = process.env.PIVORA_WRANGLER_ENTRY;

if (!config || !host || !persistence || !port || !wranglerEntry) {
  throw new Error('Pivora runtime configuration is incomplete.');
}

const { unstable_dev: startWorker } = require(wranglerEntry);
let worker;
let stopping = false;

async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    await worker?.stop();
  } finally {
    process.exit(0);
  }
}

process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
process.parentPort?.on('message', (event) => {
  if (event.data?.type === 'stop') void stop();
});

async function run() {
  worker = await startWorker(
    nodePath.join(nodePath.dirname(config), 'index.js'),
    {
      bundle: false,
      config,
      inspectorPort: 0,
      ip: host,
      local: true,
      logLevel: 'warn',
      persist: true,
      persistTo: persistence,
      port,
      experimental: {
        disableExperimentalWarning: true,
        showInteractiveDevSession: false,
        watch: false,
      },
    },
  );
  if (stopping) await worker.stop();
  await worker.waitUntilExit();
}

run().catch((error) => {
  if (stopping) process.exit(0);
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
