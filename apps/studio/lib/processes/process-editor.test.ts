import { describe, it, expect } from 'vitest';
import { canonicalJson } from '../knowledge/contracts';
import { knowledgeFixtures } from '../knowledge/fixtures';
import { generateWorkflow } from '../intelligence/generation';
import { compileAuthoringGraph } from '../authoring/compiler';
import { executeScopedGraph } from '../authoring/scoped-executor';
import { bind } from '../native/model';
import { migrateProcess, linearProcess, applyProcessCommand, processGraphIssues, processV2Schema } from './model';
import { processDocumentSchema, validateProcess } from '../knowledge/process';
import { screenPoint, canvasHandlePoint } from '../graph-editor/contracts';

describe('visual process compatibility and editor commands', () => {
  for (const fixture of knowledgeFixtures())
    it(`migrates, compiles and executes ${fixture.name} without changing results`, async () => {
      const migrated = migrateProcess(fixture.process);
      expect(linearProcess(migrated)).toEqual(fixture.process);
      expect(processDocumentSchema.parse(migrated)).toEqual(migrated);
      expect(validateProcess(migrated)).toEqual([]);
      const old = await generateWorkflow(fixture.name, fixture.process, { artifactId: 'p', revisionId: 'v1' });
      const next = await generateWorkflow(fixture.name, migrated, { artifactId: 'p', revisionId: 'v2' });
      expect(next.flow.nodes).toEqual(old.flow.nodes);
      expect(next.flow.edges).toEqual(old.flow.edges);
      expect(next.manifest.generator).toBe('visual-linear-process@2');
      const events = [];
      for await (const event of executeScopedGraph(
        compileAuthoringGraph(next.flow),
        next.flow.defaultInput ?? {},
        'fixture',
        async (node, context) =>
          node.kind === 'trigger'
            ? { value: context.input }
            : { value: bind((node.config.operation as any).value, context) },
      ))
        events.push(event);
      expect((events.at(-1) as any).output.result).toBe(fixture.expected);
    });
  it('preserves expression text, evidence, stable IDs and source content while moving', () => {
    const source = knowledgeFixtures()[0].process;
    source.steps[0].evidence = [{ kind: 'inference', taskId: 'task', explanation: 'Existing evidence' }];
    const migrated = migrateProcess(source),
      before = structuredClone(migrated);
    const moved = applyProcessCommand(migrated, { type: 'move', positions: { calculate: { x: 700, y: -300 } } });
    expect(migrated).toEqual(before);
    expect(moved.graph).toEqual(before.graph);
    expect(moved.presentation.positions.calculate).toEqual({ x: 700, y: -300 });
    expect(linearProcess(moved)).toEqual(source);
  });
  it('compiles by graph order rather than card positions or array order', () => {
    const migrated = migrateProcess(knowledgeFixtures()[0].process);
    migrated.graph.elements.reverse();
    migrated.presentation.positions.calculate = { x: 999, y: 999 };
    expect(linearProcess(migrated)).toEqual(knowledgeFixtures()[0].process);
  });
  it('retains unresolved human and agent intent as drafts and refuses execution', async () => {
    for (const performer of ['human', 'agent', 'system'] as const) {
      const draft = migrateProcess(knowledgeFixtures()[0].process);
      const activity = draft.graph.elements.find((n) => n.id === 'calculate')!;
      if (activity.kind === 'activity')
        activity.binding = { kind: 'requirement', performer, capability: 'Review application' };
      expect(processV2Schema.safeParse(draft).success).toBe(true);
      expect(processGraphIssues(draft)).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'missing_capability' })]),
      );
      await expect(generateWorkflow('Unresolved', draft, { artifactId: 'p', revisionId: 'r' })).rejects.toThrow(
        'needs an executable binding',
      );
    }
  });
  it('inserts an activity on an existing edge without non-JSON optional handles', () => {
    const draft = migrateProcess(knowledgeFixtures()[0].process),
      edge = draft.graph.flows[0];
    let next = applyProcessCommand(draft, {
      type: 'add',
      element: {
        id: 'agent-intent',
        kind: 'activity',
        name: 'Review evidence',
        evidence: [],
        binding: { kind: 'requirement', performer: 'agent', capability: 'Review evidence' },
      },
      position: { x: 100, y: 100 },
    });
    next = applyProcessCommand(next, { type: 'delete', ids: [edge.id] });
    next = applyProcessCommand(next, { type: 'connect', id: edge.id, source: edge.source, target: 'agent-intent' });
    next = applyProcessCommand(next, {
      type: 'connect',
      id: 'after-agent',
      source: 'agent-intent',
      target: edge.target,
    });
    expect(() => canonicalJson(next)).not.toThrow();
    expect(next.graph.flows).toHaveLength(3);
  });
  it('rejects invalid/self/cyclic connections and undeclared branching', () => {
    const draft = migrateProcess(knowledgeFixtures()[0].process),
      start = draft.graph.elements[0];
    expect(() =>
      applyProcessCommand(draft, { type: 'connect', id: 'x', source: 'calculate', target: 'calculate' }),
    ).toThrow();
    expect(() =>
      applyProcessCommand(draft, { type: 'connect', id: 'x', source: 'result', target: 'calculate' }),
    ).toThrow();
    expect(() => applyProcessCommand(draft, { type: 'connect', id: 'x', source: start.id, target: 'result' })).toThrow(
      'one incoming',
    );
    const noEnd = applyProcessCommand(draft, { type: 'delete', ids: ['result'] });
    expect(() =>
      applyProcessCommand(noEnd, { type: 'connect', id: 'x', source: 'calculate', target: start.id }),
    ).toThrow();
  });
  it('deletes associated connections and presentation without losing unrelated content', () => {
    const draft = migrateProcess(knowledgeFixtures()[0].process),
      next = applyProcessCommand(draft, { type: 'delete', ids: ['calculate'] });
    expect(next.graph.elements.some((n) => n.id === 'calculate')).toBe(false);
    expect(next.graph.flows).toEqual([]);
    expect(next.presentation.positions.calculate).toBeUndefined();
    expect(next.purpose).toBe(draft.purpose);
    expect(() => linearProcess(next)).toThrow();
  });
  it('keeps invalid topology visible but rejects duplicate IDs and dangling endpoints', () => {
    const draft = migrateProcess(knowledgeFixtures()[0].process);
    draft.graph.flows = [];
    expect(processV2Schema.safeParse(draft).success).toBe(true);
    expect(processGraphIssues(draft).some((i) => i.code === 'disconnected')).toBe(true);
    draft.graph.elements.push(structuredClone(draft.graph.elements[0]));
    draft.graph.flows.push({ id: 'dangling', source: 'absent', target: 'result' });
    expect(
      processGraphIssues(draft)
        .filter((i) => i.severity === 'error')
        .map((i) => i.code),
    ).toContain('duplicate');
    expect(processGraphIssues(draft).map((i) => i.code)).toContain('endpoint');
  });
  it('rejects invalid geometry and unknown execution fields', () => {
    const draft = migrateProcess(knowledgeFixtures()[0].process);
    draft.presentation.positions.calculate.x = Infinity;
    expect(processV2Schema.safeParse(draft).success).toBe(false);
    expect(
      processV2Schema.safeParse({ ...migrateProcess(knowledgeFixtures()[0].process), executable: true }).success,
    ).toBe(false);
  });
  it('handles a legacy step ID that resembles the synthesized entry without changing it', () => {
    const source = knowledgeFixtures()[0].process;
    source.steps[0].id = 'process-start';
    const migrated = migrateProcess(source);
    expect(migrated.graph.elements[0].id).not.toBe('process-start');
    expect(migrated.graph.elements[1].id).toBe('process-start');
  });
  it('shares workflow geometry and coordinate scaling for process handles', () => {
    expect(canvasHandlePoint({ position: { x: 10, y: 20 }, size: { width: 284, height: 142 } }, 'right')).toEqual({
      x: 294,
      y: 91,
    });
    expect(
      screenPoint({ x: 500, y: 400 }, { left: 0, top: 0, width: 800, height: 600 }, { x: 100, y: 100, zoom: 2 }),
    ).toEqual({ x: 0, y: 0 });
  });
});
