import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(resolve(root, 'docs/baseline-sha256.json'), 'utf8')) as Record<string, string>;
// Only these original files may differ. Every other original file must remain byte-identical.
const changed = new Set([
  'README.md', 'package.json', 'src/config.ts', 'src/index.ts', 'src/redchirp/http.ts', 'src/redchirp/index.ts',
]);
let unchanged = 0;
for (const [path, hash] of Object.entries(manifest)) {
  if (changed.has(path)) continue;
  const actual = createHash('sha256').update(await readFile(resolve(root, path))).digest('hex');
  assert.equal(actual, hash, `Unapproved change to baseline file: ${path}`);
  unchanged++;
}
process.stdout.write(`Verified ${unchanged} original files are byte-identical; ${changed.size} original files have explicitly documented changes.\n`);
