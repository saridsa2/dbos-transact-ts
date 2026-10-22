import { parentPort, workerData } from 'node:worker_threads';
try {
  const engine = workerData.development
    ? await (await import('tsx/esm/api')).tsImport('./compiler.ts', import.meta.url)
    : await import('./compiler-engine.mjs');
  parentPort.postMessage({ ok: true, build: await engine.compileInProcess(workerData.files) });
} catch (e) {
  parentPort.postMessage({ ok: false, error: String(e?.message ?? 'Compilation failed.').slice(0, 8000) });
}
