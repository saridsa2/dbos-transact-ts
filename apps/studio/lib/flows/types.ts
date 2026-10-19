import type { Declaration, Port, Merge, ScopeSnapshot } from '../authoring/contracts';
import type { Parameter, CodeDefinition } from '../authoring/model';
import type { NativeOperation, NativeKind, QueueResource, ScheduleResource } from '../native/model';
export type FlowNodeKind =
  | 'trigger'
  | 'prompt'
  | 'llm'
  | 'tool'
  | 'condition'
  | 'approval'
  | 'output'
  | NativeKind
  | 'code'
  | 'setVariables'
  | 'construct'
  | 'merge';

export type FlowNodeStatus = 'idle' | 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'skipped';

export type FlowNodeConfig = {
  issues?: string[];
  offering?: { id: string; version: number };
  ports?: { input?: Port; output?: Port };
  merge?: Merge;
  authoredKind?: FlowNodeKind;
  compiledUpdates?: Record<string, import('../native/model').Binding>;
  parameters?: Record<string, Parameter>;
  code?: CodeDefinition;
  variableAssignment?: boolean;
  runtimeFields?: Record<string, import('../native/model').Binding>;
  operation?: NativeOperation;
  operationDraft?: string;
  execution?: { maxAttempts?: number; intervalSeconds?: number; timeoutMS?: number };
  label?: string;
  prompt?: string;
  model?: string;
  modelProfileId?: string;
  temperature?: string;
  maxTokens?: string;
  toolId?: string;
  capabilityId?: string;
  connectorConnectionId?: string;
  connectorKey?: string;
  connectorVersion?: string;
  connectorResource?: string;
  connectorOperation?: string;
  connectorEnvironment?: string;
  connectorRisk?: 'read' | 'write';
  connectorSchemaVersion?: string;
  connectorInput?: Record<string, string | number | boolean>;
  toolName?: string;
  // HTTP method for an unconfigured tool node awaiting a real binding (see
  // lib/provision/plan.ts's classifyNodesForProvisioning) — defaults to
  // "GET" when unset. Bound tools (config.toolId set) get their method from
  // the workspace tool's own http metadata instead (lib/flows/http-tool.ts).
  method?: string;
  // Names an upstream node (already-namespaced node id, e.g. "step-xyz") whose
  // output should be resolved into a structured object and sent as the tool's
  // input, instead of the rendered-string prompt path. Only meaningful on
  // `tool` nodes — see executeToolNode in lib/flows/executor.ts (contract B3)
  // and assembleFlow's `inputFrom` -> `inputFromNodeId` mapping in
  // lib/workers/compile-schema.ts (contract B2).
  inputFromNodeId?: string;
  expression?: string;
  approvalMessage?: string;
  approvalReusePolicy?: 'single-use' | 'reusable';
  approvalPolicyVersion?: string;
  outputKey?: string;
  promptAssetId?: string;
  promptAssetName?: string;
  promptAssetVersion?: number;
  escalationKind?: 'approval' | 'human_task' | 'referral';
  actorKey?: string;
  groundingKey?: string;
  groundingCapabilityId?: string;
  sourceRef?: { documentId: string; paragraphs: number[] };
  // Referral-kind escalation nodes only: the SOP handbook(s) whose owner
  // directory (handbook_owners) the executor's matchOwner should search
  // against. Stamped at onboard/compile time (see
  // lib/workers/create-from-document.ts and app/api/workers/route.ts's
  // onboardFromTemplate) — assembleFlow itself always emits an empty array
  // since it doesn't know the worker's SOP handbook id.
  directoryHandbookIds?: string[];
  // "model" routes a condition node through the injected `judge` (real LLM
  // evaluation, see lib/flows/judge.ts); "legacy"/unset keeps the existing
  // keyword-stub `evaluateCondition` in lib/flows/executor.ts. Back-compat:
  // graphs authored before this option existed keep working unchanged.
  conditionMode?: 'legacy' | 'model';
};

export type FlowNodeData = {
  id: string;
  kind: FlowNodeKind;
  name: string;
  description?: string;
  config: FlowNodeConfig;
  position: {
    x: number;
    y: number;
  };
};

export type FlowEdgeData = {
  id: string;
  source: string;
  target: string;
  sourcePort?: 'value';
  targetPort?: 'input';
  sourceHandle?: 'top' | 'right' | 'bottom' | 'left';
  targetHandle?: 'top' | 'right' | 'bottom' | 'left';
  label?: string;
  condition?: 'true' | 'false' | 'always' | 'success' | 'error' | 'timeout';
};

