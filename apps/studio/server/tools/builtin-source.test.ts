import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { builtinToolSource } from './builtin-source';
import { toolNames } from '../../lib/agent/contracts';
import { toolRoutes } from './routes';
import { ControlError } from '../control/service';

describe('built-in implementation inspection', () => {
  it('returns exact installed implementation code, dispatcher and supporting schema', async () => {
    const result = await builtinToolSource('memory_search_v2');
    expect(result.primary).toBe('server/agent/context-memory.ts');
    expect(result.files[result.primary]).toBe(
      await readFile(new URL('../agent/context-memory.ts', import.meta.url), 'utf8'),
    );
    expect(result.files[result.entrypoint]).toContain("case 'memory_search_v2'");
    expect(JSON.parse(result.files['schemas/input.schema.json']).properties.query.type).toBe('string');
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('resolves every registered tool without arbitrary file access', async () => {
    for (const name of toolNames) expect((await builtinToolSource(name)).files).toBeTruthy();
    for (const name of ['../../.env.local', 'toString', 'missing_v1'])
      await expect(builtinToolSource(name)).rejects.toThrow('Built-in tool not found');
  });
  it('requires workspace read authorization before returning source', async () => {
    const responses: unknown[] = [];
    const store = {
      control: {
        context: async () => {
          throw new ControlError(403, 'Forbidden');
        },
      },
    };
    const route = toolRoutes(
      store as any,
      async () => ({}),
      (_res, status, value) => {
        responses.push({ status, value });
      },
    );
    await route({ method: 'GET' } as any, {} as any, new URL('http://local/api/tools/builtins/memory_search_v2'));
    expect(responses).toEqual([{ status: 403, value: { error: 'Forbidden' } }]);
  });
});
