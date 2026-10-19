import { describe, it, expect } from 'vitest';
import { isolatedCodeRunner, sealCode } from './runner';
import { defaultCode } from '../../lib/authoring/model';
describe('isolated code runner', () => {
  it('runs JavaScript with bounded logs and revision', async () => {
    const code = { ...defaultCode(), source: 'console.log("ok"); return input.map(x => x * variables.factor);' };
    const result = await isolatedCodeRunner.execute(code, [1, 2], { factor: 3 });
    expect(result.value).toEqual([3, 6]);
    expect(result.logs).toEqual(['log: ok']);
    expect(result.revision).toHaveLength(64);
  });
  it('runs TypeScript and asynchronous local computations', async () => {
    expect(
      (
        await isolatedCodeRunner.execute(
          {
            ...defaultCode(),
            language: 'typescript',
            source: 'const x: number = await Promise.resolve(input); return x + 1;',
          },
          3,
          {},
        )
      ).value,
    ).toBe(4);
  });
  it('supports per-item mode', async () => {
    expect(
      (
        await isolatedCodeRunner.execute(
          { ...defaultCode(), mode: 'each-item', source: 'return {value: item, index};' },
          ['a', 'b'],
          {},
        )
      ).value,
    ).toEqual([
      { value: 'a', index: 0 },
      { value: 'b', index: 1 },
    ]);
  });
  it('does not expose Node, environment, network, module loading or host process', async () => {
    const result = await isolatedCodeRunner.execute(
      {
        ...defaultCode(),
        source: 'return [typeof process, typeof require, typeof fetch, typeof Buffer, typeof setTimeout];',
      },
      null,
      {},
    );
    expect(result.value).toEqual(Array(5).fill('undefined'));
    await expect(
      isolatedCodeRunner.execute({ ...defaultCode(), source: 'return await import("node:fs");' }, null, {}),
    ).rejects.toThrow();
  });
  it('terminates infinite loops and unresolved promises', async () => {
    await expect(
      isolatedCodeRunner.execute(
        { ...defaultCode(), limits: { ...defaultCode().limits, timeoutMS: 400 }, source: 'while(true){}' },
        null,
        {},
      ),
    ).rejects.toThrow(/timeout|interrupted/i);
    await expect(
      isolatedCodeRunner.execute({ ...defaultCode(), source: 'return await new Promise(()=>{});' }, null, {}),
    ).rejects.toThrow(/unresolved/);
  });
  it('enforces output, JSON and revision limits', async () => {
    await expect(
      isolatedCodeRunner.execute(
        {
          ...defaultCode(),
          source: 'return "x".repeat(5000);',
          limits: { ...defaultCode().limits, maxOutputBytes: 100 },
        },
        null,
        {},
      ),
    ).rejects.toThrow(/limit/);
    await expect(
      isolatedCodeRunner.execute({ ...defaultCode(), source: 'return undefined;' }, null, {}),
    ).rejects.toThrow(/JSON/);
    const code = sealCode(defaultCode());
    await expect(isolatedCodeRunner.execute({ ...code, source: 'return 2;' }, null, {})).rejects.toThrow(/revision/);
  });
  it('enforces the guest heap limit', async () => {
    await expect(
      isolatedCodeRunner.execute(
        {
          ...defaultCode(),
          limits: { ...defaultCode().limits, memoryMB: 8 },
          source: 'const x = []; while(true) x.push(new Array(10000).fill(1));',
        },
        null,
        {},
      ),
    ).rejects.toThrow(/memory|alloc|out of|interrupted|timeout/i);
  });
  it('kills a worker on cancellation', async () => {
    const abort = new AbortController();
    const run = isolatedCodeRunner.execute({ ...defaultCode(), source: 'while(true){}' }, null, {}, abort.signal);
    setTimeout(() => abort.abort(), 150);
    await expect(run).rejects.toThrow(/cancelled/);
  });
});
