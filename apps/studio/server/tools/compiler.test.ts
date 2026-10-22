import { describe, it, expect } from 'vitest';
import { compileTool, executeBuild, packageHash, testBuild } from './compiler';
import { starterFiles } from '../../lib/tools/contracts';
const id = '396789d8-86fa-4d41-bfb9-63da004e4c62';
describe('authored tool compiler and isolate', () => {
  it('compiles typed source, validates fixture and isolates host APIs', async () => {
    const files = starterFiles(id),
      build = await compileTool(files);
    expect(build.diagnostics).toEqual([]);
    expect(await testBuild(build, files)).toMatchObject({ success: true, results: [{ output: { total: 6 } }] });
    await expect(executeBuild(build, { values: ['bad'] }, 'test')).rejects.toThrow();
    files['src/index.ts'] =
      'export function run() { return { total: typeof process === "undefined" && typeof fetch === "undefined" ? 6 : 0 }; }';
    const invalid = await compileTool(files);
    expect(invalid.diagnostics.length).toBeGreaterThan(0);
  });
  it('hashes independently of insertion order, rejects escaped paths and external imports', async () => {
    const files = starterFiles(id);
    expect(packageHash(files)).toBe(packageHash(Object.fromEntries(Object.entries(files).reverse())));
    expect(() => packageHash({ ...files, 'src/../bad.ts': '' })).toThrow();
    files['src/index.ts'] = 'import fs from "node:fs"; export function run(){ return fs.readFileSync("/etc/passwd"); }';
    expect((await compileTool(files)).diagnostics.length).toBeGreaterThan(0);
  });
  it('supports package helpers, reports source errors and rejects mismatched fixture output', async () => {
    const files = starterFiles(id);
    files['src/helpers.ts'] = 'export const twice = (n: number) => n * 2;';
    files['src/index.ts'] =
      'import { twice } from "./helpers"; export function run(input: {values: number[]}) { return {total: twice(input.values[0])}; }';
    const build = await compileTool(files);
    expect(build.diagnostics).toEqual([]);
    expect((await testBuild(build, files)).success).toBe(false);
    files['src/index.ts'] = 'export function run() { const n: number = "bad"; return n; }';
    expect((await compileTool(files)).diagnostics[0]).toMatchObject({ file: 'src/index.ts', line: 1 });
  });
  it('bounds execution and validates the output schema', async () => {
    const files = starterFiles(id);
    files['src/index.ts'] = 'export function run() { return {total:"bad"}; }';
    await expect(executeBuild(await compileTool(files), { values: [1] }, 'test')).rejects.toThrow();
    files['src/index.ts'] = 'export function run() { while(true){} }';
    const manifest = JSON.parse(files['tool.json']);
    manifest.limits.timeoutMS = 100;
    files['tool.json'] = JSON.stringify(manifest);
    await expect(executeBuild(await compileTool(files), { values: [1] }, 'test')).rejects.toThrow();
  });
});
