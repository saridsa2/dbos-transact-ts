import { describe, it, expect } from 'vitest';
import { evaluateExpression, expressionAst, expressionNodeReferences } from './expressions';
import { compileParameter, parameterFromBinding, defaultCode } from './model';
import { compileAuthoringGraph } from './compiler';
import { blankNativeGraph } from '../native/examples';
import { bind } from '../native/model';
import { parseFlow, validateFlow } from '../flows/validation';
import type { AgentFlow } from '../flows/types';
describe('Stack Proc authoring compiler', () => {
  it('evaluates constrained references, conditions and helpers', () => {
    const ctx = { input: { variables: { count: 3 } }, outputs: { a: { value: 2 } }, variables: { factor: 4 } };
    expect(evaluateExpression('$input.variables.count * $vars.factor + $nodes["a"].value', ctx)).toBe(14);
    expect(evaluateExpression('sum([1,2,3]) > 4 ? upper("yes") : "no"', ctx)).toBe('YES');
    expect(expressionNodeReferences('$nodes["a"].value')).toEqual(['a']);
  });
  it('rejects host access, prototype paths, arbitrary calls and complex scripts', () => {
    for (const source of [
      'process.env',
      '$nodes',
      'values($nodes)',
      'globalThis',
      'new Function("return process")()',
      '$input.constructor',
      'string.constructor("return process")()',
      '(()=>1)()',
      'a=3',
    ])
      expect(() => expressionAst(source), source).toThrow();
  });
  it('rejects non-JSON nested results and oversized helper outputs', () => {
    const ctx = { input: {}, outputs: {} };
    expect(() => evaluateExpression('[1 / 0]', ctx)).toThrow(/finite/);
    expect(() =>
      evaluateExpression('join($input.items, $input.separator)', {
        ...ctx,
        input: { items: Array(100).fill('a'), separator: 'x'.repeat(100000) },
      }),
    ).toThrow(/limit/);
  });
  it('compiles nested fixed and expression objects without exposing DBOS bindings to authoring', () => {
    const p = {
      mode: 'object' as const,
      fields: {
        fixed: { mode: 'fixed' as const, value: [1, 2] },
        computed: { mode: 'expression' as const, expression: '$vars.count * 2' },
      },
    };
    expect(bind(compileParameter(p), { input: {}, outputs: {}, variables: { count: 3 } })).toEqual({
      fixed: [1, 2],
      computed: 6,
    });
    expect(parameterFromBinding({ source: 'node', nodeId: 'a', path: 'total' })).toEqual({
      mode: 'expression',
      expression: '$nodes["a"]["total"]',
    });
  });
  it('preserves legacy graphs and compiles code into a durable invocation', () => {
    const legacy = blankNativeGraph();
    expect(compileAuthoringGraph(legacy)).toBe(legacy);
    const flow: AgentFlow = {
      ...legacy,
      authoringVersion: 1,
      variables: { factor: { mode: 'fixed', value: 2 } },
      nodes: [
        legacy.nodes[0],
        {
          id: 'code',
          name: 'Code',
          kind: 'code',
          position: { x: 200, y: 0 },
          config: {
            code: defaultCode(),
            parameters: { input: { mode: 'expression', expression: '$input.variables.items' } },
          },
        },
      ],
      edges: [{ id: 'edge', source: legacy.nodes[0].id, target: 'code' }],
    };
    const parsed = parseFlow(JSON.parse(JSON.stringify(flow)));
    validateFlow(parsed);
    const compiled = compileAuthoringGraph(parsed);
    expect(compiled.nodes[1].kind).toBe('step');
    expect(compiled.nodes[1].config.operation).toMatchObject({ handler: 'stackproc.code.v1' });
    expect(parsed.nodes[1].kind).toBe('code');
    expect(compiled._compiled?.variables.factor).toEqual({ source: 'literal', value: 2 });
  });
  it('rejects downstream expression references and unsupported code dependencies', () => {
    const flow = blankNativeGraph();
    flow.authoringVersion = 1;
    flow.nodes[1].config.parameters = { value: { mode: 'expression', expression: '$nodes["missing"].value' } };
    expect(() => compileAuthoringGraph(flow)).toThrow(/upstream/);
  });
});
