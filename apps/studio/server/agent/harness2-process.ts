import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
export const HARNESS2_REVISION = '1cfe254e8d25b15f37048c3730134686abe60335';
export const OPENCODE_REVISION = '23fb5e0516c99ac04a1aa46c193efda2e1b9bb24';
export type EngineEvent = { type: string; [key: string]: any };
/** Host process/stream adapter. All inference/tool orchestration belongs to upstream. */
export async function runHarness2Process(
  payload: Record<string, unknown>,
  onEvent: (event: EngineEvent) => Promise<void>,
  signal?: AbortSignal,
) {
  const python = resolve('server/harness2/.venv/bin/python');
  const child = spawn(python, [resolve('server/harness2/worker.py')], {
    cwd: process.cwd(),
    env: {
      NODE_ENV: process.env.NODE_ENV ?? 'development',
      ...Object.fromEntries(
        ['PATH', 'TMPDIR', 'SYSTEMROOT'].flatMap((key) => (process.env[key] ? [[key, process.env[key]!]] : [])),
      ),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let failure: Error | undefined;
  let complete = false;
  let bytes = 0;
  const stop = () => child.kill('SIGTERM');
  signal?.addEventListener('abort', stop, { once: true });
  const killTimer = setTimeout(() => child.kill('SIGKILL'), 15 * 60 * 1000);
  const closed = new Promise<void>((accept, reject) => {
    child.on('error', () =>
      reject(
        new Error('Harness2 executor is unavailable. Run npm run harness2:setup and npm run harness2:executor:setup.'),
      ),
    );
    child.on('close', (code) =>
      code === 0 ? accept() : reject(failure ?? new Error(`Harness2 executor stopped (status ${code}).`)),
    );
  });
  void closed.catch(() => {});
  // Stderr is deliberately consumed without exposing environment or raw logs.
  child.stderr.resume();
  child.stdin.on('error', () => {});
  child.stdin.end(JSON.stringify(payload));
  const lines = createInterface({ input: child.stdout });
  try {
    for await (const line of lines) {
      bytes += Buffer.byteLength(line);
      if (bytes > 8 * 1024 * 1024) {
        stop();
        throw new Error('Executor transcript exceeded the event limit.');
      }
      const event = JSON.parse(line) as EngineEvent;
      if (event.type === 'host_error') failure = new Error(String(event.message));
      if (event.type === 'executor_complete' || event.type === 'refinement_complete') complete = true;
      await onEvent(event);
    }
    await closed;
    if (failure) throw failure;
    if (!complete && payload.command !== 'check') throw new Error('Executor closed without a completion receipt.');
  } finally {
    clearTimeout(killTimer);
    signal?.removeEventListener('abort', stop);
    if (child.exitCode === null) stop();
    await closed.catch(() => {});
  }
}
