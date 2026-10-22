'use client';
import { workflowEditorAdapter, workflowNodeSize } from '@/lib/flows/editor-adapter';
import { executeEditorCommand, type DiagramCommand } from '@/lib/graph-editor/adapter';
import { WorkflowRenderer } from './workflow-renderer';
import { useCanvasViewport } from '@/components/graph-editor/use-canvas-viewport';
import type { CanvasNode } from '@/lib/graph-editor/contracts';
import { useWorkspaceRefresh } from '@/hooks/use-workspace-events';
import { nativeCatalog, defaultOperation } from '@/lib/native/catalog';
import { nodeClassification } from '@/lib/authoring/editor-contract';
import { saveWorkflowDraft } from '@/lib/flows/persistence';
import { refreshNodeConfigurationIssues } from '@/lib/native/node-config';
import { nativeKinds, type NativeKind } from '@/lib/native/model';
import { NativeNodeFields } from './native-node-fields';
import { defaultCode } from '@/lib/authoring/model';
import { Button as UiButton } from '@/components/base/buttons/button';
import { ControlInput } from '@/components/control/controls';
import { Tooltip } from '@/components/base/tooltip/tooltip';
import { Dropdown } from '@/components/base/dropdown/dropdown';
import { ModalOverlay, Modal, Dialog } from '@/components/application/modals/modal';
import {
  DotsVertical,
  SettingsIcon,
  Trash01,
  Plus as AddIcon,
  X as CloseIcon,
  Activity as OperationIcon,
  WorkflowIcon,
} from '@/components/fa-icons';
import { NodeConfigDialog } from './node-config-dialog';
import { NativeSettings } from './native-settings';
import { RunMessage } from './run-message';

import { useLingui } from '@/lib/i18n';
import {
  Activity,
  ArrowLeft,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Copy,
  Database,
  Download,
  FileText,
  GitBranch,
  Hand,
  Hourglass,
  KeyRound,
  Keyboard,
  Loader2,
  Maximize,
  MessageSquareText,
  Minus,
  MoreHorizontal,
  PanelRightClose,
  Play,
  Plus,
  Save,
  Search,
  Sparkles,
  Target,
  TerminalSquare,
  Trash2,
  Wrench,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import Link from 'next/link';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Trans } from '@/components/i18n/trans';
import { SopMarkdown } from '@/components/agent42/sop-markdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import type { ResolveResult } from '@/components/agent42/escalation-resolve-card';
import { ConnectorOperationFields } from '@/components/flows/connector-operation-fields';
import { NODE_ACTION_SURFACES } from '@/components/flows/node-action-surfaces';
import type {
  AgentFlow,
  EscalationSummary,
  FlowEdgeData,
  FlowNodeConfig,
  FlowNodeData,
  FlowNodeKind,
  FlowNodeStatus,
  FlowRunEvent,
} from '@/lib/flows/types';
import { ropePath } from '@/lib/flows/geometry';
import { mapEscalationsByNode } from '@/lib/flows/escalation-map';
import { getNodeActions, type NodeActionDescriptor, type NodeActionId } from '@/lib/flows/node-actions';
import { isStarterFlow } from '@/lib/flows/templates';
import { cn } from '@/lib/utils';
import {
  fallbackWorkspaceResources,
  type WorkspaceModelProfile,
  type WorkspaceResourceConfig,
  type WorkspaceToolProfile,
} from '@/lib/workspace/resources';

type FlowBuilderProps = {
  initialFlow: AgentFlow;
  /** Where the "Back" button returns to (the page the flow was launched from).
   * Absent for bare /flows visits, where a generic "Workspace" link shows. */
  backHref?: string;
  /** Where "View SOP" opens (the worker's source-document / detail view). */
  sopHref?: string;
  /** Node to select and center on load, e.g. from a SOP heading deep-link
   * (`?node=<id>`). Ignored if no node with this id exists in the flow. */
  focusNodeId?: string;
  /** Id of the worker whose background demo-data provisioning job was kicked
   * off at onboard time. When set, the builder polls the worker's
   * provisioning status and gates the Run button until it's ready. */
  workerId?: string;
  /** Current user's display name for the e-signature line in the resolve
   * modal. Absent → the resolve action is unavailable. */
  signerName?: string;
  /** Active workspace slug, for the "View in audit" link after a resolve. */
  workspaceSlug?: string;
  /** Node whose resolve modal should auto-open once its escalation is
   * loaded, e.g. arriving from an escalation card (`?resolve=<nodeId>`). */
  resolveNodeId?: string;
};

type WorkspacePromptAsset = {
  id: string;
  name: string;
  description: string | null;
  content: string;
  variables: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
};

type Viewport = {
  x: number;
  y: number;
  zoom: number;
};

type Point = {
  x: number;
  y: number;
};

type HandleSide = 'top' | 'right' | 'bottom' | 'left';
type EdgeSource = { nodeId: string; handle: HandleSide } | null;
type EdgeEndpoint = 'source' | 'target';
type EdgeReconnect = { edgeId: string; endpoint: EdgeEndpoint } | null;
type PaletteState = { x: number; y: number; world: Point } | null;
type AssistantMode = 'closed' | 'open';
type PointerTarget = { kind: 'canvas' } | { kind: 'node'; nodeId: string } | null;
type PointerHintState = {
  x: number;
  y: number;
  visible: boolean;
  target: PointerTarget;
};

const MAX_FLOW_NODES = 50;

function msg(message: string) {
  return { id: message, message };
}

const legacyNodePalette: Array<{
  kind: FlowNodeKind;
  label: string;
  description: string;
  icon: typeof Play;
  color: string;
  bg: string;
}> = [
  {
    kind: 'trigger',
    label: 'Trigger',
    description: 'Receive workflow input',
    icon: Play,
    color: '#2563eb',
    bg: '#eff6ff',
  },
  {
    kind: 'prompt',
    label: 'Prompt',
    description: 'Prepare or transform text',
    icon: MessageSquareText,
    color: '#7c3aed',
    bg: '#f5f3ff',
  },
  {
    kind: 'llm',
    label: 'LLM Agent',
    description: 'Model reasoning step',
    icon: Bot,
    color: '#111827',
    bg: '#f5f6f8',
  },
  {
    kind: 'tool',
    label: 'Tool',
    description: 'API, RAG, browser, database',
    icon: Wrench,
    color: '#0f766e',
    bg: '#ecfdf5',
  },
  {
    kind: 'condition',
    label: 'Condition',
    description: 'Branch on output',
    icon: GitBranch,
    color: '#9333ea',
    bg: '#faf5ff',
  },
  {
    kind: 'approval',
    label: 'Approval',
    description: 'Human checkpoint',
    icon: Hand,
    color: '#be123c',
    bg: '#fff1f2',
  },
  {
    kind: 'output',
    label: 'Output',
    description: 'Return final result',
    icon: TerminalSquare,
    color: '#047857',
    bg: '#ecfdf5',
  },
];

const nodePalette = [
  ...legacyNodePalette,
  {
    kind: 'construct' as const,
    label: 'Construct data',
    description: 'Build one typed value without changing variables',
    icon: Database,
    color: '#365f83',
    bg: '#edf5fc',
  },
  {
    kind: 'merge' as const,
    label: 'Merge',
    description: 'Combine explicit results and commit scoped updates',
    icon: Database,
    color: '#365f83',
    bg: '#edf5fc',
  },
  {
    kind: 'code' as const,
    label: 'Code',
    description: 'Run JavaScript or TypeScript in an isolated runtime',
    icon: TerminalSquare,
    color: '#365f83',
    bg: '#edf5fc',
  },
  {
    kind: 'setVariables' as const,
    label: 'Set variables',
    description: 'Set typed workflow objects, arrays and values',
    icon: Database,
    color: '#365f83',
    bg: '#edf5fc',
  },
  ...nativeCatalog.map((item) => ({
    ...item,
    icon:
      item.kind === 'delay' || item.kind === 'receive'
        ? Hourglass
        : item.kind === 'transaction'
          ? Database
          : item.kind === 'decision'
            ? GitBranch
            : Activity,
    color: '#365f83',
    bg: '#edf5fc',
  })),
];

const nodeActionClass =
  'inline-flex h-8 items-center justify-center gap-2 rounded-none border border-[#dce4ef] bg-white px-3 font-medium text-[#252a33] text-xs transition hover:bg-[#f8fafc]';

