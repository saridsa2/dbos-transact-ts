import { implementationHash } from './implementation';
import { describe, it, expect } from 'vitest';
import { knowledgeFixtures } from '../knowledge/fixtures';
import { migrateProcess, processGraphIssues, processV2Schema, applyProcessCommand } from './model';
import { defaultProcessOperation, processOperations } from './defaults';
import { generateWorkflow } from '../intelligence/generation';
import { compileAuthoringGraph } from '../authoring/compiler';
import { executeScopedGraph } from '../authoring/scoped-executor';
import { bind, evaluate } from '../native/model';
const fixed = (value: unknown) => ({ mode: 'fixed' as const, value });
function decisionProcess(condition = true) {
  const doc = migrateProcess(knowledgeFixtures()[0].process),
    start = doc.graph.elements[0];
  doc.graph.elements = [
    start,
    {
      id: 'decision',
      name: 'Eligibility',
      kind: 'decision',
      evidence: [],
      operator: 'truthy',
      left: fixed(condition),
      right: fixed(null),
    },
    {
      id: 'yes',
      name: 'Eligible',
      kind: 'activity',
      evidence: [],
      binding: { kind: 'construct', value: fixed('approved') },
    },
    {
      id: 'no',
      name: 'Ineligible',
      kind: 'activity',
      evidence: [],
      binding: { kind: 'construct', value: fixed('declined') },
    },
    { id: 'merge', name: 'Outcome', kind: 'merge', evidence: [] },
    {
      id: 'result',
      name: 'Result',
      kind: 'end',
      evidence: [],
      value: { mode: 'expression', expression: '$nodeInput' },
    },
  ];
  doc.graph.flows = [
    { id: 'a', source: start.id, target: 'decision' },
    { id: 'b', source: 'decision', target: 'yes', outcome: 'true' },
    { id: 'c', source: 'decision', target: 'no', outcome: 'false' },
    { id: 'd', source: 'yes', target: 'merge' },
    { id: 'e', source: 'no', target: 'merge' },
    { id: 'f', source: 'merge', target: 'result' },
  ];
  return processV2Schema.parse(doc);
}
describe('structured process compilation', () => {
  for (const condition of [true, false])
    it(`executes only the ${condition} branch and merges the selected route`, async () => {
      const doc = decisionProcess(condition);
      expect(processGraphIssues(doc)).toEqual([]);
      const generated = await generateWorkflow('Decision', doc, { artifactId: 'p', revisionId: 'r' }),
        events = [];
      for await (const event of executeScopedGraph(
        compileAuthoringGraph(generated.flow),
        generated.flow.defaultInput ?? {},
        'test',
        async (node, ctx) => {
          const op = node.config.operation;
          if (!op) return { value: ctx.input };
          if (op.kind === 'decision') {
            const selected = evaluate(op.predicate, ctx);
            return { value: selected, outcome: selected ? 'true' : 'false' };
          }
          return { value: bind((op as any).value, ctx) };
        },
      ))
        events.push(event);
      expect((events.at(-1) as any).output.result).toBe(condition ? 'approved' : 'declined');
      expect(events.filter((e) => e.type === 'node.skipped').map((e) => e.nodeId)).toEqual([condition ? 'no' : 'yes']);
      expect(generated.manifest.generator).toBe('visual-structured-process@3');
    });
  it('ignores revision bookkeeping while detecting actual implementation edits', async () => {
    const generated = await generateWorkflow('Hash fixture', decisionProcess(), { artifactId: 'p', revisionId: 'r' });
    expect(
      await implementationHash({ ...generated.flow, editVersion: 22, updatedAt: '2026-10-20', diagnostics: [] }),
    ).toBe(await implementationHash(generated.flow));
    expect(await implementationHash({ ...generated.flow, name: 'Changed implementation' })).not.toBe(
      await implementationHash(generated.flow),
    );
  });
  it('requires explicit branch labels and checks every branch for cycles', () => {
    const doc = decisionProcess();
    delete doc.graph.flows[1].outcome;
    expect(processGraphIssues(doc).some((i) => i.code === 'decision_routes')).toBe(true);
    doc.graph.flows.push({ id: 'cycle', source: 'no', target: 'decision' });
    expect(processGraphIssues(doc).some((i) => i.code === 'cycle')).toBe(true);
  });
  it('assigns distinct decision outcomes and prevents cycles during reconnection', () => {
    const doc = decisionProcess();
    doc.graph.flows = doc.graph.flows.filter((e) => e.source !== 'decision');
    const a = applyProcessCommand(doc, { type: 'connect', id: 'x', source: 'decision', target: 'yes' });
    const b = applyProcessCommand(a, { type: 'connect', id: 'y', source: 'decision', target: 'no' });
    expect(b.graph.flows.filter((e) => e.source === 'decision').map((e) => e.outcome)).toEqual(['true', 'false']);
    expect(() => applyProcessCommand(b, { type: 'connect', id: 'd', source: 'merge', target: 'decision' })).toThrow();
  });
  it('requires timeout routes for human approval and message/event waits', async () => {
    for (const kind of ['review', 'receive', 'waitEvent'] as const) {
      const doc = migrateProcess(knowledgeFixtures()[0].process);
      const activity = doc.graph.elements[1];
      if (activity.kind === 'activity')
        activity.binding = { kind: 'operation', operation: defaultProcessOperation(kind), parameters: {} };
      expect(processGraphIssues(doc).some((i) => i.code === 'timeout_routes')).toBe(true);
      await expect(generateWorkflow('Wait', doc, { artifactId: 'p', revisionId: 'r' })).rejects.toThrow('Timeout');
    }
  });
  it('allows every palette operation to be saved as an incomplete draft', () => {
    for (const kind of Object.keys(processOperations) as (keyof typeof processOperations)[]) {
      const doc = migrateProcess(knowledgeFixtures()[0].process);
      const activity = doc.graph.elements[1];
      if (activity.kind === 'activity')
        activity.binding = { kind: 'operation', operation: defaultProcessOperation(kind), parameters: {} };
      expect(processV2Schema.safeParse(doc).success, kind).toBe(true);
    }
  });
  it('pins responsibility metadata and rejects missing lane references', async () => {
    const doc = decisionProcess();
    doc.lanes = [{ id: 'credit', name: 'Credit team', role: 'editor' }];
    doc.graph.elements[1].laneId = 'credit';
    const generated = await generateWorkflow('Credit', doc, { artifactId: 'p', revisionId: 'r' });
    expect(generated.manifest.lanes).toEqual(doc.lanes);
    doc.graph.elements[1].laneId = 'absent';
    expect(processGraphIssues(doc).some((i) => i.code === 'lane')).toBe(true);
  });
  it('compiles published specialists with a distinct versioned handler and immutable manifest reference', async () => {
    const doc = migrateProcess(knowledgeFixtures()[0].process),
      activity = doc.graph.elements[1];
    if (activity.kind !== 'activity') throw Error('fixture');
    const agentRef = { agentId: crypto.randomUUID(), revision: 2, hash: 'a'.repeat(64) };
    activity.binding = {
      kind: 'agent',
      definition: {
        agentRef,
        goal: 'Review evidence',
        tools: ['workspace_describe_v1'],
        outputSchema: { type: 'object' },
        maxTurns: 4,
        deadlineSeconds: 60,
      },
      input: { mode: 'expression', expression: '$input.variables' },
    };
    const generated = await generateWorkflow('Named agent', doc, { artifactId: 'p', revisionId: 'r' }),
      compiled = compileAuthoringGraph(generated.flow);
    expect((compiled.nodes[1].config.operation as any).handler).toBe('stackproc.process-agent.v2');
    expect((generated.manifest.elements as any[])[1].agent.agentRef).toEqual(agentRef);
    expect(JSON.stringify(compiled.nodes[1].config)).toContain(agentRef.hash);
  });
  it('pins agent policy and typed input without compiling it as an ordinary data node', async () => {
    const doc = migrateProcess(knowledgeFixtures()[0].process),
      activity = doc.graph.elements[1];
    if (activity.kind !== 'activity') throw Error('fixture');
    activity.binding = {
      kind: 'agent',
      definition: {
        configurationRevision: 3,
        goal: 'Review evidence',
        tools: ['workspace_describe_v1'],
        outputSchema: { type: 'object' },
        maxTurns: 4,
        deadlineSeconds: 60,
      },
      input: { mode: 'expression', expression: '$input.variables' },
    };
    const generated = await generateWorkflow('Agent', doc, { artifactId: 'p', revisionId: 'r' }),
      compiled = compileAuthoringGraph(generated.flow);
    expect(compiled.nodes[1].config.operation?.kind).toBe('step');
    expect((compiled.nodes[1].config.operation as any).handler).toBe('stackproc.process-agent.v1');
    expect((generated.manifest.elements as any[])[1].agent.configurationRevision).toBe(3);
  });
});
