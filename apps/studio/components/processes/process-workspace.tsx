'use client';
import { normalizeProcessLanes, processPool, processElementSize } from '@/lib/processes/lanes';
import { processIcon } from './process-icons';
import { processV2Schema } from '@/lib/processes/model';
import { defaultProcessOperation, processOperations, type ProcessOperationKind } from '@/lib/processes/defaults';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ProcessRenderer } from './process-renderer';
import { processCanvasPool } from '@/lib/processes/canvas-layout';
import { executeEditorCommand } from '@/lib/graph-editor/adapter';
import { processEditorAdapter, type ProcessEditorCommand } from '@/lib/processes/editor-adapter';
import { useProcessViewport } from './use-process-viewport';
import { canvasHandlePoint, type CanvasNode, type HandleSide, type EdgeSource } from '@/lib/graph-editor/contracts';
import { FullscreenWorkbench } from '@/components/workspace/fullscreen-workbench';
import { ControlButton, ControlModal, ControlSelect } from '@/components/control/controls';
import { useUnsavedChanges } from '@/components/control/unsaved-changes';
import { useControl, controlRequest } from '@/components/control/access';
import { processDocumentSchema } from '@/lib/knowledge/process';
import { canonicalJson, type KnowledgeArtifact, type KnowledgeRevision } from '@/lib/knowledge/contracts';
import { migrateProcess, type ProcessDocument, type ProcessElement } from '@/lib/processes/model';
import { Plus, Minus, SettingsIcon, LayersIcon, WorkflowIcon, RotateLeft, ExpandIcon, X } from '@/components/fa-icons';
import { RedoIcon } from '@/components/fa-icons';
import { ProcessNodeDialog } from './process-node-dialog';
import { NodeConfigDialog } from '@/components/flows/node-config-dialog';
import { ProcessCompilation } from './process-compilation';
import { useProcessRun } from './use-process-run';
import { ProcessSettings } from './process-settings';
import { BpmnImportDialog } from './bpmn-import-dialog';

