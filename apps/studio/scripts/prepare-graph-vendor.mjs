// Refresh only the reviewed portable graph source; never copies provider or agent-host modules.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
const upstream = process.argv[2];
if (!upstream) throw Error('Pass the reviewed local graph-memory checkout path.');
const dir = resolve(upstream), target = resolve('vendor/graph-memory');
const files = ['src/storage/index.ts', 'src/graph/rank.ts', 'LICENSE'];
const records = [];
for (const file of files) {
  const source = await readFile(join(dir, file), 'utf8');
  const content = file.endsWith('.ts') ? source.replaceAll("'../graph/rank.ts'", "'../graph/rank'") : source;
  await mkdir(resolve(target, file, '..'), { recursive: true });
  await writeFile(join(target, file), content);
  records.push({ file, sourceSha256: createHash('sha256').update(source).digest('hex'), sha256: createHash('sha256').update(content).digest('hex') });
}
await writeFile(join(target, 'PROVENANCE.json'), JSON.stringify({
  upstream: 'https://github.com/adoresever/graph-memory', commit: '5841b1987c3967998818764c9d4238add5f3aa7c', license: 'MIT',
  adaptation: 'Local async PostgreSQL port plus upstream storage-free personalized ranking. Vendor-only change removes .ts import suffix for the host compiler. No DSH/OpenClaw host or provider client imported.', files: records,
}, null, 2) + '\n');