export function FlowBuilder({
  backHref,
  focusNodeId,
  initialFlow,
  resolveNodeId,
  signerName,
  sopHref,
  workerId,
  workspaceSlug,
}: FlowBuilderProps) {
  const { _ } = useLingui();
  const { boardRef, viewport, setViewport, zoomBy, fit, screenToWorld } = useCanvasViewport();
  const activeRunRef = useRef<string | null>(null);
  const [viewingRun, setViewingRun] = useState(false);
  const [runParentId, setRunParentId] = useState<string | null>(null);
  const dragRef = useRef<{ nodeId: string; dx: number; dy: number } | null>(null);
  const panRef = useRef<{ x: number; y: number; viewport: Viewport } | null>(null);
  const reconnectRef = useRef<EdgeReconnect>(null);
  const pulseTimerRef = useRef<number | null>(null);
  const nodeFailureToastedRef = useRef(false);
  // Guards the auto-open of the resolve modal for `resolveNodeId` so it
  // fires exactly once after escalations load — never reopening after the
  // user closes it.
  const autoResolvedRef = useRef(false);
  const [graphMeta, setGraphMeta] = useState(initialFlow);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  const [definitionStack, setDefinitionStack] = useState<{ root: AgentFlow; ref: string }[]>([]);
  const scopeDepthRef = useRef(0);
  const seenSequenceRef = useRef(-1);
  const [flowId, setFlowId] = useState(initialFlow.id);
  const [flowName, setFlowName] = useState(initialFlow.name);
  const [flowDescription, setFlowDescription] = useState(initialFlow.description || '');
  const [nodes, setNodes] = useState<FlowNodeData[]>(initialFlow.nodes);
  const [edges, setEdges] = useState<FlowEdgeData[]>(initialFlow.edges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(initialFlow.nodes[0]?.id ?? null);
  const [inspectorNodeId, setInspectorNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [edgeSource, setEdgeSource] = useState<EdgeSource>(null);
  const [reconnectingEdgeId, setReconnectingEdgeId] = useState<string | null>(null);
  const [connectionPreview, setConnectionPreview] = useState<{
    source: Point;
    target: Point;
  } | null>(null);
  const [palette, setPalette] = useState<PaletteState>(null);
  const [assistant, setAssistant] = useState<AssistantMode>('closed');
  const [runInput, setRunInput] = useState('Please review this request.');
  const [events, setEvents] = useState<FlowRunEvent[]>([]);
  const [deliverable, setDeliverable] = useState<{ title: string; content: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [childRuns, setChildRuns] = useState<
    { id: string; flow_id: string; flow_name: string; parent_node_id: string; status: string }[]
  >([]);
  const [runProgressDismissed, setRunProgressDismissed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [provisionStatus, setProvisionStatus] = useState<string | null>(null);
  const [resources, setResources] = useState<WorkspaceResourceConfig>(fallbackWorkspaceResources);
  const [pointerHint, setPointerHint] = useState<PointerHintState>({
    x: 0,
    y: 0,
    visible: false,
    target: null,
  });
  const [nodeStatuses, setNodeStatuses] = useState<Record<string, FlowNodeStatus>>({});
  const [escalationsByNodeId, setEscalationsByNodeId] = useState<Record<string, EscalationSummary>>({});
  const [nodeOutputs, setNodeOutputs] = useState<Record<string, unknown>>({});
  const [pulseNodeIds, setPulseNodeIds] = useState<Set<string>>(new Set());
  const [activeAction, setActiveAction] = useState<{ nodeId: string; actionId: NodeActionId } | null>(null);

  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId) ?? null, [nodes, selectedNodeId]);
  const inspectorNode = useMemo(
    () => nodes.find((node) => node.id === inspectorNodeId) ?? null,
    [nodes, inspectorNodeId],
  );
  const completedCount = Object.values(nodeStatuses).filter((status) => status === 'succeeded').length;
  const showRunProgress = !runProgressDismissed && (running || events.length > 0);
  const provisioning = provisionStatus === 'provisioning';

  useEffect(() => {
    // Only hydrate from the saved-flow list on the bare /flows entry, where the
    // server hands us the starter flow. When a specific flow was requested via
    // ?flow=<id>, the server already resolved it into initialFlow — refetching
    // here would clobber the requested flow with flows[0] (every SOP/worker
    // then opens the same first flow).
    const runId = new URLSearchParams(window.location.search).get('run');
    if (runId) void followRun(runId);
    else if (isStarterFlow(initialFlow)) void loadSavedFlow();
    void loadWorkspaceResources();
    // Local starter mode remains the fallback when auth/database are not configured.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Deep-link from a SOP heading: select the compiled node and center the
    // canvas on it so the user lands looking at the step for that section.
    if (!focusNodeId) return;
    const target = initialFlow.nodes.find((node) => node.id === focusNodeId);
    if (!target) return;
    const size = getNodeSize(target.kind);
    const zoom = 0.86;
    setSelectedNodeId(focusNodeId);
    setViewport({
      x: -(target.position.x + size.width / 2) * zoom,
      y: -(target.position.y + size.height / 2) * zoom,
      zoom,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Poll the background demo-data provisioning job kicked off at onboard
    // time so we can show a "Preparing demo data…" chip and gate Run until
    // the mock tools + reference KB exist. No worker id, no polling.
    if (!workerId) return;
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const poll = async () => {
      try {
        const response = await fetch(`/api/workers/${workerId}`, {
          credentials: 'same-origin',
        });
        const body = await response.json().catch(() => null);
        if (cancelled) return;
        const status: string | null = body?.provisionStatus ?? null;
        setProvisionStatus(status);
        if (status === 'ready' || status === 'error' || !status) {
          stop();
        }
      } catch {
        // Best-effort: a failed fetch shouldn't throw. Keep polling — the
        // next tick may succeed.
      }
    };

    void poll();
    intervalId = setInterval(() => void poll(), 2000);

    return () => {
      cancelled = true;
      stop();
    };
  }, [workerId]);

  const loadEscalations = useCallback(async () => {
    try {
      const response = await fetch('/api/escalations?status=open', {
        credentials: 'include',
      });
      if (!response.ok) return;
      const list = (await response.json()) as EscalationSummary[];
      const map = mapEscalationsByNode(Array.isArray(list) ? list : [], flowId, activeRunRef.current ?? undefined);
      setEscalationsByNodeId(map);
      // A node with an open escalation IS paused on a human — reflect that as
      // "waiting" so its Resolve chip shows even on a fresh page load (no live
      // run stream in this tab). Only lift nodes that aren't already in a live
      // status (running/succeeded/failed/skipped) — never override those.
      setNodeStatuses((items) => {
        const next = { ...items };
        for (const nodeId of Object.keys(map)) {
          const current = next[nodeId];
          if (!current || current === 'idle') next[nodeId] = 'waiting';
        }
        return next;
      });
    } catch {
      // best-effort — the canvas simply shows no resolve actions
    }
  }, [flowId]);

  // After a resolve, the resolved gate is done but the run may have paused
  // again at the next approval node. Re-fetch open escalations and mark any
  // node other than the just-resolved one "waiting" — that's the next gate.
  // If the run instead finished (succeeded/failed), the refreshed map has no
  // entries for this flow and no node gets re-marked; the surface's toast
  // already conveys that outcome.
  const refreshWaitingFromEscalations = useCallback(
    async (justResolvedNodeId: string) => {
      const response = await fetch('/api/escalations?status=open', {
        credentials: 'include',
      }).catch(() => null);
      if (!response || !response.ok) return;
      const list = (await response.json().catch(() => null)) as EscalationSummary[] | null;
      const map = mapEscalationsByNode(Array.isArray(list) ? list : [], flowId, activeRunRef.current ?? undefined);
      setEscalationsByNodeId(map);
      setNodeStatuses((items) => {
        const next = { ...items };
        for (const nodeId of Object.keys(map)) {
          if (nodeId !== justResolvedNodeId) next[nodeId] = 'waiting';
        }
        return next;
      });
    },
    [flowId],
  );

  function handleActionResolved(result: ResolveResult) {
    const nodeId = result.escalation.nodeId;
    // The resolved gate is done.
    setNodeStatuses((items) => ({ ...items, [nodeId]: 'succeeded' }));
    // Refresh escalations so the resolved one drops off and any new one
    // (the run's next gate) appears, marking the newly-waiting node.
    void refreshWaitingFromEscalations(nodeId);
    void followRun(result.run.id);
  }

  async function followRun(runId: string) {
    setChildRuns([]);
    activeRunRef.current = runId;
    setViewingRun(true);
    setRunning(true);
    seenSequenceRef.current = -1;
    setEvents([]);
    setNodeStatuses({});
    setRunProgressDismissed(false);
    try {
      const detailResponse = await fetch(`/api/runs/${runId}`);
      if (!detailResponse.ok) throw new Error('Run not found.');
      const detail = await detailResponse.json();
      const snapshot = detail.graph as AgentFlow;
      setRunParentId(detail.parent_id ?? null);
      setGraphMeta(snapshot);
      setFlowId(snapshot.id);
      setFlowName(snapshot.name);
      setFlowDescription(snapshot.description || '');
      setNodes(
        snapshot.authoringVersion === 2
          ? snapshot.nodes.map((node) => ({ ...node, kind: node.config.authoredKind ?? node.kind }))
          : snapshot.nodes,
      );
      setEdges(snapshot.edges);
      setRunInput(
        snapshot.schemaVersion === 2
          ? JSON.stringify(
              {
                ...(detail.input?.userInput !== undefined ? { userInput: detail.input.userInput } : {}),
                variables: detail.input?.variables ?? {},
              },
              null,
              2,
            )
          : detail.input?.userInput || '',
      );
      const response = await fetch(`/api/runs/${runId}/events`);
      if (!response.ok || !response.body) throw new Error('Could not reconnect to the run.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) if (line.trim()) applyRunEvent(JSON.parse(line) as FlowRunEvent);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Run connection failed.');
    } finally {
      setRunning(false);
      void loadEscalations();
    }
  }

  useEffect(() => {
    // Load open escalations for this flow on mount so nodes paused from a
    // prior run already show their resolve action. Meaningful for any real
    // (non-starter) flow — including one opened via an escalation card,
    // which has no `worker=` param; the local starter flow has no runs to
    // escalate.
    if (isStarterFlow(initialFlow)) return;
    void loadEscalations();
  }, [loadEscalations, initialFlow]);

  useEffect(() => {
    // Arriving from an escalation card (`?resolve=<nodeId>`): once that
    // node's open escalation has loaded, auto-open its resolve modal. Fires
    // exactly once (ref guard) — if the user closes it, it stays closed. If
    // the escalation was already resolved before arrival, the map never
    // gets the entry and this is a no-op.
    if (!resolveNodeId) return;
    if (autoResolvedRef.current) return;
    if (!escalationsByNodeId[resolveNodeId]) return;
    autoResolvedRef.current = true;
    setActiveAction({ nodeId: resolveNodeId, actionId: 'resolve-escalation' });
  }, [escalationsByNodeId, resolveNodeId]);

  async function loadSavedFlow() {
    try {
      const response = await fetch('/api/flows', { credentials: 'include' });
      if (!response.ok) return;
      const flows = (await response.json()) as AgentFlow[];
      const requestedId = new URLSearchParams(window.location.search).get('flow');
      const first = requestedId ? flows.find((flow) => flow.id === requestedId) : flows[0];
      if (!first) return;
      setGraphMeta(first);
      if (first.schemaVersion === 2) setRunInput(JSON.stringify(first.defaultInput ?? { variables: {} }, null, 2));
      setFlowId(first.id);
      setFlowName(first.name);
      setFlowDescription(first.description || '');
      setNodes(first.nodes);
      setEdges(first.edges);
      setSelectedNodeId(first.nodes[0]?.id ?? null);
      const escalationResponse = await fetch('/api/escalations?status=open');
      if (escalationResponse.ok) {
        const open = mapEscalationsByNode(await escalationResponse.json(), first.id, activeRunRef.current ?? undefined);
        setEscalationsByNodeId(open);
        setNodeStatuses((current) => ({
          ...current,
          ...Object.fromEntries(Object.keys(open).map((id) => [id, 'waiting' as const])),
        }));
      }
    } catch {
      // Expected before Supabase and auth are configured.
    }
  }

  async function loadWorkspaceResources() {
    try {
      const response = await fetch('/api/workspace/resources', {
        credentials: 'include',
      });
      if (!response.ok) return;
      const payload = (await response.json()) as WorkspaceResourceConfig;
      setResources({
        models: payload.models?.length ? payload.models : fallbackWorkspaceResources.models,
        tools: payload.tools?.length ? payload.tools : fallbackWorkspaceResources.tools,
      });
    } catch {
      setResources(fallbackWorkspaceResources);
    }
  }

  async function addWorkspaceModel() {
    toast.info('Model handlers are registered by your server adapter. No model provider is connected yet.');
  }

  function openPalette(clientX = 96, clientY = 96, world?: Point) {
    if (viewingRun) return;
    setPalette({
      x: clientX,
      y: clientY,
      world: world ?? screenToWorld(clientX, clientY),
    });
  }

  function addNode(kind: FlowNodeKind, atWorld = palette?.world) {
    if (viewingRun) return;
    if (nodes.length >= MAX_FLOW_NODES) {
      toast.warning(_(msg('This workflow has too many nodes.')));
      return;
    }
    const meta = nodePalette.find((item) => item.kind === kind);
    const size = getNodeSize(kind);
    const position = atWorld ?? screenToWorldFromCenter();
    const node: FlowNodeData = {
      id: uid(kind),
      kind,
      name: meta?.label || 'Node',
      description: meta?.description,
      position: {
        x: Math.round(position.x - size.width / 2),
        y: Math.round(position.y - size.height / 2),
      },
      config: defaultConfig(kind),
    };
    if (kind === 'code' || kind === 'setVariables')
      setGraphMeta((old) => ({ ...old, authoringVersion: old.authoringVersion ?? 1 }));
    if (graphMeta.authoringVersion === 2 && node.config.code) node.config.code.profile = 'pure-transform@1';
    setNodes((items) => [...items, node]);
    setSelectedNodeId(node.id);
    setInspectorNodeId(node.id);
    setPalette(null);
  }

  function updateSelectedNode(patch: Partial<FlowNodeData>) {
    if (viewingRun) return;
    const target = inspectorNode ?? selectedNode;
    if (!target) return;
    setNodes((items) =>
      items.map((node) =>
        node.id === target.id
          ? {
              ...node,
              ...patch,
              config: {
                ...node.config,
                ...(patch.config || {}),
              },
            }
          : node,
      ),
    );
  }

  function diagramCommand(command: DiagramCommand) {
    if (viewingRun) return;
    try {
      const next = executeEditorCommand(workflowEditorAdapter, { nodes, edges }, command, viewingRun);
      setNodes(next.nodes);
      setEdges(next.edges);
    } catch (error) {
      toast.warning(error instanceof Error ? error.message : 'Could not edit workflow.');
    }
  }

  function deleteNode(nodeId = inspectorNodeId ?? selectedNodeId) {
    if (viewingRun) return;
    if (!nodeId) return;
    diagramCommand({ type: 'delete', ids: [nodeId] });
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
    if (inspectorNodeId === nodeId) setInspectorNodeId(null);
  }

  function startEdge(nodeId: string, handle: HandleSide = 'right') {
    if (viewingRun) return;
    const source = nodes.find((node) => node.id === nodeId);
    if (!source) return;
    setEdgeSource({ nodeId, handle });
    setConnectionPreview({
      source: handlePoint(source, handle),
      target: handlePoint(source, handle),
    });
  }

  function finishEdge(targetNodeId: string, targetHandle: HandleSide = 'left') {
    if (!edgeSource) return;
    if (edgeSource.nodeId === targetNodeId) {
      toast.warning(_(msg('A node cannot connect to itself.')));
      clearEdgeMode();
      return;
    }
    diagramCommand({
      type: 'connect',
      id: uid('edge'),
      source: edgeSource.nodeId,
      target: targetNodeId,
      sourceHandle: edgeSource.handle,
      targetHandle,
    });
    pulseConnectedNodes(edgeSource.nodeId, targetNodeId);
    clearEdgeMode();
  }

  function clearEdgeMode() {
    setEdgeSource(null);
    setConnectionPreview(null);
  }

  function cycleEdgeHandles(edgeId: string) {
    diagramCommand({ type: 'reroute', id: edgeId });
  }

  function startEndpointReconnect(
    event: React.PointerEvent<HTMLButtonElement>,
    edgeId: string,
    endpoint: EdgeEndpoint,
  ) {
    if (viewingRun) return;
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const edge = edges.find((item) => item.id === edgeId);
    if (!edge) return;
    const source = nodes.find((node) => node.id === edge.source);
    const target = nodes.find((node) => node.id === edge.target);
    if (!source || !target) return;

    reconnectRef.current = { edgeId, endpoint };
    setReconnectingEdgeId(edgeId);
    setSelectedEdgeId(edgeId);
    setSelectedNodeId(null);
    setInspectorNodeId(null);

    const endpoints = edgeEndpoints(edge, source, target);
    const pointer = screenToWorld(event.clientX, event.clientY);
    setConnectionPreview(
      endpoint === 'source'
        ? { source: pointer, target: endpoints.target }
        : { source: endpoints.source, target: pointer },
    );
  }

  function finishEndpointReconnect(clientX: number, clientY: number) {
    const reconnect = reconnectRef.current;
    if (!reconnect) return;

    const dropTarget = resolveConnectorDrop(clientX, clientY);
    reconnectRef.current = null;
    setReconnectingEdgeId(null);
    setConnectionPreview(null);

    if (!dropTarget) return;

    diagramCommand({
      type: 'reconnect',
      id: reconnect.edgeId,
      endpoint: reconnect.endpoint,
      nodeId: dropTarget.nodeId,
      handle: dropTarget.handle,
    });
  }

  function resolveConnectorDrop(clientX: number, clientY: number) {
    const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const handle = element?.closest('[data-board-handle]') as HTMLElement | null;
    if (handle?.dataset.boardNodeId && isHandleSide(handle.dataset.boardHandleSide)) {
      return {
        nodeId: handle.dataset.boardNodeId,
        handle: handle.dataset.boardHandleSide,
      };
    }

    const nodeElement = element?.closest('[data-board-node]') as HTMLElement | null;
    const nodeId = nodeElement?.dataset.nodeId;
    const node = nodeId ? nodes.find((item) => item.id === nodeId) : undefined;
    if (!node) return null;

    return {
      nodeId: node.id,
      handle: closestHandleSide(node, screenToWorld(clientX, clientY)),
    };
  }

  function pulseConnectedNodes(sourceNodeId: string, targetNodeId: string) {
    if (pulseTimerRef.current) window.clearTimeout(pulseTimerRef.current);
    setPulseNodeIds(new Set([sourceNodeId, targetNodeId]));
    pulseTimerRef.current = window.setTimeout(() => setPulseNodeIds(new Set()), 620);
  }

  function handleNodePointerDown(event: React.PointerEvent<HTMLElement>, nodeId: string) {
    if (viewingRun) {
      setSelectedNodeId(nodeId);
      return;
    }
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('[data-board-nodrag]')) return;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    const node = nodes.find((item) => item.id === nodeId);
    if (!node) return;
    const point = screenToWorld(event.clientX, event.clientY);
    dragRef.current = {
      nodeId,
      dx: point.x - node.position.x,
      dy: point.y - node.position.y,
    };
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
  }

  function handleBoardPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (
      event.button !== 0 ||
      (event.target as HTMLElement).closest('[data-board-node], button, input, textarea, select')
    ) {
      return;
    }
    panRef.current = { x: event.clientX, y: event.clientY, viewport };
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setInspectorNodeId(null);
  }

  function handleBoardPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    setPointerHint({
      x: event.clientX,
      y: event.clientY,
      visible: true,
      target: getPointerTarget(event.target as HTMLElement),
    });
    if (dragRef.current) {
      const point = screenToWorld(event.clientX, event.clientY);
      const { nodeId, dx, dy } = dragRef.current;
      setNodes(
        (current) =>
          executeEditorCommand(
            workflowEditorAdapter,
            { nodes: current, edges },
            { type: 'move', positions: { [nodeId]: { x: point.x - dx, y: point.y - dy } } },
            viewingRun,
          ).nodes,
      );
    }
    if (panRef.current) {
      setViewport({
        ...viewport,
        x: panRef.current.viewport.x + event.clientX - panRef.current.x,
        y: panRef.current.viewport.y + event.clientY - panRef.current.y,
      });
    }
    if (edgeSource) {
      const source = nodes.find((node) => node.id === edgeSource.nodeId);
      if (!source) return;
      setConnectionPreview({
        source: handlePoint(source, edgeSource.handle),
        target: screenToWorld(event.clientX, event.clientY),
      });
    }
    if (reconnectRef.current) {
      const edge = edges.find((item) => item.id === reconnectRef.current?.edgeId);
      if (!edge) return;
      const source = nodes.find((node) => node.id === edge.source);
      const target = nodes.find((node) => node.id === edge.target);
      if (!source || !target) return;
      const endpoints = edgeEndpoints(edge, source, target);
      const pointer = screenToWorld(event.clientX, event.clientY);
      setConnectionPreview(
        reconnectRef.current.endpoint === 'source'
          ? { source: pointer, target: endpoints.target }
          : { source: endpoints.source, target: pointer },
      );
    }
  }

  function handleBoardPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    finishEndpointReconnect(event.clientX, event.clientY);
    dragRef.current = null;
    panRef.current = null;
  }

  function cleanupLayout() {
    diagramCommand({ type: 'arrange' });
    fit();
  }

  function screenToWorldFromCenter() {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  async function saveFlow(settingsPatch?: Partial<AgentFlow>) {
    if (viewingRun || definitionStack.length) return;
    setSaving(true);
    const flow = { ...currentFlow(), ...settingsPatch };
    if (settingsPatch) flow.nodes = refreshNodeConfigurationIssues(flow);
    try {
      const saved = await saveWorkflowDraft(flow, runInput);
      setFlowId(saved.id);
      setGraphMeta(saved);
      if (settingsPatch) setNodes(refreshNodeConfigurationIssues(saved));
      toast.success(_(msg('Flow saved')));
    } catch (error) {
      // Settings must remain open on persistence failure; never claim they were saved.
      if (settingsPatch) throw error;
      window.localStorage.setItem('agent42.localFlow', JSON.stringify(flow));
      toast.warning(
        error instanceof Error ? _('Saved locally: {message}', { message: error.message }) : _(msg('Saved locally')),
      );
    } finally {
      setSaving(false);
    }
  }

  async function runFlow() {
    if (viewingRun || definitionStack.length) return;
    setRunning(true);
    setRunProgressDismissed(false);
    seenSequenceRef.current = -1;
    setEvents([]);
    setDeliverable(null);
    setNodeStatuses({});
    setNodeOutputs({});
    nodeFailureToastedRef.current = false;

    try {
      const draft = currentFlow();
      if (draft.schemaVersion === 2) draft.defaultInput = JSON.parse(runInput);
      const savedResponse = await fetch(draft.id === 'starter-flow' ? '/api/flows' : `/api/flows/${draft.id}`, {
        method: draft.id === 'starter-flow' ? 'POST' : 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const savedBody = await savedResponse.json();
      if (!savedResponse.ok) throw new Error(savedBody.error || 'Save failed.');
      const saved = savedBody as AgentFlow;
      setFlowId(saved.id);
      setGraphMeta(saved);
      setChildRuns([]);
      const response = await fetch('/api/flows/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          flow: saved,
          input: graphMeta.schemaVersion === 2 ? JSON.parse(runInput) : { userInput: runInput },
        }),
      });
      if (!response.ok || !response.body) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.error || 'Flow run failed to start.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as FlowRunEvent;
          applyRunEvent(event);
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : _(msg('Flow run failed')));
    } finally {
      setRunning(false);
    }
  }

  function applyRunEvent(event: FlowRunEvent) {
    const sequence = (event as FlowRunEvent & { sequence?: number }).sequence;
    if (sequence !== undefined) {
      if (sequence <= seenSequenceRef.current) return;
      seenSequenceRef.current = sequence;
    }

    if (event.type === 'run.started') {
      activeRunRef.current = event.runId;
      setViewingRun(true);
      window.history.replaceState(
        null,
        '',
        `/flows?flow=${encodeURIComponent(event.flowId)}&run=${encodeURIComponent(event.runId)}`,
      );
    }
    setEvents((items) => [...items, event]);
    if (scopeDepthRef.current) return;
    if (event.type === 'node.started') {
      setNodeStatuses((items) => ({ ...items, [event.nodeId]: 'running' }));
    }
    if (event.type === 'node.completed') {
      setNodeStatuses((items) => ({
        ...items,
        [event.nodeId]: 'succeeded',
      }));
      setNodeOutputs((items) => {
        if (event.presence === 'absent') {
          const next = { ...items };
          delete next[event.nodeId];
          return next;
        }
        return { ...items, [event.nodeId]: event.output };
      });
    }
    if (event.type === 'node.skipped') {
      setNodeStatuses((items) => ({ ...items, [event.nodeId]: 'skipped' }));
    }
    if (event.type === 'node.failed') {
      setNodeStatuses((items) => ({ ...items, [event.nodeId]: 'failed' }));
      toast.error(`${event.nodeName}: ${event.error}`);
      nodeFailureToastedRef.current = true;
    }
    if (event.type === 'node.waiting') {
      setNodeStatuses((items) => ({ ...items, [event.nodeId]: 'waiting' }));
      void fetch('/api/escalations?status=open')
        .then((response) => response.json())
        .then((list: EscalationSummary[]) => {
          const map = Object.fromEntries(
            list.filter((item) => item.runId === event.runId).map((item) => [item.nodeId, item]),
          );
          setEscalationsByNodeId(map);
        });
    }
    if (event.type === 'run.resumed') {
      setNodeStatuses((items) => ({ ...items, [event.nodeId]: 'running' }));
    }
    if (event.type === 'run.failed') {
      if (!nodeFailureToastedRef.current) {
        toast.error(event.error);
      }
    }
    if (event.type === 'run.completed') {
      setDeliverable(event.deliverable ?? null);
    }
  }

  function currentFlow(): AgentFlow {
    return {
      ...graphMeta,
      id: flowId,
      name: flowName,
      description: flowDescription,
      nodes,
      edges,
      updatedAt: new Date().toISOString(),
    };
  }

  useWorkspaceRefresh(async () => {
    const id = activeRunRef.current;
    if (!viewingRun || !id) return;
    try {
      const response = await fetch(`/api/runs/${id}`);
      if (!response.ok) return;
      const detail = await response.json();
      if (activeRunRef.current !== id || !Array.isArray(detail.events)) return;
      setChildRuns(detail.children ?? []);
      if (detail.status === 'waiting') void loadEscalations();
      for (const row of detail.events) applyRunEvent({ ...row.event, sequence: row.sequence });
    } catch {
      /* The shell stream reconnects and refreshes the run. */
    }
  });

  function loadScope(graph: AgentFlow) {
    setGraphMeta(graph);
    setFlowId(graph.id);
    setFlowName(graph.name);
    setFlowDescription(graph.description || '');
    setNodes(graph.nodes);
    setEdges(graph.edges);
    setInspectorNodeId(null);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setRunProgressDismissed(true);
  }
  async function inspectDefinition(ref: string) {
    const root = currentFlow();
    const definition = root.definitions?.[ref] || definitionStack[0]?.root.definitions?.[ref];
    if (!definition) {
      window.open(`/flows?flow=${encodeURIComponent(ref)}`, '_blank', 'noopener');
      return;
    }
    const stack = [...definitionStack, { root, ref }];
    setDefinitionStack(stack);
    scopeDepthRef.current = stack.length;
    loadScope(
      root.authoringVersion === 2
        ? {
            ...definition,
            captures: [...(root.captures ?? []), ...(root.declarations ?? [])].map(({ id, name, schema }) => ({
              id,
              name,
              schema,
            })),
          }
        : definition,
    );
  }
  function leaveDefinition() {
    const frame = definitionStack.at(-1);
    if (!frame) return;
    const child = currentFlow();
    const parent = { ...frame.root, definitions: { ...frame.root.definitions, [frame.ref]: child } };
    const stack = definitionStack.slice(0, -1);
    setDefinitionStack(stack);
    scopeDepthRef.current = stack.length;
    loadScope(parent);
  }

  return (
    <main
      className="agent42-shell app editor-shell"
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        if (
          event.defaultPrevented ||
          target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"],[role="menu"]')
        )
          return;
        if (event.key === 'Escape') {
          setSelectedNodeId(null);
          setSelectedEdgeId(null);
          setInspectorNodeId(null);
          clearEdgeMode();
          setPalette(null);
        }
        if ((event.key === 'Delete' || event.key === 'Backspace') && !viewingRun && !inspectorNodeId && !palette) {
          if (selectedNodeId) {
            event.preventDefault();
            deleteNode(selectedNodeId);
          } else if (selectedEdgeId) {
            event.preventDefault();
            setEdges((items) => items.filter((edge) => edge.id !== selectedEdgeId));
            setSelectedEdgeId(null);
          }
        }
      }}
    >
      <section className="stage">
        <WorkflowRenderer
          surfaceProps={{
            'aria-label': _(msg('Agent workflow canvas')),
            className: 'board',
            'data-dragging': dragRef.current ? 'true' : undefined,
            'data-edge-mode': edgeSource || reconnectingEdgeId ? 'true' : undefined,
            'data-panning': panRef.current ? 'true' : undefined,
            'data-readonly': viewingRun ? 'true' : 'false',
            onContextMenu: (event) => {
              event.preventDefault();
              const node = (event.target as HTMLElement).closest('[data-node-id]') as HTMLElement | null;
              if (node?.dataset.nodeId) {
                setSelectedNodeId(node.dataset.nodeId);
                setInspectorNodeId(node.dataset.nodeId);
                return;
              }
              openPalette(event.clientX, event.clientY);
            },
            onPointerDown: handleBoardPointerDown,
            onPointerLeave: () =>
              setPointerHint((current) => ({
                ...current,
                visible: false,
                target: null,
              })),
            onPointerMove: handleBoardPointerMove,
            onPointerUp: handleBoardPointerUp,
            boardRef: boardRef,
            viewport: viewport,
            overlay: <PointerHint edgeActive={Boolean(edgeSource || reconnectingEdgeId)} pointer={pointerHint} />,
          }}
          document={{ nodes, edges }}
          readOnly={viewingRun}
          decorateNode={(item) => projectWorkflowNode(nodes.find((node) => node.id === item.id)!)}
          edgeProps={{
            connectionPreview: connectionPreview,
            onDeleteEdge: (edgeId) => {
              if (viewingRun) return;
              diagramCommand({ type: 'delete', ids: [edgeId] });
              setSelectedEdgeId(null);
            },
            onCycleEdgeHandles: cycleEdgeHandles,
            onSelectEdge: (id) => {
              setSelectedEdgeId(id);
              setSelectedNodeId(null);
            },
            onStartEndpointReconnect: startEndpointReconnect,
            reconnectingEdgeId: reconnectingEdgeId,
            selectedEdgeId: selectedEdgeId,
            selectedNodeId: inspectorNodeId ?? selectedNodeId,
          }}
          nodeProps={(id) => {
            const node = nodes.find((node) => node.id === id)!;
            return {
              actions: getNodeActions(node, nodeStatuses[node.id] || 'idle', {
                escalationsByNodeId,
              }),
              edgeSource: edgeSource,
              onDelete: () => deleteNode(node.id),
              onFinishEdge: finishEdge,
              onInvokeAction: (actionId) => setActiveAction({ nodeId: node.id, actionId: actionId as NodeActionId }),
              onOpenInspector: () => {
                setSelectedNodeId(node.id);
                setInspectorNodeId(workflowEditorAdapter.configuration({ nodes, edges }, node.id)?.id ?? null);
              },
              onPointerDown: handleNodePointerDown,
              onSelect: () => {
                if (edgeSource && edgeSource.nodeId !== node.id) {
                  finishEdge(node.id);
                } else {
                  setSelectedNodeId(node.id);
                }
              },
              onStartEdge: startEdge,
              pulseNodeIds: pulseNodeIds,
              selected: node.id === selectedNodeId || node.id === inspectorNodeId,
              status: nodeStatuses[node.id] || 'idle',
            };
          }}
        />

        <header className="canvas-toolbar">
          <div className="title-pill">
            <Input
              aria-label={_(msg('Workflow name'))}
              className="diagram-name"
              readOnly={viewingRun}
              onChange={(event) => setFlowName(event.target.value)}
              value={flowName}
            />
            <span className="save-count">
              {nodes.length}/{MAX_FLOW_NODES} <span />
            </span>
          </div>
          <div className="toolbar-divider" />
          <button
            aria-label={_(msg('Save'))}
            className="icon-button"
            disabled={saving || viewingRun || definitionStack.length > 0}
            onClick={() => void saveFlow()}
            title={_(msg('Save'))}
            type="button"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          </button>
          <UiButton
            color="tertiary"
            className="canvas-add-trigger"
            iconLeading={AddIcon}
            isDisabled={viewingRun}
            onPress={() => openPalette(24, 90, screenToWorldFromCenter())}
          >
            Add node
          </UiButton>
          <button
            aria-label={_(msg('Draw edge'))}
            className={cn('icon-button', edgeSource && 'active')}
            onClick={() =>
              selectedNodeId ? startEdge(selectedNodeId) : toast.info(_(msg('Select a source node first.')))
            }
            title={_(msg('Draw edge'))}
            type="button"
          >
            <GitBranch className="size-4" />
          </button>
          <button
            aria-label="Export graph JSON"
            title="Export graph JSON"
            className="icon-button"
            type="button"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(currentFlow(), null, 2)], { type: 'application/json' }),
              );
              const link = document.createElement('a');
              link.href = url;
              link.download = 'workflow.json';
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            <Download className="size-4" />
          </button>
          <Dropdown.Root>
            <UiButton color="tertiary" iconLeading={DotsVertical} aria-label="Workflow actions" />
            <Dropdown.Popover placement="bottom end" className="canvas-editor-menu">
              <Dropdown.Menu
                aria-label="Workflow actions"
                onAction={(key) => {
                  if (key === 'arrange') cleanupLayout();
                  if (key === 'help') setAssistant('open');
                  if (key === 'process-source' && graphMeta.sourceReference?.startsWith('process:'))
                    window.open(
                      `/knowledge?view=process&revision=${encodeURIComponent(graphMeta.sourceReference.slice(8))}`,
                      '_blank',
                      'noopener,noreferrer',
                    );
                }}
              >
                <Dropdown.Item id="arrange" isDisabled={viewingRun}>
                  Auto-arrange
                </Dropdown.Item>
                <Dropdown.Item id="help">Workflow help</Dropdown.Item>

                {graphMeta.sourceReference?.startsWith('process:') && (
                  <Dropdown.Item id="process-source">View source process</Dropdown.Item>
                )}
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown.Root>
        </header>

        <div className="top-right-actions">
          {graphMeta.schemaVersion === 2 && !viewingRun && (
            <UiButton color="secondary" className="canvas-workflow-settings" onPress={() => setSettingsOpen(true)}>
              Workflow settings
            </UiButton>
          )}
          {graphMeta.schemaVersion === 2 && viewingRun && activeRunRef.current && (
            <button className="sign-in-button" onClick={() => setMessageOpen(true)}>
              Send message
            </button>
          )}
          {workerId && provisioning ? (
            <span className="inline-flex h-8 items-center gap-2 rounded-none border border-[#dce4ef] bg-[#f8fafc] px-3 font-medium text-[#697386] text-xs">
              <Loader2 className="size-3.5 animate-spin" />
              <Trans>Preparing demo data…</Trans>
            </span>
          ) : null}
          {workerId && provisionStatus === 'error' ? (
            <span className="inline-flex h-8 items-center gap-2 rounded-none border border-[#dce4ef] bg-[#f8fafc] px-3 font-medium text-[#697386] text-xs">
              <Trans>Demo data unavailable</Trans>
            </span>
          ) : null}
          <UiButton
            color="secondary"
            className="canvas-all-runs"
            href="/control?tab=runs"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="All runs (opens in a new tab)"
          >
            All runs
          </UiButton>
          <button
            className="sign-in-button signed-in"
            disabled={running || provisioning || viewingRun || definitionStack.length > 0}
            onClick={() => void runFlow()}
            type="button"
          >
            {running ? (
              <Loader2 className="mr-2 inline size-4 animate-spin" />
            ) : (
              <Play className="mr-2 inline size-4 fill-current" />
            )}
            <Trans>Run</Trans>
          </button>
          {sopHref ? (
            <Link className="sign-in-button" href={sopHref}>
              <FileText className="mr-2 inline size-4" />
              <Trans>View SOP</Trans>
            </Link>
          ) : null}
          {backHref ? (
            <Link className="sign-in-button" href={backHref}>
              <ArrowLeft className="mr-2 inline size-4" />
              <Trans>Back</Trans>
            </Link>
          ) : (
            <Link className="sign-in-button" href="/dashboard">
              <Trans>Workspace</Trans>
            </Link>
          )}
        </div>

        <div className="zoom-controls">
          <button aria-label={_(msg('Zoom in'))} className="icon-button" onClick={() => zoomBy(0.08)} type="button">
            <Plus className="size-4" />
          </button>
          <button aria-label={_(msg('Recenter'))} className="icon-button" onClick={fit} type="button">
            <Target className="size-4" />
          </button>
          <button aria-label={_(msg('Zoom out'))} className="icon-button" onClick={() => zoomBy(-0.08)} type="button">
            <Minus className="size-4" />
          </button>
        </div>

        <button
          aria-label={_(msg('Keyboard shortcuts'))}
          className="keyboard-button"
          onClick={() =>
            toast.info(
              _(
                msg(
                  'Double-click or press Enter to configure a node. Escape clears selection. Delete removes the selected node or edge. Drag to arrange; right-click to add nodes.',
                ),
              ),
            )
          }
          type="button"
        >
          <Keyboard className="size-4" />
        </button>

        <div className="agent42-draft-indicator">
          <span />
          <Trans>Save changes using the toolbar</Trans>
        </div>

        {viewingRun && (
          <div className="studio-snapshot-banner">
            Run snapshot · read only{' '}
            {runParentId ? (
              <a href={`/flows?run=${encodeURIComponent(runParentId)}`}>Parent execution →</a>
            ) : (
              <a href={`/flows?flow=${encodeURIComponent(flowId)}`}>Edit saved workflow →</a>
            )}
          </div>
        )}
        {!viewingRun &&
          selectedEdgeId &&
          (() => {
            const edge = edges.find((item) => item.id === selectedEdgeId);
            if (!edge) return null;
            return (
              <aside className="floating-panel studio-edge-inspector" aria-label="Connection configuration">
                <div className="flex items-center justify-between">
                  <strong>Connection</strong>
                  <button aria-label="Close connection configuration" onClick={() => setSelectedEdgeId(null)}>
                    <X className="size-4" />
                  </button>
                </div>
                <label className="config-input mt-4">
                  <span>Follow this connection when</span>
                  <select
                    aria-label="Connection branch"
                    value={
                      edge.condition ||
                      (nodes.find((node) => node.id === edge.source)?.kind === 'approval' ? 'true' : 'always')
                    }
                    onChange={(event) =>
                      setEdges((items) =>
                        items.map((item) =>
                          item.id === edge.id
                            ? { ...item, condition: event.target.value as FlowEdgeData['condition'] }
                            : item,
                        ),
                      )
                    }
                  >
                    <option value="always">Always</option>
                    <option value="true">True / approved</option>
                    <option value="false">False / rejected</option>
                    {graphMeta.schemaVersion === 2 && (
                      <>
                        <option value="success">Success</option>
                        <option value="error">Error / compensation</option>
                        <option value="timeout">Timeout</option>
                      </>
                    )}
                  </select>
                </label>
                <p className="mt-3 text-xs text-slate-500">Branch selection applies to condition and approval nodes.</p>
              </aside>
            );
          })()}
        {palette ? (
          <NodePalette
            onAdd={(kind) => addNode(kind, palette.world)}
            onClose={() => setPalette(null)}
            palette={palette}
            native={graphMeta.schemaVersion === 2}
            scoped={graphMeta.authoringVersion === 2}
          />
        ) : null}

        {definitionStack.length > 0 && (
          <div className="studio-definition-banner">
            Referenced graph: {flowName}
            <button onClick={leaveDefinition}>← Back to parent {viewingRun ? '' : '(keep edits)'}</button>
          </div>
        )}
        {settingsOpen && (
          <NativeSettings
            flow={currentFlow()}
            onSave={definitionStack.length === 0 ? (patch) => saveFlow(patch) : undefined}
            onApply={(patch) => {
              const updated = { ...currentFlow(), ...patch };
              setGraphMeta(updated);
              setNodes(refreshNodeConfigurationIssues(updated));
            }}
            onClose={() => setSettingsOpen(false)}
          />
        )}
        {messageOpen && activeRunRef.current && (
          <RunMessage runId={activeRunRef.current} onClose={() => setMessageOpen(false)} />
        )}
        {assistant === 'open' ? <AssistantPanel onClose={() => setAssistant('closed')} /> : null}

        {showRunProgress ? (
          <RunProgressPanel
            childRuns={childRuns}
            completedCount={completedCount}
            events={events}
            nodes={nodes}
            nodeStatuses={nodeStatuses}
            onClose={() => setRunProgressDismissed(true)}
            running={running}
          />
        ) : null}

        {deliverable ? (
          <DeliverablePanel
            deliverable={deliverable}
            onClose={() => setDeliverable(null)}
            sopHref={sopHref}
            workspaceSlug={workspaceSlug}
          />
        ) : null}

        <div className="diagram-inspector-layer" data-diagram-inspector-layer="true">
          {inspectorNode ? (
            <NodeConfigDialog
              key={inspectorNode.id}
              node={inspectorNode}
              events={events}
              flow={currentFlow()}
              readOnly={viewingRun}
              runInput={runInput}
              outputs={nodeOutputs}
              status={nodeStatuses[inspectorNode.id] ?? 'idle'}
              error={
                events
                  .filter(
                    (event): event is Extract<FlowRunEvent, { type: 'node.failed' }> =>
                      event.type === 'node.failed' && event.nodeId === inspectorNode.id,
                  )
                  .at(-1)?.error
              }
              scope={
                events
                  .filter(
                    (event): event is Extract<FlowRunEvent, { type: 'node.completed' }> =>
                      event.type === 'node.completed' && event.nodeId === inspectorNode.id,
                  )
                  .at(-1)?.scope
              }
              metadata={
                events
                  .filter(
                    (event): event is Extract<FlowRunEvent, { type: 'node.completed' }> =>
                      event.type === 'node.completed' && event.nodeId === inspectorNode.id,
                  )
                  .at(-1)?.metadata
              }
              onApply={(draft, input, definitions) => {
                if (definitions) setGraphMeta((old) => ({ ...old, definitions }));
                updateSelectedNode(draft);
                if (draft.config.parameters || draft.config.code)
                  setGraphMeta((old) => ({ ...old, authoringVersion: old.authoringVersion ?? 1 }));
                setRunInput(input);
              }}
              onClose={() => setInspectorNodeId(null)}
              onInspectDefinition={inspectDefinition}
              renderLegacy={(node, onChange) => (
                <NodeInspectorFields
                  node={node}
                  onChange={onChange}
                  models={resources.models}
                  tools={resources.tools}
                  onAddModel={addWorkspaceModel}
                />
              )}
            />
          ) : null}
          {activeAction
            ? (() => {
                const node = nodes.find((n) => n.id === activeAction.nodeId);
                if (!node) return null;
                const Surface = NODE_ACTION_SURFACES[activeAction.actionId];
                return (
                  <Surface
                    ctx={{ escalationsByNodeId }}
                    node={node}
                    onClose={() => setActiveAction(null)}
                    onResolved={handleActionResolved}
                    onStale={() => void loadEscalations()}
                    placement={inspectorPlacement(node, viewport, boardRef.current)}
                    signerName={signerName}
                    workspaceSlug={workspaceSlug}
                  />
                );
              })()
            : null}
        </div>
      </section>
    </main>
  );
}

