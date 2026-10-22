'use client';
/** Review composition reuses the product's ontology and process renderers in read-only mode. */
import { useRef, useState } from 'react';
import { OntologyEditor } from '@/components/knowledge/ontology-editor';
import { processIcon } from '@/components/processes/process-icons';
import { ProcessRenderer } from '@/components/processes/process-renderer';
import { processEditorAdapter } from '@/lib/processes/editor-adapter';
import type { ProcessDocument } from '@/lib/processes/model';
import type { Ontology } from '@/lib/knowledge/ontology';
import { Table } from '@/components/application/table/table';
import { Tabs } from '@/components/application/tabs/tabs';
import { ControlButton } from '@/components/control/controls';
import type { ProposalChange } from '@/lib/agent/proposal-diff';

export function ProposalChanges({ changes }: { changes: ProposalChange[] }) {
  return (
    <section className="wi-change-list">
      <h3>Changes against the current saved draft</h3>
      {changes.length ? (
        <Table aria-label="Proposed changes">
          <Table.Header>
            <Table.Head>Change</Table.Head>
            <Table.Head>Element</Table.Head>
            <Table.Head>Details</Table.Head>
          </Table.Header>
          <Table.Body items={changes}>
            {(row) => (
              <Table.Row id={row.id}>
                <Table.Cell>{row.change}</Table.Cell>
                <Table.Cell>{row.name}</Table.Cell>
                <Table.Cell>{row.detail}</Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table>
      ) : (
        <p>No semantic element changes found. Review document metadata and evidence in the technical definition.</p>
      )}
    </section>
  );
}
export function OntologyReviewPreview({
  saved,
  proposed,
  applied,
}: {
  saved?: Ontology;
  proposed: Ontology;
  applied?: boolean;
}) {
  const [version, setVersion] = useState('proposed');
  return (
    <section className="wi-domain-preview">
      <Tabs selectedKey={version} onSelectionChange={(key) => setVersion(String(key))}>
        <Tabs.List aria-label="Ontology review version" type="underline">
          <Tabs.Item id="proposed">{applied ? 'Applied ontology snapshot' : 'Proposed ontology'}</Tabs.Item>
          {saved && <Tabs.Item id="saved">Current saved ontology</Tabs.Item>}
        </Tabs.List>
      </Tabs>
      <div className="wi-ontology-preview">
        <OntologyEditor
          key={version}
          value={version === 'saved' && saved ? saved : proposed}
          onChange={() => {}}
          readOnly
          name="Ontology review"
        />
      </div>
    </section>
  );
}
export function ProcessReviewPreview({
  saved,
  proposed,
  applied,
}: {
  saved?: ProcessDocument;
  proposed: ProcessDocument;
  applied?: boolean;
}) {
  const [version, setVersion] = useState('proposed');
  const [zoom, setZoom] = useState(0.65);
  const board = useRef<HTMLDivElement>(null);
  const document = version === 'saved' && saved ? saved : proposed;
  const scene = processEditorAdapter.project(document);
  const nodes = scene.nodes.map((node) => ({
    ...node,
    description: 'Read-only process element',
    icon: processIcon(document.graph.elements.find((element) => element.id === node.id)!),
    color: '#4b586a',
    bg: '#f0f4f8',
  }));
  const noop = () => {};
  return (
    <section className="wi-domain-preview">
      <div className="wi-preview-toolbar">
        <Tabs selectedKey={version} onSelectionChange={(key) => setVersion(String(key))}>
          <Tabs.List aria-label="Process review version" type="underline">
            <Tabs.Item id="proposed">{applied ? 'Applied process snapshot' : 'Proposed process'}</Tabs.Item>
            {saved && <Tabs.Item id="saved">Current saved process</Tabs.Item>}
          </Tabs.List>
        </Tabs>
        <ControlButton aria-label="Zoom out process review" onPress={() => setZoom((v) => Math.max(0.25, v - 0.15))}>
          −
        </ControlButton>
        <ControlButton aria-label="Zoom in process review" onPress={() => setZoom((v) => Math.min(1.5, v + 0.15))}>
          +
        </ControlButton>
      </div>
      <div className="wi-process-preview">
        <ProcessRenderer
          document={document}
          readOnly
          nodes={nodes}
          surfaceProps={{ boardRef: board, viewport: { x: 0, y: 0, zoom }, 'aria-label': 'Read-only proposed process' }}
          laneProps={{
            name: 'Process review',
            selected: null,
            onSelect: noop,
            onAdd: noop,
            onConfigure: noop,
            onResizeStart: noop,
            onResizeKey: noop,
          }}
          nodeProps={() => ({
            actions: [],
            edgeSource: null,
            onDelete: noop,
            onFinishEdge: noop,
            onInvokeAction: noop,
            onOpenInspector: noop,
            onPointerDown: noop,
            onSelect: noop,
            onStartEdge: noop,
            pulseNodeIds: new Set(),
            selected: false,
            status: 'idle',
          })}
          edgeProps={{
            connectionPreview: null,
            selectedNodeId: null,
            selectedEdgeId: null,
            reconnectingEdgeId: null,
            onCycleEdgeHandles: noop,
            onDeleteEdge: noop,
            onSelectEdge: noop,
            onStartEndpointReconnect: noop,
          }}
        />
      </div>
    </section>
  );
}