type Detail = { artifact: KnowledgeArtifact; revision: KnowledgeRevision };
type Draft = { name: string; document: ProcessDocument };
type Reconnect = { id: string; endpoint: 'source' | 'target' };
const fingerprint = (draft: Draft) => canonicalJson(JSON.parse(JSON.stringify(draft)));
export function ProcessWorkspace() {
  const { session } = useControl(),
    search = useSearchParams();
  return <ProcessHost key={`${session.workspace?.id}:${search.get('id')}:${search.get('revision')}`} />;
}
function ProcessHost() {
  const router = useRouter(),
    search = useSearchParams(),
    { session } = useControl(),
    id = search.get('id'),
    revision = search.get('revision');
  const [detail, setDetail] = useState<Detail | null>(null),
    [draft, setDraft] = useState<Draft | null>(null),
    [saved, setSaved] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(''),
    [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(search.get('element')),
    [selectedEdge, setSelectedEdge] = useState<string | null>(null),
    [inspector, setInspector] = useState<string | null>(null),
    [settings, setSettings] = useState(false),
    [bpmnImport, setBpmnImport] = useState(false),
    [settingsSection, setSettingsSection] = useState('general'),
    [selectedLane, setSelectedLane] = useState<string | null>(null),
    [palette, setPalette] = useState(false),
    [issuesOpen, setIssuesOpen] = useState(false),
    [compilation, setCompilation] = useState<'preview' | 'history' | null>(null);
  const runId = search.get('run'),
    run = useProcessRun(runId, detail?.revision.id);
  const [edgeSource, setEdgeSource] = useState<EdgeSource>(null),
    [reconnect, setReconnect] = useState<Reconnect | null>(null),
    [preview, setPreview] = useState<{ source: { x: number; y: number }; target: { x: number; y: number } } | null>(
      null,
    );
  const [past, setPast] = useState<Draft[]>([]),
    [future, setFuture] = useState<Draft[]>([]);
  const drag = useRef<{ id: string; dx: number; dy: number; before: Draft } | null>(null);
  const laneDrag = useRef<{ id: string | null; height: number; y: number; before: Draft } | null>(null),
    fitted = useRef(false);
  const sheetOrigin = draft ? processCanvasPool(draft.document) : { x: 0, y: 0 };
  const { boardRef, viewport, screenToWorld, zoomBy, fit: resetViewport } = useProcessViewport(sheetOrigin);
  const dirty = !!draft && fingerprint(draft) !== saved,
    guard = useUnsavedChanges(dirty);
  const readOnly = session.workspace?.role === 'viewer' || !!revision || !!runId,
    manager = ['owner', 'admin'].includes(session.workspace?.role ?? '');
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        let artifactId = id;
        if (!artifactId && revision)
          artifactId = (await controlRequest(`/api/knowledge/revisions/${encodeURIComponent(revision)}`)).artifact.id;
        if (!artifactId) throw new Error('Choose a process from Knowledge.');
        const data = await controlRequest(
          `/api/knowledge/artifacts/${encodeURIComponent(artifactId)}${revision ? `?revision=${encodeURIComponent(revision)}` : ''}`,
        );
        if (data.artifact.kind !== 'process') throw new Error('This artifact is not a process.');
        const document = normalizeProcessLanes(migrateProcess(processDocumentSchema.parse(data.revision.content)));
        if (alive) {
          const next = { name: data.artifact.name, document };
          setDetail(data);
          setDraft(next);
          setSaved(fingerprint(next));
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, revision]);
  const commit = (next: Draft) => {
    if (readOnly || busy || !draft) return;
    if (fingerprint(next) === fingerprint(draft)) return;
    setPast((p) => [...p.slice(-99), draft]);
    setFuture([]);
    setDraft(next);
    setError('');
  };
  const command = (cmd: ProcessEditorCommand) => {
    if (!draft || readOnly || busy) return;
    try {
      commit({
        ...draft,
        document: executeEditorCommand(processEditorAdapter, draft.document, cmd, readOnly || !!busy),
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const history = (direction: 'undo' | 'redo') => {
    if (!draft || readOnly || busy) return;
    const source = direction === 'undo' ? past : future;
    if (!source.length) return;
    const next = source[source.length - 1];
    if (direction === 'undo') {
      setPast((p) => p.slice(0, -1));
      setFuture((p) => [...p, draft]);
    } else {
      setFuture((p) => p.slice(0, -1));
      setPast((p) => [...p, draft]);
    }
    setDraft(next);
  };
  async function action(label: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function save() {
    if (!draft || !detail || readOnly) return;
    const submitted = structuredClone(draft);
    await action('Saving', async () => {
      const data = await controlRequest(
        `/api/knowledge/artifacts/${detail.artifact.id}`,
        {
          name: submitted.name,
          kind: 'process',
          content: submitted.document,
          expectedVersion: detail.artifact.editVersion,
        },
        'PUT',
      );
      setDetail(data);
      setSaved(fingerprint(submitted));
    });
  }
  async function lifecycle(kind: 'review' | 'publish') {
    if (!detail) return;
    await action(kind === 'review' ? 'Reviewing' : 'Publishing', async () => {
      const data = await controlRequest(`/api/knowledge/artifacts/${detail.artifact.id}/${kind}`, {
        revisionId: detail.revision.id,
        expectedVersion: detail.artifact.editVersion,
      });
      setDetail(data);
    });
  }
  const nodes: CanvasNode[] =
    draft?.document.graph.elements.map((element) => {
      const required = element.kind === 'activity' && element.binding.kind === 'requirement' ? element.binding : null;
      return {
        id: element.id,
        name: element.name,
        kind: `process-${element.kind}`,
        description:
          element.kind === 'start'
            ? 'Receive process input'
            : element.kind === 'end'
              ? 'Return the process result'
              : element.kind === 'decision'
                ? 'Route on a typed condition'
                : element.kind === 'merge'
                  ? 'Combine alternative routes'
                  : element.binding.kind === 'agent'
                    ? `Agent activity · ${element.binding.definition.goal}`
                    : element.binding.kind === 'operation'
                      ? (processOperations[element.binding.operation.kind as ProcessOperationKind] ??
                        element.binding.operation.kind)
                      : required
                        ? `${required.performer === 'agent' ? 'Agent' : required.performer === 'human' ? 'Human' : 'System'} activity · ${required.capability}`
                        : 'Construct a typed value',
        position: draft.document.presentation.positions[element.id] ?? { x: 0, y: 0 },
        size: processElementSize(element),
        icon: processIcon(element),
        color: '#4b586a',
        bg: '#f0f4f8',
        chips: [
          ...(required ? [required.performer] : []),
          ...(element.laneId
            ? [draft.document.lanes?.find((l) => l.id === element.laneId)?.name ?? element.laneId]
            : []),
        ],
        readiness: required ? 'Binding required' : undefined,
      };
    }) ?? [];
  const edges = draft ? processEditorAdapter.project(draft.document).edges : [],
    issues = draft ? processEditorAdapter.validate(draft.document) : [];
  const fitDocument = (_document: ProcessDocument | null) => resetViewport();
  const fit = () => fitDocument(draft?.document ?? null);
  useEffect(() => {
    if (!loading && draft && !fitted.current) {
      fitted.current = true;
      requestAnimationFrame(fit);
    }
  }, [loading]);
  const editLanes = () => {
    setSettingsSection('lanes');
    setSettings(true);
  };
  const nodeById = (id: string) => nodes.find((n) => n.id === id);
  const connect = (
    source: string,
    target: string,
    sourceHandle: HandleSide = 'right',
    targetHandle: HandleSide = 'left',
    edgeId = crypto.randomUUID(),
  ) => {
    command({ type: 'connect', source, target, sourceHandle, targetHandle, id: edgeId });
    setEdgeSource(null);
    setPreview(null);
    setReconnect(null);
  };
  const add = (
    kind: 'construct' | 'system' | 'human' | 'agent' | 'end' | 'start' | 'decision' | 'merge' | ProcessOperationKind,
  ) => {
    if (!draft) return;
    const nextId = crypto.randomUUID();
    const element: ProcessElement =
      kind === 'decision'
        ? {
            id: nextId,
            name: 'Decision',
            kind: 'decision',
            evidence: [],
            operator: 'truthy',
            left: { mode: 'fixed', value: true },
            right: { mode: 'fixed', value: null },
          }
        : kind === 'merge'
          ? { id: nextId, name: 'Merge routes', kind: 'merge', evidence: [] }
          : kind === 'start'
            ? { id: nextId, name: 'Start', kind: 'start', evidence: [] }
            : kind === 'end'
              ? {
                  id: nextId,
                  name: 'Return result',
                  kind: 'end',
                  value: { mode: 'expression', expression: '$input.variables' },
                  evidence: [],
                }
              : {
                  id: nextId,
                  name:
                    kind in processOperations
                      ? processOperations[kind as ProcessOperationKind]
                      : kind === 'construct'
                        ? 'Construct data'
                        : kind === 'agent'
                          ? 'Agent activity'
                          : kind === 'human'
                            ? 'Human activity'
                            : 'System activity',
                  kind: 'activity',
                  evidence: [],
                  binding:
                    kind in processOperations
                      ? {
                          kind: 'operation',
                          operation: defaultProcessOperation(kind as ProcessOperationKind),
                          parameters: {},
                        }
                      : kind === 'construct'
                        ? { kind: 'construct', value: { mode: 'fixed', value: null } }
                        : {
                            kind: 'requirement',
                            performer: kind as 'system' | 'human' | 'agent',
                            capability: 'Describe the required business action.',
                          },
                };
    try {
      const pool = processPool(draft.document),
        lane =
          selectedLane === null
            ? selected
              ? (draft.document.graph.elements.find((n) => n.id === selected)?.laneId ?? null)
              : null
            : selectedLane || null;
      if (lane) element.laneId = lane;
      const row = pool?.rows.find((r) => r.id === lane) ?? pool?.rows[0];
      if (selectedLane !== null && !lane) delete element.laneId;
      const members = draft.document.graph.elements.filter((n) => (n.laneId ?? null) === (element.laneId ?? null));
      const position =
        pool && row
          ? {
              x: Math.max(
                pool.contentLeft + 36,
                ...members.map(
                  (n) =>
                    (draft.document.presentation.positions[n.id]?.x ?? pool.contentLeft) +
                    processElementSize(n).width +
                    72,
                ),
              ),
              y: row.top + (row.height - processElementSize(element).height) / 2,
            }
          : { x: 0, y: 0 };
      let document = executeEditorCommand(processEditorAdapter, draft.document, { type: 'add', element, position });
      const node = selected ? draft.document.graph.elements.find((n) => n.id === selected) : null;
      const edge = selectedEdge
        ? edges.find((e) => e.id === selectedEdge)
        : node?.kind === 'end'
          ? edges.find((e) => e.target === selected)
          : edges.find((e) => e.source === selected);
      if (edge && kind !== 'start' && kind !== 'end') {
        const before = nodeById(edge.source)!,
          after = nodeById(edge.target)!;
        document.presentation.positions[nextId] = {
          x: (before.position.x + after.position.x) / 2,
          y: (before.position.y + after.position.y) / 2 + 180,
        };
        document = executeEditorCommand(processEditorAdapter, document, { type: 'delete', ids: [edge.id] });
        document = executeEditorCommand(processEditorAdapter, document, {
          type: 'connect',
          id: edge.id,
          source: edge.source,
          target: nextId,
          sourceHandle: edge.sourceHandle,
        });
        document = executeEditorCommand(processEditorAdapter, document, {
          type: 'connect',
          id: crypto.randomUUID(),
          source: nextId,
          target: edge.target,
          targetHandle: edge.targetHandle,
        });
      }
      document = normalizeProcessLanes(document);
      commit({ ...draft, document });
      setSelected(nextId);
      setSelectedEdge(null);
      setPalette(false);
      setInspector(nextId);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const deleteSelected = (elementId = selected) => {
    if (!elementId && !selectedEdge) return;
    command({ type: 'delete', ids: [elementId ?? selectedEdge!] });
    setSelected(null);
    setSelectedEdge(null);
    setInspector(null);
  };
  const reroute = (edgeId: string) => command({ type: 'reroute', id: edgeId });
  const onMove: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (laneDrag.current && !readOnly && !busy) {
      const drag = laneDrag.current,
        point = screenToWorld(e.clientX, e.clientY);
      setDraft({
        ...drag.before,
        document: executeEditorCommand(
          processEditorAdapter,
          drag.before.document,
          { type: 'resize-lane', id: drag.id, height: drag.height + point.y - drag.y },
          readOnly || !!busy,
        ),
      });
      return;
    }
    if (drag.current && !readOnly && !busy && draft) {
      const point = screenToWorld(e.clientX, e.clientY);
      try {
        setDraft({
          ...draft,
          document: executeEditorCommand(
            processEditorAdapter,
            (() => {
              const pool = processCanvasPool(draft.document),
                last = pool.rows.at(-1)!;
              const node = nodeById(drag.current!.id)!;
              const bottom = point.y - drag.current!.dy + node.size.height + 36;
              return pool.explicit && bottom > last.top + last.height
                ? executeEditorCommand(processEditorAdapter, draft.document, {
                    type: 'resize-lane',
                    id: last.id,
                    height: Math.min(3000, bottom - last.top),
                  })
                : draft.document;
            })(),
            {
              type: 'move',
              positions: {
                [drag.current.id]: {
                  x: Math.round(point.x - drag.current.dx),
                  y: Math.round(point.y - drag.current.dy),
                },
              },
            },
          ),
        });
      } catch {}
    }
    if (edgeSource) {
      const source = nodeById(edgeSource.nodeId);
      if (source)
        setPreview({
          source: canvasHandlePoint(source, edgeSource.handle),
          target: screenToWorld(e.clientX, e.clientY),
        });
    }
  };
  const onUp: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (laneDrag.current && draft) {
      if (fingerprint(laneDrag.current.before) !== fingerprint(draft)) {
        const before = laneDrag.current.before;
        setPast((p) => [...p.slice(-99), before]);
        setFuture([]);
      }
      laneDrag.current = null;
    }
    if (drag.current && draft) {
      if (fingerprint(drag.current.before) !== fingerprint(draft)) {
        const before = drag.current.before;
        setPast((p) => [...p.slice(-99), before]);
        setFuture([]);
      }
      drag.current = null;
    }
    if (reconnect) {
      const edge = edges.find((item) => item.id === reconnect.id);
      const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-node-id]') as HTMLElement | null;
      if (edge && hit?.dataset.nodeId) {
        const node = nodeById(hit.dataset.nodeId)!;
        const point = screenToWorld(e.clientX, e.clientY),
          sides: HandleSide[] = ['top', 'right', 'bottom', 'left'];
        const side = sides.sort((a, b) => {
          const pa = canvasHandlePoint(node, a),
            pb = canvasHandlePoint(node, b);
          return Math.hypot(point.x - pa.x, point.y - pa.y) - Math.hypot(point.x - pb.x, point.y - pb.y);
        })[0];
        command({ type: 'reconnect', id: edge.id, endpoint: reconnect.endpoint, nodeId: node.id, handle: side });
      }
      setReconnect(null);
      setPreview(null);
    }
  };
  const inspectElement = draft?.document.graph.elements.find((n) => n.id === inspector);
  if (loading) return <main className="cp-gate">Loading process…</main>;
  if (!draft || !detail)
    return (
      <main className="cp-gate">
        <p role="alert">{error || 'Process not found.'}</p>
        <ControlButton onPress={() => router.push('/knowledge?view=process')}>Back to processes</ControlButton>
      </main>
    );
  return (
    <FullscreenWorkbench
      title={draft.name}
      description={`${revision ? `Process revision ${detail.revision.id.slice(0, 8)}` : `Process · r${detail.artifact.editVersion}`} · ${dirty ? 'Unsaved changes' : detail.revision.reviewed ? 'Reviewed' : 'Saved draft'}${readOnly ? ' · Read only' : ''}`}
      backHref="/knowledge?view=process"
      onBack={() => guard(() => router.push('/knowledge?view=process'))}
      actions={
        <>
          <ControlButton onPress={() => setCompilation('history')}>Implementations</ControlButton>
          {runId && (
            <ControlButton onPress={() => guard(() => router.push(`/processes?id=${detail.artifact.id}`))}>
              Return to design
            </ControlButton>
          )}
          <ControlButton
            iconLeading={SettingsIcon}
            onPress={() => {
              setSettingsSection('general');
              setSettings(true);
            }}
          >
            Settings
          </ControlButton>
          {!readOnly && (
            <>
              <ControlButton disabled={!!busy} onPress={() => setBpmnImport(true)}>
                Import BPMN
              </ControlButton>
              <ControlButton
                className="cp-primary"
                disabled={!dirty || !!busy || issues.some((i) => i.severity === 'error')}
                onPress={() => void save()}
              >
                {busy === 'Saving' ? 'Saving…' : 'Save revision'}
              </ControlButton>
              <ControlButton
                disabled={dirty || !!busy || detail.revision.reviewed || issues.length > 0}
                onPress={() => void lifecycle('review')}
              >
                Mark reviewed
              </ControlButton>
              {manager && (
                <ControlButton
                  disabled={
                    dirty ||
                    !!busy ||
                    !detail.revision.reviewed ||
                    detail.artifact.publishedRevisionId === detail.revision.id
                  }
                  onPress={() => void lifecycle('publish')}
                >
                  Publish
                </ControlButton>
              )}
              <ControlButton
                disabled={dirty || !!busy || !detail.revision.reviewed || issues.length > 0}
                onPress={() => setCompilation('preview')}
              >
                Compile workflow
              </ControlButton>
            </>
          )}
        </>
      }
      status={
        error || run.error ? (
          <p role="alert" className="cp-error process-error">
            {error || run.error}
          </p>
        ) : undefined
      }
    >
      <div
        className="agent42-shell editor-shell process-canvas"
        onKeyDown={(e) => {
          if ((e.target as HTMLElement).closest('input,textarea,select,[contenteditable=true],[role=dialog]')) return;
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            history(e.shiftKey ? 'redo' : 'undo');
          }
          if (e.key === 'Escape') {
            setEdgeSource(null);
            setPreview(null);
            setSelected(null);
            setSelectedEdge(null);
          }
          if ((e.key === 'Delete' || e.key === 'Backspace') && !inspector && !palette && !readOnly) {
            e.preventDefault();
            deleteSelected();
          }
        }}
      >
        <section className="stage">
          <ProcessRenderer
            surfaceProps={{
              className: 'board',
              boardRef: boardRef,
              viewport: viewport,
              'aria-label': 'Process canvas',
              tabIndex: 0,
              'data-readonly': readOnly ? 'true' : 'false',
              onContextMenu: (e) => {
                e.preventDefault();
                if (!readOnly && !busy) setPalette(true);
              },
              onPointerDown: (e) => {
                if (
                  e.button !== 0 ||
                  (e.target as HTMLElement).closest(
                    '[data-board-node],[data-process-lane-control],button,input,textarea,select',
                  )
                )
                  return;
                setSelected(null);
                setSelectedEdge(null);
              },
              onPointerMove: onMove,
              onPointerUp: onUp,
              onPointerCancel: () => {
                if (laneDrag.current) setDraft(laneDrag.current.before);
                laneDrag.current = null;
                if (drag.current) setDraft(drag.current.before);
                drag.current = null;
                setReconnect(null);
                setPreview(null);
              },
            }}
            laneProps={{
              name: draft.name,
              selected: selectedLane,
              onSelect: (lane) => {
                setSelectedLane(lane ?? '');
                setSelected(null);
                setSelectedEdge(null);
              },
              onAdd: (lane) => {
                setSelectedLane(lane ?? '');
                setSelected(null);
                setSelectedEdge(null);
                setPalette(true);
              },
              onConfigure: editLanes,
              onResizeStart: (row, e) => {
                if (readOnly || busy || e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                laneDrag.current = {
                  id: row.id,
                  height: row.height,
                  y: screenToWorld(e.clientX, e.clientY).y,
                  before: structuredClone(draft),
                };
              },
              onResizeKey: (row, delta) =>
                commit({
                  ...draft,
                  document: executeEditorCommand(
                    processEditorAdapter,
                    draft.document,
                    { type: 'resize-lane', id: row.id, height: row.height + delta },
                    readOnly || !!busy,
                  ),
                }),
            }}
            nodes={nodes}
            document={draft.document}
            readOnly={readOnly || !!busy}
            edgeProps={{
              connectionPreview: preview,
              selectedNodeId: selected,
              selectedEdgeId: selectedEdge,
              reconnectingEdgeId: reconnect?.id ?? null,
              onSelectEdge: (edge) => {
                setSelectedEdge(edge);
                setSelectedLane(null);
                setSelected(null);
              },
              onDeleteEdge: (edgeId) => {
                command({ type: 'delete', ids: [edgeId] });
                setSelectedEdge(null);
              },
              onCycleEdgeHandles: reroute,
              onStartEndpointReconnect: (e, edgeId, endpoint) => {
                if (readOnly || busy) return;
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                setReconnect({ id: edgeId, endpoint });
              },
            }}
            nodeProps={(id) => {
              const node = nodes.find((node) => node.id === id)!;
              return {
                selected: selected === node.id,
                status: run.statuses.get(node.kind === 'process-start' ? 'trigger' : node.id) ?? 'idle',
                actions: [],
                pulseNodeIds: new Set(),
                edgeSource: edgeSource,
                onInvokeAction: () => {},
                onDelete: () => deleteSelected(node.id),
                onOpenInspector: () =>
                  setInspector(processEditorAdapter.configuration(draft.document, node.id)?.id ?? null),
                onSelect: () => {
                  if (edgeSource && edgeSource.nodeId !== node.id)
                    connect(edgeSource.nodeId, node.id, edgeSource.handle);
                  else {
                    setSelected(node.id);
                    setSelectedLane(null);
                    setSelectedEdge(null);
                  }
                },
                onStartEdge: (nodeId, handle = 'right') => {
                  if (!readOnly && !busy) setEdgeSource({ nodeId, handle });
                },
                onFinishEdge: (target, side) => {
                  if (edgeSource) connect(edgeSource.nodeId, target, edgeSource.handle, side);
                },
                onPointerDown: (e, nodeId) => {
                  if (
                    drag.current ||
                    e.button !== 0 ||
                    readOnly ||
                    busy ||
                    (e.target as HTMLElement).closest('[data-board-nodrag],button,input,textarea,select')
                  )
                    return;
                  e.stopPropagation();
                  boardRef.current?.setPointerCapture(e.pointerId);
                  e.currentTarget.focus();
                  const point = screenToWorld(e.clientX, e.clientY);
                  drag.current = {
                    id: nodeId,
                    dx: point.x - node.position.x,
                    dy: point.y - node.position.y,
                    before: structuredClone(draft),
                  };
                  setSelected(nodeId);
                  setSelectedLane(null);
                  setSelectedEdge(null);
                },
              };
            }}
          />
          <div className="canvas-toolbar process-toolbar">
            {run.record &&
              selected &&
              (() => {
                const completed = run.record.events.findLast(
                  (row) => row.event.type === 'node.completed' && row.event.nodeId === selected,
                )?.event;
                const output =
                  completed && 'output' in completed ? (completed.output as { agentSessionId?: string }) : null;
                return output?.agentSessionId ? (
                  <ControlButton
                    onPress={() =>
                      guard(() => router.push(`/intelligence?session=${encodeURIComponent(output.agentSessionId!)}`))
                    }
                  >
                    Open agent Activity
                  </ControlButton>
                ) : null;
              })()}
            {run.record && <span role="status">Run {run.record.status}</span>}
            {!readOnly && draft.document.lanes?.length ? (
              <ControlSelect
                aria-label="Responsibility lane"
                className="process-lane-assignment"
                value={draft.document.graph.elements.find((n) => n.id === selected)?.laneId ?? ''}
                disabled={!selected || readOnly || !!busy}
                onChange={(e) =>
                  commit({
                    ...draft,
                    document: executeEditorCommand(
                      processEditorAdapter,
                      draft.document,
                      { type: 'assign-lane', ids: [selected!], laneId: e.target.value || null },
                      readOnly || !!busy,
                    ),
                  })
                }
              >
                <option value="">{selected ? 'No lane' : 'Select an activity'}</option>
                {draft.document.lanes.map((lane) => (
                  <option key={lane.id} value={lane.id}>
                    {lane.name}
                  </option>
                ))}
              </ControlSelect>
            ) : null}

            {!runId && (
              <>
                <ControlButton iconLeading={LayersIcon} disabled={readOnly || !!busy} onPress={editLanes}>
                  Lanes
                </ControlButton>
                <ControlButton iconLeading={Plus} disabled={readOnly || !!busy} onPress={() => setPalette(true)}>
                  Add activity
                </ControlButton>
                <ControlButton
                  iconLeading={RotateLeft}
                  aria-label="Undo process edit"
                  disabled={readOnly || !!busy || !past.length}
                  onPress={() => history('undo')}
                />
                <ControlButton
                  iconLeading={RedoIcon}
                  aria-label="Redo process edit"
                  disabled={readOnly || !!busy || !future.length}
                  onPress={() => history('redo')}
                />
                <ControlButton
                  iconLeading={WorkflowIcon}
                  aria-label="Arrange process"
                  disabled={readOnly || !!busy}
                  onPress={() => {
                    const document = executeEditorCommand(
                      processEditorAdapter,
                      draft.document,
                      { type: 'arrange' },
                      readOnly || !!busy,
                    );
                    commit({ ...draft, document });
                    requestAnimationFrame(() => fitDocument(document));
                  }}
                />
              </>
            )}
            <ControlButton onPress={() => setIssuesOpen(true)}>
              {runId
                ? 'Validation'
                : issues.length
                  ? `${issues.length} issue${issues.length === 1 ? '' : 's'}`
                  : 'Ready to compile'}
            </ControlButton>
          </div>
          <div className="zoom-controls">
            <ControlButton aria-label="Zoom in" iconLeading={Plus} onPress={() => zoomBy(0.08)} />
            <ControlButton aria-label="Scroll to process start" iconLeading={ExpandIcon} onPress={fit} />
            <ControlButton aria-label="Zoom out" iconLeading={Minus} onPress={() => zoomBy(-0.08)} />
          </div>
        </section>
      </div>
      {bpmnImport && (
        <BpmnImportDialog
          onClose={() => setBpmnImport(false)}
          onApply={(document, name) => {
            commit({ document, name });
            setSelected(null);
            setBpmnImport(false);
            fitDocument(document);
          }}
        />
      )}
      {compilation && (
        <ProcessCompilation
          artifactId={detail.artifact.id}
          expectedVersion={detail.artifact.editVersion}
          mode={compilation}
          onClose={() => setCompilation(null)}
          navigate={(url) => guard(() => router.push(url))}
        />
      )}
      {palette && (
        <ControlModal label="Add process activity" onClose={() => setPalette(false)}>
          <section className="cp-modal">
            <header className="sp-dialog-header">
              <h2>Add process activity</h2>
              <p>
                {selected || selectedEdge
                  ? 'The activity is inserted on the selected connection where possible.'
                  : 'Add an activity, then connect it in the required sequence.'}
              </p>
            </header>
            <div className="sp-dialog-body process-palette">
              {(
                [
                  'construct',
                  'step',
                  'review',
                  'delay',
                  'receive',
                  'waitEvent',
                  'decision',
                  'merge',
                  'workflow',
                  'foreach',
                  'loop',
                  'parallel',
                  'agent',
                  'start',
                  'end',
                ] as const
              )
                .filter(
                  (kind) =>
                    !(kind === 'start' && draft.document.graph.elements.some((n) => n.kind === 'start')) &&
                    !(kind === 'end' && draft.document.graph.elements.some((n) => n.kind === 'end')),
                )
                .map((kind) => (
                  <ControlButton key={kind} onPress={() => add(kind)}>
                    {kind in processOperations
                      ? processOperations[kind as ProcessOperationKind]
                      : kind === 'decision'
                        ? 'Decision — True / False'
                        : kind === 'merge'
                          ? 'Merge routes'
                          : kind === 'construct'
                            ? 'Construct data'
                            : kind === 'agent'
                              ? 'Agent activity — binding required'
                              : kind === 'start'
                                ? 'Start'
                                : 'End'}
                  </ControlButton>
                ))}
            </div>
            <footer className="cp-actions">
              <ControlButton onPress={() => setPalette(false)}>Cancel</ControlButton>
            </footer>
          </section>
        </ControlModal>
      )}
      {inspectElement &&
        run.record &&
        run.record.graph.nodes.find(
          (n) => n.id === (inspectElement.kind === 'start' ? 'trigger' : inspectElement.id),
        ) && (
          <NodeConfigDialog
            presentation={{ icon: processIcon(inspectElement), label: 'Process activity · execution snapshot' }}
            node={
              run.record.graph.nodes.find(
                (n) => n.id === (inspectElement.kind === 'start' ? 'trigger' : inspectElement.id),
              )!
            }
            flow={run.record.graph}
            readOnly
            runInput={JSON.stringify(run.record.input ?? {})}
            outputs={Object.fromEntries(
              run.record.events
                .filter((row) => row.event.type === 'node.completed')
                .map((row) => [(row.event as any).nodeId, (row.event as any).output]),
            )}
            status={run.statuses.get(inspectElement.kind === 'start' ? 'trigger' : inspectElement.id) ?? 'idle'}
            events={run.record.events.map((row) => row.event)}
            onClose={() => setInspector(null)}
            onApply={() => {}}
            renderLegacy={() => null}
          />
        )}
      {inspectElement && !run.record && (
        <ProcessNodeDialog
          key={inspectElement.id}
          element={inspectElement}
          document={draft.document}
          readOnly={readOnly || !!busy}
          onClose={() => setInspector(null)}
          onApply={(element, definitions) => {
            const assigned =
              element.laneId !== inspectElement.laneId
                ? executeEditorCommand(
                    processEditorAdapter,
                    draft.document,
                    { type: 'assign-lane', ids: [element.id], laneId: element.laneId ?? null },
                    readOnly || !!busy,
                  )
                : draft.document;
            commit({
              ...draft,
              document: {
                ...assigned,
                ...(definitions ? { implementations: processV2Schema.shape.implementations.parse(definitions) } : {}),
                graph: {
                  ...assigned.graph,
                  elements: assigned.graph.elements.map((n) => (n.id === element.id ? element : n)),
                },
              },
            });
          }}
        />
      )}
      {settings && (
        <ProcessSettings
          name={draft.name}
          initialSection={settingsSection}
          value={draft.document}
          readOnly={readOnly || !!busy}
          onClose={() => setSettings(false)}
          onApply={(document, name) => {
            const normalized = normalizeProcessLanes(document);
            commit({ document: normalized, name });
            requestAnimationFrame(() => fitDocument(normalized));
          }}
        />
      )}
      {issuesOpen && (
        <ControlModal label="Process validation" onClose={() => setIssuesOpen(false)}>
          <section className="cp-modal">
            <header className="sp-dialog-header">
              <h2>Process validation</h2>
              <p>
                Unresolved business intent can be saved. Complete every binding and connection before review and
                compilation.
              </p>
            </header>
            <div className="sp-dialog-body">
              {issues.length ? (
                issues.map((issue, i) => (
                  <ControlButton
                    key={i}
                    color="link-gray"
                    onPress={() => {
                      const node = draft.document.graph.elements.find((n) => issue.path === `graph.elements.${n.id}`);
                      setIssuesOpen(false);
                      if (node) {
                        setSelected(node.id);
                        setInspector(node.id);
                      } else setSettings(true);
                    }}
                  >
                    {issue.message}
                  </ControlButton>
                ))
              ) : (
                <p>The linear process is configured. Save and review it before compiling.</p>
              )}
            </div>
            <footer className="cp-actions">
              <ControlButton onPress={() => setIssuesOpen(false)}>Close</ControlButton>
            </footer>
          </section>
        </ControlModal>
      )}
    </FullscreenWorkbench>
  );
}