function PointerHint({ edgeActive, pointer }: { edgeActive: boolean; pointer: PointerHintState }) {
  const { _ } = useLingui();
  const visible = pointer.visible && pointer.target !== null;
  const left =
    pointer.target?.kind === 'node'
      ? { label: _(msg('Select')), opacity: 1 }
      : pointer.target?.kind === 'canvas'
        ? { label: '', opacity: 0.18 }
        : { label: '', opacity: 0.14 };
  const right =
    pointer.target?.kind === 'node'
      ? { label: _(msg('Configure')), opacity: 1 }
      : pointer.target?.kind === 'canvas'
        ? { label: _(msg('Add')), opacity: 1 }
        : { label: '', opacity: 0.14 };
  const shift = edgeActive
    ? { label: _(msg('Drag')), opacity: 1, active: true }
    : pointer.target?.kind === 'node'
      ? { label: _(msg('Edge')), opacity: 1, active: false }
      : { label: '', opacity: 0.14, active: false };

  return (
    <div
      aria-hidden="true"
      className={cn('board-hint', !visible && 'hidden', edgeActive && 'edge-brush-active')}
      data-canvas-cursor-helper="true"
      data-visible={visible ? 'true' : 'false'}
      style={{ left: Math.round(pointer.x), top: Math.round(pointer.y) }}
    >
      <HintItem action={left} button="left" />
      <HintItem action={right} button="right" />
      <span
        className={cn('hint-item shift-item', !shift.label && 'is-muted', shift.active && 'active')}
        style={{ '--hint-opacity': shift.opacity } as React.CSSProperties}
      >
        {shift.active ? (
          <span className="cursor-icon" aria-hidden="true">
            <GitBranch className="size-7" />
          </span>
        ) : (
          <span className="keycap" aria-hidden="true">
            Shift
          </span>
        )}
        <b>{shift.label}</b>
      </span>
    </div>
  );
}

