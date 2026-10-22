import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { ProcessRenderer } from '../../components/processes/process-renderer';
import { WorkflowRenderer } from '../../components/flows/workflow-renderer';
import { knowledgeFixtures } from '../knowledge/fixtures';
import { migrateProcess } from './model';
import { changeProcessLanes, assignProcessLane } from './lanes';
import { processEditorAdapter } from './editor-adapter';
import type { DiagramNodeProps, DiagramEdgeProps } from '../../components/graph-editor/renderer-props';
const noop = () => {};
const nodeProps = (): DiagramNodeProps => ({
  selected: false,
  status: 'idle',
  actions: [],
  pulseNodeIds: new Set(),
  edgeSource: null,
  onInvokeAction: noop,
  onDelete: noop,
  onOpenInspector: noop,
  onSelect: noop,
  onStartEdge: noop,
  onFinishEdge: noop,
  onPointerDown: noop,
});
const edges: DiagramEdgeProps = {
  connectionPreview: null,
  selectedNodeId: null,
  selectedEdgeId: null,
  reconnectingEdgeId: null,
  onSelectEdge: noop,
  onDeleteEdge: noop,
  onCycleEdgeHandles: noop,
  onStartEndpointReconnect: noop,
};
const surfaceProps = { boardRef: { current: null }, viewport: { x: 0, y: 0, zoom: 1 } };
describe('domain render trees', () => {
  it('nests process activities under their actual lane content, with global connections outside the pool', () => {
    const document = assignProcessLane(
      changeProcessLanes(migrateProcess(knowledgeFixtures()[0].process), [
        { id: 'operations', name: 'Operations' },
        { id: 'risk', name: 'Risk' },
      ]),
      ['calculate'],
      'risk',
    );
    const nodes = processEditorAdapter
      .project(document)
      .nodes.map((n) => ({ ...n, description: '', icon: () => null, color: '#444', bg: '#fff' }));
    const html = renderToStaticMarkup(
      createElement(ProcessRenderer, {
        document,
        nodes,
        surfaceProps,
        nodeProps,
        edgeProps: edges,
        readOnly: true,
        laneProps: {
          name: 'QA',
          selected: null,
          onSelect: noop,
          onAdd: noop,
          onConfigure: noop,
          onResizeStart: noop,
          onResizeKey: noop,
        },
      }),
    );
    const dom = new JSDOM(html).window.document,
      card = dom.querySelector('[data-node-id="calculate"]')!;
    expect(card.closest('[data-process-lane-content]')?.getAttribute('data-process-lane-content')).toBe('risk');
    expect(
      dom.querySelector('[data-process-lane-content="operations"]')?.querySelector('[data-board-node]'),
    ).toBeNull();
    expect(dom.querySelector('.edge-layer')?.closest('.process-pool')).toBeNull();
    expect(dom.querySelector('[data-renderer="process"]')).not.toBeNull();
    expect(dom.querySelector('.board-world')).toBeNull();
    expect(dom.querySelector('.process-scroll-surface > .process-sheet-extent > .process-sheet')).not.toBeNull();
    expect((dom.querySelector('.process-pool') as HTMLElement).style.left).toBe('0px');
    expect((dom.querySelector('.process-pool') as HTMLElement).style.top).toBe('0px');
    expect(dom.querySelector('.process-lane-resizer')).toBeNull();
  });
  it('keeps workflow nodes on a free world layer without process regions', () => {
    const document = {
      nodes: [{ id: 'trigger', kind: 'trigger' as const, name: 'Start', position: { x: 0, y: 0 }, config: {} }],
      edges: [],
    };
    const html = renderToStaticMarkup(
      createElement(WorkflowRenderer, {
        document,
        surfaceProps,
        nodeProps,
        edgeProps: edges,
        decorateNode: (n) => ({ ...n, description: '', icon: () => null, color: '#444', bg: '#fff' }),
      }),
    );
    const dom = new JSDOM(html).window.document;
    expect(dom.querySelector('[data-node-id="trigger"]')?.closest('.node-layer')).not.toBeNull();
    expect(dom.querySelector('[data-process-lane-content]')).toBeNull();
    expect(dom.querySelector('[data-renderer="workflow"]')).not.toBeNull();
  });
});
