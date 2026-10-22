import { expect, it } from 'vitest';
import { ContextMemory } from '../context-memory';
it('shares concurrent local readiness probes and releases failed probes for an explicit recheck', async () => {
  let calls = 0,
    complete!: (value: number[]) => void;
  const embedder = {
    dimensions: 2,
    model: 'local',
    embed: () => {
      calls++;
      return new Promise<number[]>((resolve) => {
        complete = resolve;
      });
    },
  };
  const service = {
    memoryIndex: { embedder },
    pool: { query: async () => ({ rows: [{ approved: 0, indexed: 0 }] }) },
    memoryGraph: { status: async () => ({ initialized: true }) },
  } as any;
  const memory = new ContextMemory(service),
    ctx = { workspace: { id: 'w' } } as any;
  const first = memory.status(ctx),
    second = memory.status(ctx);
  expect(calls).toBe(1);
  complete([1, 0]);
  expect((await first).available).toBe(true);
  expect((await second).available).toBe(true);
  embedder.embed = () => {
    calls++;
    throw Error('worker busy');
  };
  expect((await memory.status(ctx)).available).toBe(false);
  embedder.embed = async () => {
    calls++;
    return [1, 0];
  };
  expect((await memory.status(ctx)).available).toBe(true);
  expect(calls).toBe(3);
});
