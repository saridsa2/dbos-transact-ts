import ts from 'typescript';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative, extname } from 'node:path';
if (!process.argv[2]) throw Error('Usage: node scripts/audit-agent-source.mjs SOURCE_DIRECTORY [OUTPUT_JSON]');
const root = resolve(process.argv[2]);
const files = [];
async function scan(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = resolve(dir, e.name);
    if (e.isDirectory()) await scan(p);
    else if (/\.(ts|tsx)$/.test(p)) files.push(p);
  }
}
await scan(root);
const known = new Set(files);
const deps = new Map();
const missing = [];
const external = new Set();
for (const f of files) {
  const ast = ts.createSourceFile(f, await readFile(f, 'utf8'), ts.ScriptTarget.Latest, true);
  const specs = new Set();
  function visit(n) {
    if (
      (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) &&
      n.moduleSpecifier &&
      ts.isStringLiteral(n.moduleSpecifier)
    )
      specs.add(n.moduleSpecifier.text);
    if (
      ts.isCallExpression(n) &&
      n.arguments[0] &&
      ts.isStringLiteral(n.arguments[0]) &&
      (n.expression.kind === ts.SyntaxKind.ImportKeyword || n.expression.getText(ast) === 'require')
    )
      specs.add(n.arguments[0].text);
    ts.forEachChild(n, visit);
  }
  visit(ast);
  const edges = [];
  for (const s of specs) {
    if (!s.startsWith('.') && !s.startsWith('src/')) {
      external.add(s);
      continue;
    }
    const base = s.startsWith('src/') ? resolve(root, s.slice(4)) : resolve(dirname(f), s);
    const stem = base.replace(/\.(js|mjs|cjs)$/, '');
    const p = [base, stem + '.ts', stem + '.tsx', resolve(stem, 'index.ts'), resolve(stem, 'index.tsx')].find((p) =>
      known.has(p),
    );
    if (p) edges.push(p);
    else missing.push({ file: relative(root, f), import: s });
  }
  deps.set(f, edges);
}
const seen = new Set();
function walk(f) {
  if (seen.has(f)) return;
  seen.add(f);
  for (const d of deps.get(f) ?? []) walk(d);
}
walk(resolve(root, 'QueryEngine.ts'));
walk(resolve(root, 'query.ts'));
const result = {
  sourceFiles: files.length,
  coreReachableFiles: seen.size,
  unresolvedLocalImports: missing.length,
  coreUnresolvedLocalImports: missing.filter((x) => seen.has(resolve(root, x.file))).length,
  externalPackages: [
    ...new Set(
      [...external]
        .filter((x) => !x.startsWith('node:'))
        .map((x) => (x.startsWith('@') ? x.split('/').slice(0, 2).join('/') : x.split('/')[0])),
    ),
  ].sort(),
  missingCore: missing.filter((x) => seen.has(resolve(root, x.file))),
};
if (process.argv[3]) await writeFile(resolve(process.argv[3]), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, missingCore: result.missingCore.slice(0, 12) }, null, 2));
