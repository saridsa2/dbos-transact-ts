import { describe, it, expect } from 'vitest';
import { packTool, unpackTool } from './package';
import { starterFiles } from '../../lib/tools/contracts';
import { zipSync, strToU8 } from 'fflate';
describe('portable tool envelope', () => {
  it('roundtrips exact source, schemas and fixtures', () => {
    const f = starterFiles('396789d8-86fa-4d41-bfb9-63da004e4c62');
    expect(unpackTool(packTool(f))).toEqual(f);
  });
  it('rejects oversized, traversal and tampered envelopes', () => {
    expect(() => unpackTool(new Uint8Array(1100001))).toThrow();
    expect(() => unpackTool(zipSync({ '../tool.json': strToU8('{}') }))).toThrow();
    expect(() =>
      unpackTool(
        zipSync({
          'tool.json': strToU8('{}'),
          '__stackproc.json': strToU8('{"schemaVersion":1,"hash":"wrong","files":[]}'),
        }),
      ),
    ).toThrow();
  });
});
