import { describe, it, expect } from 'vitest';
import { compileAuthoringGraph } from './compiler';
import { executeScopedGraph } from './scoped-executor';
import { bind } from '../native/model';
import type { AgentFlow, FlowNodeData, FlowRunEvent } from '../flows/types';
import { compileParameter, parameterSchema, defaultCode } from './model';
import { compilePreview } from './preview';
const p = (value: unknown) => ({ mode: 'fixed' as const, value });
function flow(): AgentFlow {
  return {
    id: 'scoped',
    name: 'Scoped',
    schemaVersion: 2,
    authoringVersion: 2,
    declarations: [{ id: 'count', name: 'Count', schema: { type: 'number' }, initial: p(0), writable: true }],
    nodes: [{ id: 'start', name: 'Start', kind: 'trigger', config: {}, position: { x: 0, y: 0 } }],
    edges: [],
  };
}
function add(f: AgentFlow, id: string, kind: FlowNodeData['kind'], config: FlowNodeData['config'], sources: string[]) {
  f.nodes.push({ id, name: id, kind, config, position: { x: 0, y: 0 } });
  for (const source of sources)
    f.edges.push({ id: `${source}-${id}`, source, target: id, sourcePort: 'value', targetPort: 'input' });
}
async function run(f: AgentFlow) {
  const compiled = compileAuthoringGraph(f);
  const events: FlowRunEvent[] = [];
  for await (const event of executeScopedGraph(compiled, {}, 'run', async (n, ctx) => {
    const op = n.config.operation!;
    return {
      value: n.kind === 'trigger' ? {} : op.kind === 'assign' || op.kind === 'return' ? bind(op.value, ctx) : null,
    };
  }))
    events.push(event);
  return events;
}
describe('scoped authoring v2', () => {
  it('preserves typed inactive drafts and rejects malformed editor metadata', () => {
    const value = {
      mode: 'expression',
      expression: '$input',
      _editor: { fixed: { mode: 'array', items: [{ mode: 'fixed', value: 1 }], _editor: { itemIds: ['entry-one'] } } },
    };
    expect(parameterSchema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value);
    expect(() => parameterSchema.parse({ ...value, _editor: { fixed: { broken: true } } })).toThrow();
    expect(() => compileParameter({ mode: 'array', items: [{ mode: 'omit' }] })).toThrow(/cannot be omitted/);
  });
  it('previews one configured node without executing unrelated incomplete drafts', () => {
    const f = flow();
    add(f, 'ready', 'construct', { parameters: { value: p(1) } }, ['start']);
    add(f, 'draft', 'code', { code: { ...defaultCode(), profile: 'pure-transform@1', source: '' } }, ['ready']);
    expect(() => compileAuthoringGraph(f)).toThrow(/source code/);
    expect(compilePreview(f, f.nodes[1]).nodes[1].config.operation).toMatchObject({ kind: 'assign' });
  });
  it('keeps siblings isolated and merges only explicitly selected updates', async () => {
    const f = flow();
    add(f, 'left', 'setVariables', { parameters: { values: { mode: 'object', fields: { count: p(8) } } } }, ['start']);
    add(f, 'right', 'construct', { parameters: { value: { mode: 'expression', expression: '$vars.count' } } }, [
      'start',
    ]);
    add(
      f,
      'merge',
      'merge',
      {
        parameters: { value: { mode: 'expression', expression: '$nodes["right"]' } },
        merge: {
          updates: [{ variableId: 'count', value: { mode: 'expression', expression: '$nodes["left"].count' } }],
        },
      },
      ['left', 'right'],
    );
    add(
      f,
      'result',
      'return',
      { operation: { kind: 'return', value: { source: 'expression', expression: '$vars.count' } } },
      ['merge'],
    );
    const events = await run(f);
    expect(events.find((e) => e.type === 'node.completed' && e.nodeId === 'right')).toMatchObject({ output: 0 });
    expect(events.at(-1)).toMatchObject({ output: { result: 8 } });
  });
  it('rejects undeclared or wrong-typed writes without leaking a partial update', async () => {
    const f = flow();
    add(f, 'write', 'setVariables', { parameters: { values: { mode: 'object', fields: { count: p('bad') } } } }, [
      'start',
    ]);
    await expect(run(f)).rejects.toThrow(/Variable Count/);
    f.nodes[1].config.parameters = { values: { mode: 'object', fields: { unknown: p(1) } } };
    await expect(run(f)).rejects.toThrow(/undeclared/);
  });
  it('requires explicit merges and rejects duplicate update targets', () => {
    const f = flow();
    add(f, 'a', 'construct', { parameters: { value: p(1) } }, ['start']);
    add(f, 'b', 'construct', { parameters: { value: p(2) } }, ['start']);
    add(f, 'result', 'return', { operation: { kind: 'return', value: { source: 'literal', value: null } } }, [
      'a',
      'b',
    ]);
    expect(() => compileAuthoringGraph(f)).toThrow(/explicit Merge/);
    f.nodes[3].kind = 'merge';
    f.nodes[3].config = {
      merge: {
        updates: [
          { variableId: 'count', value: p(1) },
          { variableId: 'count', value: p(2) },
        ],
      },
      parameters: { value: p(null) },
    };
    expect(() => compileAuthoringGraph(f)).toThrow(/duplicate/);
  });
  it('preserves omitted fields separately from null and rejects missing required output', async () => {
    const f = flow();
    add(
      f,
      'data',
      'construct',
      { parameters: { value: { mode: 'object', fields: { omitted: { mode: 'omit' }, nullable: p(null) } } } },
      ['start'],
    );
    expect((await run(f)).find((e) => e.type === 'node.completed' && e.nodeId === 'data')).toMatchObject({
      output: { nullable: null },
    });
    f.nodes[1].config.parameters = { value: { mode: 'omit' } };
    await expect(run(f)).rejects.toThrow(/absent/);
    f.nodes[1].config.ports = { output: { id: 'value', schema: {}, required: false, cardinality: 'single' } };
    expect((await run(f)).find((e) => e.type === 'node.completed' && e.nodeId === 'data')).toMatchObject({
      presence: 'absent',
    });
  });
  it('enforces pure profile and visible repetition only in new graphs', () => {
    const f = flow();
    add(f, 'code', 'code', { code: { ...defaultCode(), profile: 'pure-transform@1', mode: 'each-item' } }, ['start']);
    expect(() => compileAuthoringGraph(f)).toThrow(/For each/);
    f.authoringVersion = 1;
    expect(compileAuthoringGraph(f).nodes[1].config.code?.mode).toBe('each-item');
  });
  it('pins named ports and rejects incompatible resolved output without coercion', async () => {
    const f = flow();
    add(
      f,
      'data',
      'construct',
      {
        parameters: { value: p('3') },
        ports: { output: { id: 'value', schema: { type: 'number' }, cardinality: 'single', required: true } },
      },
      ['start'],
    );
    await expect(run(f)).rejects.toThrow(/must be number/);
  });
});