function HintItem({ action, button }: { action: { label: string; opacity: number }; button: 'left' | 'right' }) {
  return (
    <span
      className={cn('hint-item', !action.label && 'is-muted')}
      style={{ '--hint-opacity': action.opacity } as React.CSSProperties}
    >
      <span className={`mouse-icon ${button}`} aria-hidden="true">
        <MouseIcon button={button} />
      </span>
      <b>{action.label}</b>
    </span>
  );
}

function MouseIcon({ button }: { button: 'left' | 'right' }) {
  const fill =
    button === 'left'
      ? 'M6.2 7.1C7.5 5.3 9.4 4.4 12 4.4V11H3.2a8.8 8.8 0 0 1 3-3.9Z'
      : 'M17.8 7.1C16.5 5.3 14.6 4.4 12 4.4V11h8.8a8.8 8.8 0 0 0-3-3.9Z';
  return (
    <svg
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="miter"
      strokeWidth="1.8"
      viewBox="0 0 24 30"
    >
      <path d="M12 1.5c5 0 9 4 9 9v9.5a9 9 0 0 1-18 0v-9.5c0-5 4-9 9-9Z" fill="var(--canvas)" stroke="none" />
      <g>
        <path d="M12 1.5c5 0 9 4 9 9v9.5a9 9 0 0 1-18 0v-9.5c0-5 4-9 9-9Z" />
        <path d="M12 2v9" />
        <path d="M3 11h18" />
        <path d={fill} fill="currentColor" />
      </g>
    </svg>
  );
}

