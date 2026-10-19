import { assertValue } from '../../lib/authoring/contracts';
import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { codeSchema, type CodeDefinition } from '../../lib/authoring/model';
export type CodeResult = { value: unknown; logs: string[]; revision: string };
export interface CodeRunner {
  execute(
    definition: CodeDefinition,
    input: unknown,
    variables: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<CodeResult>;
}
export function sealCode(definition: CodeDefinition): CodeDefinition {
  const { revision: _, ...code } = codeSchema.parse(definition);
  return { ...code, revision: createHash('sha256').update(JSON.stringify(code)).digest('hex') };
}
let active = 0;
/** Guest source executes only inside QuickJS WASM. No Node objects or host functions are exposed. */
export const isolatedCodeRunner: CodeRunner = {
  async execute(raw, input, variables, signal) {
    const definition = sealCode(raw);
    if (definition.inputSchema) assertValue(definition.inputSchema, input, 'Code input');
    if (!definition.source.trim()) throw new Error('Source code is required.');
    if (raw.revision && raw.revision !== definition.revision)
      throw new Error('Code revision does not match the captured definition.');
    if (signal?.aborted) throw new Error('Code execution cancelled.');
    if (Buffer.byteLength(JSON.stringify({ input, variables })) > 4 * 1024 * 1024)
      throw new Error('Code input exceeds 4 MiB.');
    if (active >= 4) throw new Error('Code runner capacity reached. Retry later.');
    active++;
    try {
      return await new Promise<CodeResult>((resolve, reject) => {
        const worker = new Worker(new URL('./worker.mjs', import.meta.url), {
          workerData: { definition, input, variables },
          env: {},
          execArgv: [],
          resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
        });
        let finished = false;
        const finish = (error?: Error, result?: CodeResult) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', cancel);
          void worker.terminate().finally(() => (error ? reject(error) : resolve(result!)));
        };
        const cancel = () => finish(new Error('Code execution cancelled.'));
        const timer = setTimeout(
          () => finish(new Error('Code execution exceeded its wall-clock timeout.')),
          definition.limits.timeoutMS,
        );
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) cancel();
        worker.once('message', (message) => {
          if (!message.ok) return finish(new Error(message.error));
          try {
            if (definition.outputSchema) assertValue(definition.outputSchema, message.value, 'Code output');
          } catch (err) {
            return finish(err instanceof Error ? err : new Error('Output schema failed.'));
          }
          const result = { value: message.value, logs: message.logs, revision: definition.revision! };
          if (Buffer.byteLength(JSON.stringify(result)) > definition.limits.maxOutputBytes + 20000)
            return finish(new Error('Code result exceeds limit.'));
          finish(undefined, result);
        });
        worker.once('error', (err) => finish(err));
        worker.once('exit', (code) => {
          if (!finished) finish(new Error(`Code worker stopped without a result (${code}).`));
        });
      });
    } finally {
      active--;
    }
  },
};
