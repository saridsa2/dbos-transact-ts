import { describe, it, expect } from 'vitest';
import { executeEditorCommand } from './adapter';
import { workflowEditorAdapter, type WorkflowDiagram } from '../flows/editor-adapter';
import { processEditorAdapter } from '../processes/editor-adapter';
import { migrateProcess } from '../processes/model';
import { processPool } from '../processes/lanes';
import { knowledgeFixtures } from '../knowledge/fixtures';
const workflow = (): WorkflowDiagram => ({
  nodes: [
    { id: 'start', kind: 'trigger', name: 'Start', position: { x: 0, y: 0 }, config: {} },
    { id: 'a', kind: 'approval', name: 'Approve', position: { x: 400, y: 0 }, config: { prompt: 'Review' } },
    { id: 'end', kind: 'output', name: 'End', position: { x: 800, y: 0 }, config: {} },
  ],
  edges: [
    { id: 'first', source: 'start', target: 'a', condition: 'always' },
    {
      id: 'last',
      source: 'a',
      target: 'end',
      condition: 'true',
      sourcePort: 'value',
      targetPort: 'input',
      sourceHandle: 'bottom',
      targetHandle: 'top',
    },
  ],
});
const process = () => migrateProcess(knowledgeFixtures()[0].process);
describe('domain editor adapters', () => {
  it('projects independent scene semantics and preserves workflow geometry and approval branches', () => {
    const w = workflow(),
      scene = workflowEditorAdapter.project(w);
    expect(scene.nodes[0].size).toEqual({ width: 270, height: 126 });
    expect(scene.edges[1].branch?.label).toBe('approved');
    expect(workflowEditorAdapter.routing).toBe('rope');
    expect(processEditorAdapter.routing).toBe('elbow');
    expect(processEditorAdapter.project(process()).nodes[0].kind).toBe('process-start');
  });
  it('preserves executable workflow config, ports and edge conditions across geometry edits', () => {
    const w = workflow(),
      before = structuredClone(w);
    const moved = executeEditorCommand(workflowEditorAdapter, w, {
      type: 'move',
      positions: { a: { x: 417.6, y: 89.1 } },
    });
    expect(moved.nodes[1].position).toEqual({ x: 418, y: 89 });
    expect(moved.nodes[1].config).toEqual(w.nodes[1].config);
    const arranged = executeEditorCommand(workflowEditorAdapter, moved, { type: 'arrange' });
    expect(arranged.edges).toEqual(w.edges);
    expect(w).toEqual(before);
    const route = executeEditorCommand(workflowEditorAdapter, arranged, { type: 'reroute', id: 'last' });
    expect(route.edges[1]).toMatchObject({
      sourceHandle: 'left',
      targetHandle: 'right',
      condition: 'true',
      sourcePort: 'value',
    });
  });
  it('reconnects without dropping workflow branch and port metadata', () => {
    const w = workflow();
    const next = executeEditorCommand(workflowEditorAdapter, w, {
      type: 'reconnect',
      id: 'last',
      endpoint: 'source',
      nodeId: 'start',
      handle: 'right',
    });
    expect(next.edges[1]).toMatchObject({
      source: 'start',
      target: 'end',
      condition: 'true',
      sourcePort: 'value',
      targetPort: 'input',
    });
    expect(
      executeEditorCommand(workflowEditorAdapter, w, {
        type: 'reconnect',
        id: 'last',
        endpoint: 'source',
        nodeId: 'end',
        handle: 'left',
      }),
    ).toBe(w);
  });
  it('preserves workflow duplicate-connection behavior and deletes only selected graph content', () => {
    const w = workflow();
    expect(
      executeEditorCommand(workflowEditorAdapter, w, {
        type: 'connect',
        id: 'duplicate',
        source: 'start',
        target: 'a',
      }),
    ).toBe(w);
    expect(executeEditorCommand(workflowEditorAdapter, w, { type: 'delete', ids: ['a'] })).toEqual({
      nodes: [w.nodes[0], w.nodes[2]],
      edges: [],
    });
    expect(() =>
      executeEditorCommand(workflowEditorAdapter, w, { type: 'connect', id: 'x', source: 'start', target: 'missing' }),
    ).toThrow('Node not found');
  });
  it('uses process connection constraints rather than workflow graph behavior', () => {
    const p = process(),
      start = p.graph.elements.find((n) => n.kind === 'start')!,
      end = p.graph.elements.find((n) => n.kind === 'end')!;
    expect(() =>
      executeEditorCommand(processEditorAdapter, p, { type: 'connect', id: 'extra', source: start.id, target: end.id }),
    ).toThrow();
    expect(() =>
      executeEditorCommand(processEditorAdapter, p, { type: 'connect', id: 'bad', source: end.id, target: start.id }),
    ).toThrow();
    expect(() =>
      executeEditorCommand(workflowEditorAdapter, workflow(), {
        type: 'connect',
        id: 'extra',
        source: 'start',
        target: 'end',
      }),
    ).not.toThrow();
  });
  it('makes lanes structured containers rather than draggable graph nodes', () => {
    const p = executeEditorCommand(processEditorAdapter, process(), {
      type: 'lanes',
      lanes: [
        { id: 'ops', name: 'Operations' },
        { id: 'risk', name: 'Risk' },
      ],
    });
    expect(processEditorAdapter.containers).toBe('structured');
    expect(processEditorAdapter.project(p).nodes.some((n) => n.id === 'ops')).toBe(false);
    expect(() =>
      executeEditorCommand(processEditorAdapter, p, { type: 'move', positions: { ops: { x: 100, y: 100 } } }),
    ).toThrow('Element not found');
    const assigned = executeEditorCommand(processEditorAdapter, p, {
      type: 'assign-lane',
      ids: ['calculate'],
      laneId: 'ops',
    });
    const resized = executeEditorCommand(processEditorAdapter, assigned, {
      type: 'resize-lane',
      id: 'ops',
      height: 480,
    });
    expect(processPool(resized)?.rows[0].height).toBe(480);
    expect(resized.graph.flows).toEqual(p.graph.flows);
    expect(resized.graph.elements.find((n) => n.id === 'calculate')?.laneId).toBe('ops');
  });
  it('guards read-only inspection for both common and domain commands', () => {
    const w = workflow(),
      p = process(),
      before = structuredClone(p);
    expect(() => executeEditorCommand(workflowEditorAdapter, w, { type: 'delete', ids: ['a'] }, true)).toThrow(
      'read-only',
    );
    expect(() => executeEditorCommand(processEditorAdapter, p, { type: 'lanes', lanes: [] }, true)).toThrow(
      'read-only',
    );
    expect(p).toEqual(before);
  });
  it('resolves configuration targets by domain and reports dangling workflow references', () => {
    expect(workflowEditorAdapter.configuration(workflow(), 'a')).toEqual({ id: 'a', kind: 'approval' });
    expect(processEditorAdapter.configuration(process(), 'calculate')?.kind).toBe('activity');
    expect(processEditorAdapter.configuration(process(), 'missing')).toBeNull();
    const w = workflow();
    w.edges[0].target = 'missing';
    expect(workflowEditorAdapter.validate(w)[0].path).toBe('edges.first');
  });
});