function projectWorkflowNode(node: FlowNodeData): CanvasNode {
  const meta = nodePalette.find((item) => item.kind === node.kind) ?? nodePalette[0];
  return {
    id: node.id,
    kind: node.kind,
    name: node.name,
    description: node.description || meta.description,
    position: node.position,
    size: getNodeSize(node.kind),
    icon: meta.icon,
    color: meta.color,
    bg: meta.bg,
    chips: nodeChips(node),
    body: <NodeInlineBody node={node} />,
    readiness: node.config.issues?.length
      ? `Needs configuration · ${node.config.issues.length} issues`
      : !(node.config.operation || node.config.code || node.config.parameters || node.kind === 'trigger')
        ? 'Needs configuration'
        : undefined,
  };
}
function NodeInlineBody({ node }: { node: FlowNodeData }) {
  if (node.kind === 'llm') {
    return (
      <div className="agent42-node-body">
        <NodeChip icon={KeyRound} label={node.config.model || 'workspace model'} />
        <button className={nodeActionClass} data-board-nodrag="true" type="button">
          <Database className="size-4" />
          <Trans>Knowledge</Trans>
        </button>
        <button className={nodeActionClass} data-board-nodrag="true" type="button">
          <Wrench className="size-4" />
          <Trans>Tools</Trans>
        </button>
      </div>
    );
  }
  if (node.kind === 'tool') {
    return (
      <div className="agent42-node-body">
        <NodeChip icon={Database} label={node.config.toolName || 'tool'} />
        <button className={nodeActionClass} data-board-nodrag="true" type="button">
          <Database className="size-4" />
          <Trans>Attach base</Trans>
        </button>
      </div>
    );
  }
  if (node.kind === 'output') {
    return (
      <div className="agent42-node-preview">
        <span>
          <Trans>Formatted</Trans>
        </span>
        <p>
          <Trans>Final response appears after a run.</Trans>
        </p>
      </div>
    );
  }
  const summary = node.config.prompt || node.config.label || node.config.expression || node.config.approvalMessage;
  if (!summary?.trim()) return null;
  return (
    <div className="agent42-node-preview">
      <p>{summary}</p>
    </div>
  );
}