export type AgentFlow = {
  authoringVersion?: 1 | 2;
  declarations?: Declaration[];
  captures?: { id: string; name: string; schema: Record<string, unknown> }[];
  diagnostics?: { path: string; message: string }[];
  variables?: Record<string, Parameter>;
  _compiled?: { version: 1 | 2; variables: Record<string, import('../native/model').Binding> };
  workspaceId?: string;
  schemaVersion?: 1 | 2;
  _runtime?: { queues: { name: string; options: Omit<QueueResource, 'key'> }[] };
  definitions?: Record<string, AgentFlow>;
  queues?: QueueResource[];
  schedule?: ScheduleResource;
  defaultInput?: FlowExecutionInput;
  sourceReference?: string;
  id: string;
  name: string;
  description?: string;
  nodes: FlowNodeData[];
  edges: FlowEdgeData[];
  createdAt?: string;
  updatedAt?: string;
};

export type FlowProjectSummary = {
  id: string;
  name: string;
  description?: string | null;
  status: 'draft' | 'active' | 'archived';
  nodeCount: number;
  edgeCount: number;
  runCount: number;
  interfaceCount: number;
  lastRunStatus?: FlowRunStatus | null;
  createdAt: string;
  updatedAt: string;
};

export type FlowInterfaceType = 'form' | 'chat' | 'batch' | 'api' | 'slack' | 'website';

export type FlowInterfaceSummary = {
  id: string;
  flowId: string;
  flowName: string;
  name: string;
  type: FlowInterfaceType | string;
  status: 'draft' | 'published' | 'disabled' | string;
  access: 'private' | 'workspace' | 'public' | string;
  slug?: string | null;
  publishedAt?: string | null;
  updatedAt: string;
};

export type FlowRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'waiting';

export type FlowRunEvent =
  | {
      type: 'run.started';
      runId: string;
      flowId: string;
      timestamp: string;
    }
  | {
      type: 'node.started';
      runId: string;
      nodeId: string;
      nodeName: string;
      nodeKind: FlowNodeKind;
      timestamp: string;
    }
  | {
      type: 'node.completed';
      scope?: ScopeSnapshot;
      presence?: 'present' | 'absent';
      metadata?: { logs: string[]; revision: string };
      runId: string;
      nodeId: string;
      nodeName: string;
      nodeKind: FlowNodeKind;
      output: unknown;
      timestamp: string;
    }
  | {
      type: 'node.skipped';
      runId: string;
      nodeId: string;
      reason: string;
      timestamp: string;
    }
  | {
      type: 'node.failed';
      runId: string;
      nodeId: string;
      nodeName: string;
      nodeKind: FlowNodeKind;
      error: string;
      timestamp: string;
    }
  | {
      type: 'node.waiting';
      runId: string;
      nodeId: string;
      nodeName: string;
      nodeKind: FlowNodeKind;
      instruction: string;
      timestamp: string;
    }
  | {
      type: 'run.completed';
      runId: string;
      flowId: string;
      output: Record<string, unknown>;
      deliverable?: { title: string; content: string };
      timestamp: string;
    }
  | {
      type: 'run.failed';
      runId: string;
      flowId: string;
      error: string;
      timestamp: string;
    }
  | {
      type: 'run.waiting';
      runId: string;
      flowId: string;
      nodeId: string;
      timestamp: string;
    }
  | {
      type: 'run.resumed';
      runId: string;
      flowId: string;
      nodeId: string;
      timestamp: string;
    };

export type FlowExecutionInput = {
  _scope?: { captures: Record<string, unknown>; item?: unknown; index?: number };
  userInput?: string;
  variables?: Record<string, unknown>;
};

export type FlowRunSummary = {
  id: string;
  flowId?: string | null;
  flowName: string;
  status: FlowRunStatus;
  startedAt: string;
  completedAt?: string | null;
  durationMs?: number | null;
  eventCount: number;
  input?: FlowExecutionInput | null;
  output?: Record<string, unknown> | null;
  error?: string | null;
};

export type FlowRunEventSummary = {
  id: string;
  sequence: number;
  event: FlowRunEvent;
  createdAt: string;
};

export type FlowRunDetail = FlowRunSummary & {
  events: FlowRunEventSummary[];
};

export type EscalationStatus = 'open' | 'approved' | 'rejected' | 'done';

export type EscalationSummary = {
  id: string;
  runId: string;
  flowId: string | null;
  flowName: string;
  runStatus: FlowRunStatus | 'unknown';
  nodeId: string;
  nodeName: string;
  kind: string;
  instruction: string | null;
  status: EscalationStatus;
  note: string | null;
  assigneeLabel: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
};
