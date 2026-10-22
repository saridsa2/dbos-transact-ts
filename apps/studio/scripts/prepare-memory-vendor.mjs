// Install the attributed provider-injection patch alongside Mem0 so its own locked dependencies resolve.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const dir = dirname(require.resolve('mem0ai/oss'));
const provenance = JSON.parse(await readFile(new URL('../vendor/mem0-oss/PROVENANCE.json', import.meta.url), 'utf8'));
const original = await readFile(join(dir, 'index.mjs'));
const adapted = await readFile(new URL('../vendor/mem0-oss/index.mjs', import.meta.url));
if (
  createHash('sha256').update(original).digest('hex') !== provenance.originalBundleSha256 ||
  createHash('sha256').update(adapted).digest('hex') !== provenance.adaptedBundleSha256
)
  throw Error('Mem0 source integrity mismatch; review the version and patch.');
await writeFile(join(dir, 'stackproc.mjs'), adapted);