function NodeChip({ icon: Icon, label }: { icon: typeof Database; label: string }) {
  return (
    <span className="agent42-node-chip">
      <Icon className="size-4" />
      <span>{label}</span>
    </span>
  );
}

function NodePalette({
  onAdd,
  onClose,
  palette,
  native = false,
  scoped = false,
}: {
  onAdd: (kind: FlowNodeKind) => void;
  onClose: () => void;
  palette: NonNullable<PaletteState>;
  native?: boolean;
  scoped?: boolean;
}) {
  const [query, setQuery] = useState('');
  const items = nodePalette
    .filter(
      (item) =>
        (!['construct', 'merge'].includes(item.kind) || scoped) &&
        !(scoped && ['assign', 'review'].includes(item.kind)),
    )
    .filter((item) =>
      native
        ? ['construct', 'merge', 'trigger', 'code', 'setVariables'].includes(item.kind) ||
          nativeKinds.includes(item.kind as NativeKind)
        : !nativeKinds.includes(item.kind as NativeKind),
    )
    .filter((item) =>
      `${item.label} ${item.description} ${nodeClassification(item.kind)}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    );
  const groups = native
    ? [
        { label: 'Operations', classification: 'operation' },
        { label: 'Control structures', classification: 'control' },
        { label: 'Workflow invocation', classification: 'invocation' },
        { label: 'Entry point', classification: 'entry' },
        { label: 'Legacy compositions', classification: 'legacy-composition' },
      ]
        .map((group) => ({
          ...group,
          items: items.filter((item) => nodeClassification(item.kind) === group.classification),
        }))
        .filter((group) => group.items.length)
    : [{ label: 'Nodes', items }];
  const width = typeof window === 'undefined' ? 400 : Math.min(400, window.innerWidth - 24);
  const left = clamp(palette.x, 12, typeof window === 'undefined' ? palette.x : window.innerWidth - width - 12);
  const top = clamp(
    palette.y,
    12,
    typeof window === 'undefined'
      ? palette.y
      : Math.max(12, window.innerHeight - Math.min(600, window.innerHeight - 24) - 12),
  );
  return (
    <ModalOverlay
      isOpen
      isDismissable
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className="canvas-catalogue-overlay"
    >
      <Modal className="canvas-catalogue-modal" style={{ left, top, width }}>
        <Dialog aria-label="Add node" className="canvas-node-catalogue">
          <header>
            <div>
              <h2>Add node</h2>
              <p>Choose an operation or control structure.</p>
            </div>
            <UiButton color="tertiary" iconLeading={CloseIcon} aria-label="Close node catalogue" onPress={onClose} />
          </header>
          <div className="canvas-catalogue-search">
            <ControlInput
              autoFocus
              aria-label="Search nodes"
              placeholder="Search nodes…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <small role="status">
              {items.length} {items.length === 1 ? 'node' : 'nodes'}
            </small>
          </div>
          <div className="canvas-catalogue-list">
            {groups.map((group) => (
              <section key={group.label} aria-label={group.label}>
                <h3>{group.label}</h3>
                {group.items.map((item) => (
                  <UiButton
                    key={item.kind}
                    color="tertiary"
                    className="canvas-catalogue-item"
                    onPress={() => onAdd(item.kind)}
                  >
                    <span className="canvas-catalogue-icon">
                      {nodeClassification(item.kind) === 'control' || nodeClassification(item.kind) === 'invocation' ? (
                        <WorkflowIcon />
                      ) : (
                        <OperationIcon />
                      )}
                    </span>
                    <span className="canvas-catalogue-copy">
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </span>
                    <AddIcon className="canvas-catalogue-add" />
                  </UiButton>
                ))}
              </section>
            ))}
            {!items.length && (
              <p className="canvas-catalogue-empty">No nodes match “{query}”. Try an operation name or description.</p>
            )}
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function AssistantPanel({ onClose }: { onClose: () => void }) {
  return (
    <aside className="floating-panel editor-agent-panel" aria-label="DBOS execution help">
      <button aria-label="Close help" className="agent-close" onClick={onClose}>
        <X className="size-4" />
      </button>
      <div className="agent42-assistant">
        <h2>Durable graph execution</h2>
        <p>
          Save your graph, enter input in the Start inspector, then run it. Durable operations use DBOS checkpoints and
          workflow APIs.
        </p>
        <p>
          Native graphs support child workflows, bounded loops, transactions, messages and durable waits. Open a
          referenced graph in its node inspector; open child executions from Run progress.
        </p>
        <p>
          Workflow settings configures variables, queues and schedules. Send message resumes a native receive node.
          Example infrastructure and email handlers run locally; real integrations require registered server adapters.
          Legacy approval graphs keep their Resolve action.
        </p>
        <Link href="/">View saved workflows and runs →</Link>
      </div>
    </aside>
  );
}

function NodeInspectorFields({
  onInspectDefinition,
  models,
  node,
  nodeOutput,
  onAddModel,
  onChange,
  tools,
}: {
  onInspectDefinition?: (ref: string) => void;
  models: WorkspaceModelProfile[];
  node: FlowNodeData;
  nodeOutput?: unknown;
  onAddModel: () => void;
  onChange: (patch: Partial<FlowNodeData>) => void;
  tools: WorkspaceToolProfile[];
}) {
  const { _ } = useLingui();
  const config = node.config || {};
  const [promptAssets, setPromptAssets] = useState<WorkspacePromptAsset[]>([]);
  const [promptAssetsState, setPromptAssetsState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  useEffect(() => {
    let mounted = true;
    setPromptAssetsState('loading');
    fetch('/api/prompts', { credentials: 'include' })
      .then((response) => {
        if (!response.ok) throw new Error('Failed to load prompts.');
        return response.json();
      })
      .then((payload: WorkspacePromptAsset[]) => {
        if (!mounted) return;
        setPromptAssets(payload);
        setPromptAssetsState('ready');
      })
      .catch(() => {
        if (!mounted) return;
        setPromptAssetsState('error');
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (node.config.operation)
    return <NativeNodeFields key={node.id} node={node} onChange={onChange} onInspectDefinition={onInspectDefinition} />;
  return (
    <div className="inspector-config-section">
      <h3>
        <Trans>Configuration</Trans>
      </h3>
      {config.sourceRef ? (
        <span
          className="inline-flex w-fit items-center gap-1 rounded-none border border-[#e7e9ee] bg-[#f7f8fa] px-2 py-0.5 font-mono text-[#6e7c93] text-[11px]"
          title="Source paragraphs cited by the SOP compiler"
        >
          <Trans>¶ {config.sourceRef.paragraphs.join(', ')}</Trans>
        </span>
      ) : null}
      <div className="inspector-config-grid">
        {['prompt', 'llm'].includes(node.kind) ? (
          <label className="config-input full">
            <span>
              <Trans>Attach prompt</Trans>
            </span>
            <select
              disabled={promptAssetsState === 'loading'}
              onChange={(event) => {
                if (!event.target.value) {
                  onChange({
                    config: {
                      promptAssetId: undefined,
                      promptAssetName: undefined,
                      promptAssetVersion: undefined,
                    },
                  });
                  return;
                }
                const asset = promptAssets.find((item) => item.id === event.target.value);
                if (!asset) return;
                onChange({
                  config: {
                    prompt: asset.content,
                    promptAssetId: asset.id,
                    promptAssetName: asset.name,
                    promptAssetVersion: asset.version,
                  },
                });
              }}
              value={config.promptAssetId || ''}
            >
              <option value="">
                {promptAssetsState === 'loading'
                  ? _(msg('Loading prompts...'))
                  : promptAssetsState === 'ready' && promptAssets.length === 0
                    ? _(msg('No workspace prompts yet'))
                    : _(msg('No attachment'))}
              </option>
              {promptAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name} (v{asset.version})
                </option>
              ))}
            </select>
            {config.promptAssetId ? (
              <span className="inline-flex w-fit items-center gap-1 rounded-none border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">
                <Trans>
                  from {config.promptAssetName} v{config.promptAssetVersion}
                </Trans>
              </span>
            ) : null}
          </label>
        ) : null}
        {['prompt', 'llm'].includes(node.kind) ? (
          <label className="config-input full">
            <span>
              <Trans>Prompt</Trans>
            </span>
            <Textarea
              onChange={(event) => onChange({ config: { prompt: event.target.value } })}
              rows={4}
              value={config.prompt || ''}
            />
          </label>
        ) : null}

        {node.kind === 'llm' ? (
          <>
            <label className="config-input full">
              <span className="flex items-center justify-between">
                <Trans>Workspace model</Trans>
                <button className="agent42-link-button" onClick={onAddModel} type="button">
                  <Trans>Add model</Trans>
                </button>
              </span>
              <select
                onChange={(event) => {
                  const model = models.find((item) => item.id === event.target.value);
                  onChange({
                    config: {
                      modelProfileId: event.target.value,
                      model: model?.modelId || config.model,
                    },
                  });
                }}
                value={config.modelProfileId || models.find((item) => item.isDefault)?.id || models[0]?.id || ''}
              >
                {!models.length && <option value="">No model adapter registered</option>}
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name} - {model.modelId}
                  </option>
                ))}
              </select>
            </label>
            <label className="config-input">
              <span>
                <Trans>Temperature</Trans>
              </span>
              <Input
                inputMode="decimal"
                onChange={(event) => onChange({ config: { temperature: event.target.value } })}
                placeholder={_(msg('workspace default'))}
                value={config.temperature || ''}
              />
            </label>
            <label className="config-input">
              <span>
                <Trans>Max tokens</Trans>
              </span>
              <Input
                inputMode="numeric"
                onChange={(event) => onChange({ config: { maxTokens: event.target.value } })}
                placeholder={_(msg('workspace default'))}
                value={config.maxTokens || ''}
              />
            </label>
          </>
        ) : null}

        {node.kind === 'tool' ? (
          <>
            <ConnectorOperationFields
              onChange={(nextConfig) => onChange({ config: nextConfig })}
              tools={tools}
              value={config}
            />
            <div className="full flex items-center gap-3 text-slate-400 text-xs">
              <span className="h-px flex-1 bg-slate-200" />
              Registered tools
              <span className="h-px flex-1 bg-slate-200" />
            </div>
            <label className="config-input full">
              <span>
                <Trans>Tool name</Trans>
              </span>
              <select
                onChange={(event) => {
                  const tool = tools.find((item) => item.id === event.target.value);
                  onChange({
                    config: {
                      toolId: event.target.value || undefined,
                      toolName: tool?.name || '',
                    },
                  });
                }}
                value={config.toolId || tools.find((tool) => tool.name === config.toolName)?.id || ''}
              >
                <option value="">{_(msg('Select workspace tool'))}</option>
                {tools.map((tool) => (
                  <option key={tool.id} value={tool.id}>
                    {tool.name} - {tool.kind}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}

        {node.kind === 'condition' ? (
          <label className="config-input full">
            <span>
              <Trans>Condition expression</Trans>
            </span>
            <Input
              onChange={(event) => onChange({ config: { expression: event.target.value } })}
              placeholder={_(msg('true, false, has input'))}
              value={config.expression || ''}
            />
          </label>
        ) : null}

        {node.kind === 'approval' ? (
          <label className="config-input full">
            <span>
              <Trans>Approval message</Trans>
            </span>
            <Textarea
              onChange={(event) => onChange({ config: { approvalMessage: event.target.value } })}
              rows={3}
              value={config.approvalMessage || ''}
            />
          </label>
        ) : null}

        {node.kind === 'output' ? (
          <label className="config-input full">
            <span>
              <Trans>Output key</Trans>
            </span>
            <Input
              onChange={(event) => onChange({ config: { outputKey: event.target.value } })}
              value={config.outputKey || ''}
            />
          </label>
        ) : null}

        {nodeOutput !== undefined ? (
          <label className="config-input full">
            <span>
              <Trans>Last output</Trans>
            </span>
            <pre className="max-h-48 overflow-auto rounded-none bg-[#f6f8fb] p-3 text-[11px]">
              {JSON.stringify(nodeOutput, null, 2)}
            </pre>
          </label>
        ) : null}
      </div>
    </div>
  );
}

function DeliverablePanel({
  deliverable,
  onClose,
  sopHref,
  workspaceSlug,
}: {
  deliverable: { title: string; content: string };
  onClose: () => void;
  sopHref?: string;
  workspaceSlug?: string;
}) {
  const { _ } = useLingui();
  const title = deliverable.title || _(msg('Deliverable'));
  const handbookHref = sopHref ?? (workspaceSlug ? `/dashboard/${workspaceSlug}/handbook` : undefined);
  return (
    <aside aria-label={_(msg('Deliverable'))} className="floating-panel agent42-deliverable-panel">
      <button aria-label={_(msg('Close'))} className="agent-close" onClick={onClose} type="button">
        <X className="size-4" />
      </button>
      <div className="panel-title">
        <b>{title}</b>
      </div>
      <div className="agent42-deliverable-body">
        <SopMarkdown text={deliverable.content} />
      </div>
      {handbookHref ? (
        <div className="agent42-deliverable-footer">
          <Link className="agent42-deliverable-link" href={handbookHref}>
            <Trans>View in Handbook</Trans>
          </Link>
        </div>
      ) : null}
    </aside>
  );
}

function RunProgressPanel({
  childRuns,
  completedCount,
  events,
  nodes,
  nodeStatuses,
  onClose,
  running,
}: {
  childRuns: { id: string; flow_id: string; flow_name: string; parent_node_id: string; status: string }[];
  completedCount: number;
  events: FlowRunEvent[];
  nodes: FlowNodeData[];
  nodeStatuses: Record<string, FlowNodeStatus>;
  onClose: () => void;
  running: boolean;
}) {
  const { _ } = useLingui();
  const last = events.at(-1);
  const control = [...events]
    .reverse()
    .find((event) => ['run.started', 'run.resumed', 'run.waiting', 'run.completed', 'run.failed'].includes(event.type));
  const executing = control ? ['run.started', 'run.resumed'].includes(control.type) : running;

  return (
    <aside className="floating-panel agent42-run-panel">
      <div className="panel-title">
        <b>
          <Trans>Run progress</Trans>
        </b>
        <div className="agent42-run-header-actions">
          <span className={cn('agent42-run-state', executing ? 'running' : 'done')}>
            {executing ? (
              <Trans>Running</Trans>
            ) : control?.type === 'run.waiting' ? (
              <Trans>Waiting</Trans>
            ) : control?.type === 'run.completed' ? (
              <Trans>Completed</Trans>
            ) : control?.type === 'run.failed' ? (
              <Trans>Failed</Trans>
            ) : (
              <Trans>Disconnected</Trans>
            )}
          </span>
          <button
            aria-label={_(msg('Close run progress'))}
            className="agent42-run-close"
            onClick={onClose}
            title={_(msg('Close run progress'))}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
      <div className="agent42-run-list">
        {nodes.map((node) => {
          const status = nodeStatuses[node.id] || 'idle';
          const tone = nodePalette.find((item) => item.kind === node.kind) ?? nodePalette[0];
          const Icon = tone.icon;
          return (
            <div className="agent42-run-row" key={node.id}>
              <span
                style={
                  {
                    '--node-bg': tone.bg,
                    '--node-color': tone.color,
                  } as React.CSSProperties
                }
              >
                <Icon className="size-4" />
              </span>
              <b>{node.name}</b>
              <StatusIcon status={status} />
            </div>
          );
        })}
      </div>
      {childRuns.length > 0 && (
        <div className="studio-child-runs">
          <b>Child executions ({childRuns.length})</b>
          {childRuns.map((child) => (
            <a
              key={child.id}
              href={`/flows?flow=${encodeURIComponent(child.flow_id)}&run=${encodeURIComponent(child.id)}`}
              target="_blank"
              rel="noreferrer"
            >
              {child.flow_name} · {child.status}
              <small>
                {child.parent_node_id} / {child.id.slice(0, 10)}
              </small>
            </a>
          ))}
        </div>
      )}
      {last?.type === 'run.completed' && (
        <section className="studio-run-result" aria-label="Workflow result">
          <b>Result</b>
          <pre>{JSON.stringify('result' in last.output ? last.output.result : last.output, null, 2)}</pre>
        </section>
      )}
      <div className="agent42-run-footer">
        <span>
          <Trans>Events</Trans>: {events.length}
        </span>
        <span>
          {completedCount}/{nodes.length} <Trans>completed</Trans>
        </span>
      </div>
    </aside>
  );
}

function StatusIcon({ status }: { status: FlowNodeStatus }) {
  if (status === 'running') return <Loader2 className="size-4 animate-spin text-amber-600" />;
  if (status === 'failed') return <X className="size-4 text-rose-600" />;
  if (status === 'skipped') return <Minus className="size-4 text-slate-400" />;
  if (status === 'waiting') return <Hourglass className="size-4 text-amber-600" />;
  if (status === 'succeeded') return <CheckCircle2 className="size-4 text-emerald-600" />;
  return <Circle className="size-4 text-[#c2c7d0]" />;
}

function edgeEndpoints(edge: FlowEdgeData, source: FlowNodeData, target: FlowNodeData) {
  const sourceSide = edge.sourceHandle || 'right';
  const targetSide = edge.targetHandle || 'left';
  return {
    source: handlePoint(source, sourceSide),
    target: handlePoint(target, targetSide),
    sourceSide,
    targetSide,
  };
}

function handlePoint(node: FlowNodeData, side: HandleSide) {
  const size = getNodeSize(node.kind);
  const x = node.position.x;
  const y = node.position.y;
  if (side === 'top') return { x: x + size.width / 2, y };
  if (side === 'bottom') return { x: x + size.width / 2, y: y + size.height };
  if (side === 'left') return { x, y: y + size.height / 2 };
  return { x: x + size.width, y: y + size.height / 2 };
}

function closestHandleSide(node: FlowNodeData, point: Point): HandleSide {
  const candidates = (['top', 'right', 'bottom', 'left'] as HandleSide[]).map((side) => {
    const handle = handlePoint(node, side);
    return {
      distance: Math.hypot(point.x - handle.x, point.y - handle.y),
      side,
    };
  });
  return candidates.sort((a, b) => a.distance - b.distance)[0]?.side || 'right';
}

function isHandleSide(value: string | undefined): value is HandleSide {
  return value === 'top' || value === 'right' || value === 'bottom' || value === 'left';
}

function getPointerTarget(element: HTMLElement): PointerTarget {
  const node = element.closest('[data-node-id]') as HTMLElement | null;
  if (node?.dataset.nodeId) return { kind: 'node', nodeId: node.dataset.nodeId };
  if (element.closest('.board')) return { kind: 'canvas' };
  return null;
}

const getNodeSize = workflowNodeSize;

function inspectorPlacement(node: FlowNodeData, viewport: Viewport, board: HTMLDivElement | null) {
  const rect = board?.getBoundingClientRect();
  const width = rect?.width ?? window.innerWidth;
  const height = rect?.height ?? window.innerHeight;
  const size = getNodeSize(node.kind);
  const nodeRight = width / 2 + viewport.x + (node.position.x + size.width) * viewport.zoom;
  const nodeLeft = width / 2 + viewport.x + node.position.x * viewport.zoom;
  const nodeMidY = height / 2 + viewport.y + (node.position.y + size.height / 2) * viewport.zoom;
  const panelWidth = 420;
  const panelHeight = Math.min(640, height - 72);
  const side = nodeRight + panelWidth + 42 < width ? 'right' : 'left';
  const left = side === 'right' ? nodeRight + 30 : Math.max(16, nodeLeft - panelWidth - 30);
  const top = clamp(nodeMidY - panelHeight / 2, 18, Math.max(18, height - panelHeight - 18));
  return {
    left,
    top,
    side,
    connectorY: clamp(nodeMidY - top, 38, panelHeight - 38),
  } as const;
}

function nodeChips(node: FlowNodeData) {
  const config = node.config || {};
  const chips: string[] = [];
  const operation = config.operation;
  if (operation) {
    if ('handler' in operation) chips.push(operation.handler);
    if ('workflowRef' in operation) chips.push(operation.workflowRef);
    if ('mode' in operation) chips.push(operation.mode);
    if ('topic' in operation) chips.push(operation.topic);
    if ('key' in operation) chips.push(operation.key);
    if ('queueRef' in operation && operation.queueRef) chips.push(`queue: ${operation.queueRef}`);
    if (operation.kind === 'loop') chips.push(`max ${operation.maxIterations} iterations`);
  }
  if (node.kind === 'trigger' && config.label) chips.push(config.label);
  if (node.kind === 'prompt' && config.prompt) chips.push('prompt');
  if (node.kind === 'llm' && config.model) chips.push(config.model);
  if (node.kind === 'tool' && config.toolName) chips.push(config.toolName);
  if (node.kind === 'condition' && config.expression) chips.push(config.expression);
  if (node.kind === 'approval' && config.approvalMessage) chips.push('approval');
  if (node.kind === 'output' && config.outputKey) chips.push(config.outputKey);
  return chips.slice(0, 3);
}

function defaultConfig(kind: FlowNodeKind): FlowNodeConfig {
  if (kind === 'code')
    return { code: defaultCode(), parameters: { input: { mode: 'expression', expression: '$input.variables' } } };
  if (kind === 'construct' || kind === 'merge')
    return {
      parameters: { value: { mode: 'object', fields: {} } },
      ...(kind === 'merge' ? { merge: { updates: [] } } : {}),
    };
  if (kind === 'setVariables') return { parameters: { values: { mode: 'object', fields: {} } } };
  if (nativeKinds.includes(kind as NativeKind)) {
    const operation = defaultOperation(kind as NativeKind);
    if (operation.kind === 'parallel')
      operation.branches = operation.branches.map((b, i) => ({
        ...b,
        id: crypto.randomUUID(),
        name: `Branch ${i + 1}`,
      }));
    return { operation };
  }
  if (kind === 'prompt') {
    return { prompt: 'Rewrite this input as a clear task: {{userInput}}' };
  }
  if (kind === 'llm') {
    return {
      model: '',
      modelProfileId: '',
      prompt: 'Complete the current task.',
    };
  }
  if (kind === 'tool') {
    return {
      toolId: 'echo',
      toolName: 'Echo input',
    };
  }
  if (kind === 'condition') return { expression: 'has input' };
  if (kind === 'approval') return { approvalMessage: 'Review and approve this step.' };
  if (kind === 'output') return { outputKey: 'final' };
  return { label: 'Manual run' };
}

function truncate(value: string, max: number) {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}...`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function uid(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
