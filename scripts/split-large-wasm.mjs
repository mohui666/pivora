import { readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIRECTORY = path.resolve(SCRIPT_DIRECTORY, '..');
const MEDIA_DIRECTORY = path.resolve(
  PROJECT_DIRECTORY,
  'dist',
  'client',
  '_next',
  'static',
  'media',
);
const MAX_PART_BYTES = 20 * 1024 * 1024;

if (
  !MEDIA_DIRECTORY.startsWith(path.join(PROJECT_DIRECTORY, 'dist') + path.sep)
) {
  throw new Error(
    'Refusing to process WASM outside the generated dist directory.',
  );
}

const entries = await readdir(MEDIA_DIRECTORY);
for (const name of entries.filter((entry) => entry.endsWith('.wasm'))) {
  const sourcePath = path.join(MEDIA_DIRECTORY, name);
  const sourceStats = await stat(sourcePath);
  if (sourceStats.size <= MAX_PART_BYTES) continue;

  const source = await readFile(sourcePath);
  const count = Math.ceil(source.length / MAX_PART_BYTES);
  for (let index = 0; index < count; index += 1) {
    const start = index * MAX_PART_BYTES;
    const end = Math.min(start + MAX_PART_BYTES, source.length);
    await writeFile(`${sourcePath}.part${index}`, source.subarray(start, end));
  }
  await writeFile(
    `${sourcePath}.parts.json`,
    JSON.stringify({ count, bytes: source.length }),
  );
  await unlink(sourcePath);
  process.stdout.write(`Split ${name} into ${count} local assets.\n`);
}
