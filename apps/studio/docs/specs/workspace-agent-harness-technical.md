# Stack Proc workspace agent harness technical specification

> Superseded runtime decision (2026-10-19): the user selected an owned source port. See [the current implementation contract](workspace-harness-port.md). Harness2 requirements below are historical and are not the active runtime direction.

Status: proposed implementation contract, 2026-10-19. Implements the accepted [ambient harness architecture](workspace-agent-harness.md). This document specifies code boundaries, storage, transactions, protocols and verification; it does not claim these components have shipped.

## 1. Implementation scope and fixed decisions

Build in `apps/studio` using the current Node HTTP service, Postgres application database, existing DBOS installation, Zod/AJV validation, credential broker and shared workspace SSE. MiniMax is the only production reasoning provider in V1. Keep the existing `wi_tasks` document-analysis path operational while adding `/api/agent/*`.

V1 delivers persistent sessions, bounded durable work items, deterministic workspace tools, explicit proposals and ambient event handling using actual Harness2 refinement and its supported OpenCode execution substrate with MiniMax. The previous custom MiniMax turn loop is legacy and must be replaced through the [required Harness2 cutover](harness2-cutover.md). No browser-hosted agent, parallel mutation workers, automatic publication or model-authored tool installation.

Core identities use host-generated UUID strings compatible with `lib/knowledge/contracts.ts:id`. Provider call IDs are separate bounded strings; they never become database authority. Timestamps use Postgres `timestamptz`, hashes use existing canonical JSON/SHA-256, edit versions use positive integers and JSON contracts carry `schemaVersion: 1`.

### Corrections and refinements to the architecture

- `cp_workspace_events` currently uses a per-workspace advisory transaction lock, deliberately aligning its cursor order with commits. Preserve that guarantee. The agent still uses its own transactional domain outbox and per-event delivery records; it does not depend on browser delivery or assume the same ordering for future external producers.
- Existing `KnowledgeStore.save()` and `StudioStore.saveFlow()` own transactions. Agent application cannot call them independently and claim atomic multi-artifact commits. Extract transaction-aware operations first.
- The current Microsoft RDF parser requires `DOMParser` and DOM query APIs. A Node HTTP route cannot directly invoke it without a tested parser environment or extraction of its XML traversal behind an adapter.
- The existing MiniMax adapter returns a final analysis object. Tool-loop continuation needs a distinct protocol adapter, not repeated calls to `generate()`.

## 2. Services and module boundaries

| Module                     | Public responsibility                                                        | May not do                                             |
| -------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------ |
| `AgentService`             | Session/message/decision commands, authorization, idempotency                | Call MiniMax inline from an HTTP command               |
| `AgentStore`               | Workspace-scoped queries, state transitions, leases and append-only activity | Infer grants from model text                           |
| `AgentCoordinator`         | Dispatch outbox, coalesce events, claim work and schedule activations        | Run reasoning in a polling timer                       |
| `AgentRuntime`             | DBOS activation and upstream executor lifecycle adapter                      | Read browser state or silently replace user drafts     |
| `ContextBuilder`           | Authorized retrieval and immutable manifests                                 | Treat summaries as source truth                        |
| `AgentToolRegistry`        | Versioned definitions and handlers                                           | Resolve arbitrary model-provided module paths          |
| `ToolDispatcher`           | Validate, authorize, reserve, execute and observe                            | Bypass service validation for agent calls              |
| `ChangeApplicationService` | CAS validation and atomic application with receipts                          | Own external API calls inside its database transaction |
| `AgentModelAdapter`        | Normalize MiniMax protocol and usage                                         | Execute requested tools                                |
| `HarnessEvaluator`         | Compare pinned baseline/candidate traces and adoption criteria               | Modify production grants or tool implementations       |

Construct services through dependency injection in `server/index.ts`. Register DBOS workflows before `DBOS.launch()`. Agent initialization follows control and knowledge initialization. Reconciliation starts only after launch. Shutdown stops claiming new work, aborts active HTTP transports, releases resources and lets DBOS recover persisted work.

Proposed entry points:

```ts
createAgentServices({ control, knowledge, studio, nodeRegistry, modelAdapter, payloadStore });
createAgentRuntime(agentServices);
agentRoutes(agentServices, bodyReaders, json);
```

Use injected clocks, transport, tool handlers and IDs in tests. A fixture adapter is selected only through the isolated integration service, never from user-supplied graph or request JSON.

## 3. Shared TypeScript contracts

Put strict Zod schemas and inferred public types in `lib/agent/contracts.ts`; do not duplicate unvalidated UI interfaces.

```ts
type ResourceRef =
  | { kind: 'source' | 'ontology' | 'process'; id: string; revisionId: string; hash: string }
  | { kind: 'workflow'; id: string; editVersion: number; hash: string }
  | { kind: 'run'; id: string; snapshotHash: string }
  | { kind: 'editor_draft'; attachmentId: string; editorVersion: number; hash: string };

type WorkState =
  | 'queued'
  | 'preparing'
  | 'reasoning'
  | 'executing_tool'
  | 'waiting_for_user'
  | 'waiting_for_event'
  | 'ready_for_review'
  | 'applying'
  | 'completed'
  | 'conflicted'
  | 'cancelled'
  | 'failed'
  | 'uncertain'
  | 'budget_exhausted'
  | 'suspended';

type ExecutionIdentity = {
  workspaceId: string;
  workItemId: string;
  activation: number;
  sponsorId: string;
  grantId: string;
  grantRevision: number;
  fence: string; // Decimal bigint transported as a string.
};

type AgentError = {
  code:
    | 'invalid_input'
    | 'denied'
    | 'stale_revision'
    | 'unsupported_capability'
    | 'provider_rejected'
    | 'provider_unavailable'
    | 'uncertain_outcome'
    | 'budget_exhausted'
    | 'cancelled'
    | 'internal';
  message: string;
  fields?: { path: string; message: string }[];
  retry: 'never' | 'safe' | 'decision_required';
};
```

Public API DTOs omit private provider envelopes, credentials and internal stack traces. Every serialized reference is resolved against the authorized workspace. Immutable IDs, revision numbers and hashes are host-computed, not accepted from model assertions without verification.

## 4. Migration plan and database conventions

Create `server/agent/migrations/001-core.sql`, `002-runtime.sql`, `003-memory.sql`, and later `004-evaluation.sql`, tracked in `wa_migrations(version, checksum, applied_at)`. Apply new versions under an advisory transaction lock after `KnowledgeStore.initialize()`. Never edit the already applied knowledge migration files or their checksums.

Every table below has `workspace_id text NOT NULL REFERENCES cp_workspaces(id)` and a composite primary key `(workspace_id,id)` unless another key is specified. Parent references use composite workspace foreign keys. JSONB is bounded and schema-validated before insertion. Domain statuses have SQL checks matching their Zod enum. Mutable aggregates carry `edit_version`, `created_at`, `updated_at`; append-only records carry `created_at`.

### Core migration

| Table                 | Required fields beyond common columns                                                                                                                                                                                                                      | Constraints and indexes                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `wa_grants`           | `sponsor_id`, `created_by`, `revision`, `scope jsonb`, `budgets jsonb`, `expires_at`, `revoked_at`                                                                                                                                                         | Sponsor/creator FK to `cp_users`; immutable grant revision records; unique `(workspace_id,id,revision)`                         |
| `wa_agents`           | `enabled`, `mode`, `sponsor_id`, `grant_id`, `grant_revision`, `connection_id`, `connection_revision`, `harness_version_id`, `policy jsonb`                                                                                                                | One row per workspace; pinned grant FK; configuration CAS                                                                       |
| `wa_sessions`         | `created_by`, `title`, `status`                                                                                                                                                                                                                            | `(workspace_id,updated_at DESC,id)` list index                                                                                  |
| `wa_messages`         | `session_id`, `ordinal bigint`, `role`, `actor_id`, `client_message_id`, `content_ref`, `attachments jsonb`, `work_item_id` nullable                                                                                                                       | Unique `(workspace_id,session_id,ordinal)` and `(workspace_id,session_id,client_message_id)` when supplied                      |
| `wa_work_items`       | `session_id`, `parent_id` nullable, `sponsor_id`, `grant_id/revision`, `state`, `goal`, `completion_criteria jsonb`, `trigger jsonb`, `input_refs jsonb`, `plan jsonb`, `config_snapshot jsonb`, `activation_no`, `budget jsonb`, `due_at`, `cancelled_at` | `(workspace_id,state,due_at,created_at,id)` queue index; guarded state/version updates                                          |
| `wa_workspace_leases` | Primary key `workspace_id`; `work_item_id`, `activation_no`, `owner`, `fence bigint`, `expires_at`                                                                                                                                                         | Single active writer lane per workspace; monotonically increasing fence                                                         |
| `wa_domain_outbox`    | `event_type`, `entity_kind/id`, `actor_id`, `origin_work_item_id`, `causation_id`, `payload jsonb`, `dedupe_key`, `delivered_at`, `attempts`, `next_attempt_at`                                                                                            | Unique `(workspace_id,dedupe_key)`; partial pending index on `(next_attempt_at,created_at,id)`                                  |
| `wa_inbox`            | `source_event_id`, `source`, `event_type`, `payload jsonb`, `state`, `coalesce_key`, `batch_id`, `work_item_id`                                                                                                                                            | Unique `(workspace_id,source,source_event_id)`; pending/coalescing index                                                        |
| `wa_command_outbox`   | `work_item_id`, `activation_no`, `kind`, `command_key`, `payload jsonb`, `delivered_at`, `attempts`, `next_attempt_at`                                                                                                                                     | Unique `(workspace_id,command_key)`; start key identifies the activation, wake key identifies the decision/event; pending index |

`wa_grants` revision history may use `(workspace_id,id,revision)` as its primary key instead of an extra table. `wa_agents` stores the selected revision explicitly. Revocation is represented separately or on every revision; checking the selected row must not accidentally allow an older revoked grant.

Session ordinals are allocated while locking the session row. Client-message duplicates return the existing receipt if their request hash matches; reuse with different content returns 409. Retried commands cannot create a second user message or work item.

### Runtime migration

| Table                  | Required fields                                                                                                                                                                                                             | Constraints and indexes                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `wa_activations`       | `work_item_id`, `activation_no`, `workflow_id`, `fence`, `state`, `harness_hash`, `tool_catalog_hash`, `model_profile jsonb`, `started_at`, `finished_at`                                                                   | Unique `(workspace_id,work_item_id,activation_no)` and `workflow_id`                                   |
| `wa_context_manifests` | `work_item_id`, `activation_no`, `turn_no`, `manifest jsonb`, `content_hash`                                                                                                                                                | Immutable; unique work/activation/turn                                                                 |
| `wa_turns`             | `work_item_id`, `activation_no`, `turn_no`, `state`, `context_manifest_id`, `model_call_id`, `completion jsonb`                                                                                                             | Unique work/activation/turn; ordered retrieval                                                         |
| `wa_model_calls`       | `turn_id`, `state`, `request_hash`, `connection_id/revision`, `request_ref`, `result_ref`, `private_protocol_ref`, `provider_response_id`, `usage jsonb`, `reservation jsonb`, `issued_at`, `completed_at`, `resolution_id` | One initial call per turn; retries create new linked call attempts after an explicit recorded decision |
| `wa_tool_calls`        | `turn_id`, `provider_call_id`, `tool_name/version`, `arguments_hash`, `arguments_ref`, `effect`, `expected_refs jsonb`, `idempotency_key`, `state`, `fence`, `result_ref`, `resolution_id`                                  | Unique `(workspace_id,turn_id,provider_call_id)` and host-issued idempotency key                       |
| `wa_observations`      | `work_item_id`, `call_id`, `status`, `summary`, `result_ref`, `evidence_refs jsonb`, `error jsonb`                                                                                                                          | One terminal observation per attempt; append-only reconciliations link the earlier attempt             |
| `wa_payloads`          | `classification`, `content_hash`, `byte_length`, `media_type`, `body bytea`, `encryption_key_id` nullable, `expires_at`                                                                                                     | Separate public artifact content from encrypted provider continuation; no direct browser access        |
| `wa_change_sets`       | `work_item_id`, `revision`, `state`, `base_refs jsonb`, `after_refs jsonb`, `diff_ref`, `validation_ref`, `proposal_hash`, `approval_decision_id`                                                                           | Immutable proposal revisions; changing content creates a new revision                                  |
| `wa_applications`      | `change_set_id`, `change_set_revision`, `proposal_hash`, `idempotency_key`, `actor_id`, `receipt jsonb`                                                                                                                     | Unique workspace/application key and unique applied change-set revision                                |
| `wa_decisions`         | `work_item_id`, `session_id`, `actor_id`, `kind`, `subject_ref`, `request_hash`, `decision jsonb`, `client_decision_id`, `supersedes_id`                                                                                    | Unique client decision key; authority checked at decision time                                         |
| `wa_activity`          | `work_item_id`, `ordinal`, `type`, `summary`, `resource_refs jsonb`, `correlation_id`                                                                                                                                       | Append-only ordered work-item trace; no provider-private fields                                        |

Use payload references for repeated model context and observations instead of copying large JSON into every row. V1 limits: source/RDF 1 MiB for import, model request 256 KiB serialized, model response 2 MiB, individual tool argument 64 KiB, observation preview 8 KiB and stored tool result 1 MiB. A larger result must be paginated or stored as bounded artifact chunks. These are application limits, independent of provider maximum context.

### Memory and evaluation migrations

`wa_memories`: kind, status, content reference, applicability JSON, source refs, dependency refs/hashes, created_by/origin_work_item, accepted decision, supersedes, expiry. Index workspace/status/kind and a Postgres text-search vector; queries always filter workspace and effective scope before ranking.

`wa_harness_versions`: immutable manifest, content hash, package reference, applicability, parent version, status and adoption decision. `wa_evaluations`: candidate/baseline hashes, fixture version, runner/tool/model versions, seed, trace refs, metrics JSON and verdict. `wa_harness_adoptions`: scope, selected version, decision and previous adoption reference. Keep adoption history rather than mutating an old package.

`wi_imports`: original payload reference/hash, format, parser version, import namespace/module key, status, diagnostics, parsed candidate reference, mapping hash and actor. `wi_import_identity_map`: `(workspace_id,module_key,resource_kind,canonical_iri)` primary key, stable target ID, first/last import, icon source/override metadata. Allocate mappings transactionally during confirmed import application, not by permanently mutating identity state for abandoned previews.

## 5. State transitions and command semantics

All transitions use an allowed-transition table in `lib/agent/state.ts`, expected aggregate version and a fence when worker-owned. Persist activity and related outbox records in the same transaction. A free-form `UPDATE state=$input` route is forbidden.

| Command                      | Allowed prior state                       | Result                                                |
| ---------------------------- | ----------------------------------------- | ----------------------------------------------------- |
| User goal / matched trigger  | New work item                             | `queued` plus start outbox                            |
| Claim activation             | `queued`                                  | `preparing` with lease/fence and activation           |
| Context ready                | `preparing`                               | `reasoning`                                           |
| Tool batch accepted          | `reasoning`                               | `executing_tool`                                      |
| Tool batch observed          | `executing_tool`                          | `reasoning` or actionable failure                     |
| Ask question                 | `reasoning`                               | `waiting_for_user`, durable decision subject          |
| Stage proposal               | `reasoning`                               | `ready_for_review`                                    |
| Decision accepted            | Matching waiting/review state and version | New queued activation or apply command                |
| Application conflict         | `applying`                                | `conflicted`; retain proposal and local changes       |
| Verified completion          | Active / application completed            | `completed` with criteria evidence                    |
| Cancellation / access loss   | Any nonterminal state                     | `cancelled` / `suspended`; prevent new issued effects |
| Unrecorded in-flight outcome | Recovered issued call                     | `uncertain`; reserve resolution subject               |

Waiting and review states release the workspace writer lane. Receiving a decision does not automatically approve another proposal or grant new tool scope. A decision is bound to subject ID, proposal/question version and content hash.

New user steering appends a message and an interrupt flag. It is consumed between tools/turns. It updates the goal through a revisioned decision; it does not mutate a request already sent to MiniMax. New evidence invalidates dependent context and proposals, not historical turn records.

## 6. Claiming, leases and fencing

A scheduler tick runs every 2 seconds plus immediate wake notifications; reconnect/restart always reconciles persisted commands. Claim at most 25 pending commands per pass with `FOR UPDATE SKIP LOCKED`. Lock duration covers dispatch bookkeeping, not network work.

For a workspace activation, take a short advisory transaction lock keyed by `wa-writer:<workspace>`, select the oldest eligible queued item, and claim the `wa_workspace_leases` row. Increment the fence on takeover, allocate `activation_no`, insert activation/start command and commit. A second worker seeing an unexpired lease does not start another writer.

Lease duration is 180 seconds, heartbeat every 15 seconds, per-call timeout at most 120 seconds. Guard worker writes using the exact fence, owner, activation and unexpired lease. An in-flight issued call remains globally recorded by its unique attempt; a new lease cannot cause the next worker to issue it again.

```sql
UPDATE wa_work_items w
SET state = $next_state, edit_version = edit_version + 1, updated_at = now()
WHERE w.workspace_id = $workspace AND w.id = $work
  AND w.edit_version = $expected_version
  AND EXISTS (
    SELECT 1 FROM wa_workspace_leases l
    WHERE l.workspace_id = w.workspace_id AND l.work_item_id = w.id
      AND l.owner = $worker AND l.fence = $fence AND l.expires_at > now()
  );
```

Authorization and lease ownership are live capabilities, not checkpointed facts. A recorded `claim` step may be replayed after its owner process has disappeared. Its cached fence cannot authorize a fresh effect. At every newly executing model/tool/application/settlement boundary, the handler obtains the current process ownership token and rechecks membership, grant and lease in authoritative storage. Cached completed effects can replay without issuing another call; their earlier authorization does not authorize the next call.

A recovered DBOS workflow may reclaim an expired lease for the same activation under a new fence, preserving its logical turn/call identifiers. Before takeover, inspect unresolved issued attempts; they remain blocked for reconciliation. DBOS recovery resumes the same workflow ID. The coordinator must not schedule a replacement activation merely because a process heartbeat expired: a new activation requires the predecessor to have yielded/settled or an explicit recovery decision that first fences it out. A late old worker cannot regain authority using the old checkpoint's identity.

A zero-row update is lease loss/conflict, never a successful transition. Late responses may be reconciled to their reserved call record using its attempt ID; they cannot advance the work item under a stale fence. Domain mutation transactions verify the fence inside the same transaction as their writes.

## 7. DBOS activation protocol

Register `stackproc.agent.activate.v1(workspaceId, workItemId, activationNo)` with workflow ID `wa:<workspace>:<work>:<activation>`. Keep its implementation and tool definitions available for already-pinned versions. Use short DBOS steps for database boundaries; model and external tool effects are separately reserved and recorded.

```ts
async function activate(workspaceId: string, workItemId: string, activationNo: number) {
  const identity = await step('activation-metadata', () => service.loadPinnedActivation(...));
  for (let turnNo = 0; turnNo < pinnedLimits.maxTurns; turnNo++) {
    const state = await step(`gate:${turnNo}`, () => service.authorizeAndBudget(identity));
    if (state.shouldYield) return step(`yield:${turnNo}`, () => service.yield(identity, state));
    const context = await step(`context:${turnNo}`, () => contextBuilder.prepare(identity, turnNo));
    const response = await step(`model:${turnNo}`, () => modelCalls.issueOrRecover(identity, context),
      { retriesAllowed: false });
    const dispatch = await step(`dispatch:${turnNo}`, () => dispatcher.prepare(identity, response));
    if (dispatch.waitOrComplete) return step(`settle:${turnNo}`, () => service.settle(identity, dispatch));
    await executeCheckpointedTools(identity, turnNo, dispatch.calls);
  }
  await step('budget-yield', () => service.exhaust(identity));
}
```

This is interface pseudocode: `identity` names the pinned activation, while each newly executing effect handler acquires/checks live ownership internally as specified above. A replayed gate result never replaces that check. Implement with the installed `DBOS.registerWorkflow` and `DBOS.runStep` APIs. Do not nest a model call or non-idempotent external effect inside a retried orchestration step.

Questions persist a wait subject and end the bounded activation. A matching decision atomically queues a new activation; this is the durable continuation. DBOS messages can wake active coordination but are not the sole copy of user answers. An outbox replay reuses the same workflow/message identity. Time-based waits store `due_at`; a restarted dispatcher finds them without relying on an in-memory timer.

## 8. Model call and budget protocol

Before issuing a model call, lock the work item and usage ledger, authorize current grant/connection, reserve upper-bound tokens/cost, persist the exact request hash/payload and a `prepared` attempt, then commit. Transition `prepared -> issued` before network issuance. This deliberately treats a crash in the tiny pre-send interval as uncertain rather than risking duplicate billing.

An attempt in `completed` returns its persisted result; `issued` without a result after recovery becomes uncertain. An explicit retry decision creates a new linked attempt and budget reservation. It does not erase the original attempt. Definite provider rejection before execution may be retried only under a coded safe-retry classification, bounded backoff and the remaining budget; generic fetch exceptions are uncertain.

Budget record fields: maximum/consumed/reserved turns, tool calls, input/output tokens, active milliseconds and optional currency micros. Reserve before spending; settle against provider-reported usage; keep ambiguous reservations until resolution. Sum across activations for work-item and workspace-period limits. If no trustworthy configured price schedule exists, enforce token ceilings and display currency as unavailable. Price configuration is versioned; never derive spending authority from a model estimate.

The initial 12-turn, 24-tool, two-independent-read defaults come from the architecture. An activation that reaches its cap checkpoints and stops. A new budget requires an explicit policy or user decision; merely reconnecting SSE cannot continue it.

## 9. MiniMax wire adapter and private continuation

Use native fetch to `https://api.minimax.io/v1/chat/completions` with server-resolved bearer credentials, `redirect: 'error'`, a bounded response reader and a composed cancellation/timeout signal. Continue using the workspace's selected model; do not silently upgrade it to the newest model.

The official [Chat Completions contract](https://platform.minimax.io/docs/api-reference/text-chat-openai) documents function tools. The [compatibility guide](https://platform.minimax.io/docs/api-reference/text-openai-api) requires retaining complete assistant messages for multi-turn tool use, including tool calls and applicable reasoning fields. Consequently the agent adapter must preserve provider continuation separately from user-visible messages.

```ts
interface AgentModelAdapter {
  id: 'minimax.agent';
  version: 1;
  capabilities(model: string): { toolCalling: boolean; maxContextTokens: number };
  complete(
    input: {
      model: string;
      messages: ModelMessage[];
      tools: ToolSchema[];
      continuationRef?: string;
      maxOutputTokens: number;
      signal: AbortSignal;
    },
    credential: ResolvedCredential,
  ): Promise<{
    publicMessage: string;
    toolCalls: { providerId: string; name: string; arguments: unknown }[];
    finish: 'complete' | 'tools' | 'incomplete';
    privateContinuation: Uint8Array;
    responseId: string;
    model: string;
    usage: { input: number; output: number; cachedInput?: number };
  }>;
}
```

The adapter maps catalog names to provider-safe function aliases such as `ontology_inspect_v1` and records the alias map in the pinned tool catalog. It validates unique call IDs, bounded argument JSON, supported finish reasons, provider status and response model identity. Reject truncated output; no partial tool mutation is dispatched from an incomplete assistant message.

Append the provider's original assistant tool-call message followed by one tool observation for each requested call ID before requesting another assistant turn. Use model-specific field preservation verified by contract fixtures. UI text extraction removes provider thinking fields and known reasoning wrappers; it never renders the entire provider envelope.

`privateContinuation` is encrypted in `wa_payloads` with classification `provider_protocol`; only the adapter/recovery service can decrypt it. It is not returned through APIs, indexed, summarized into memory, put in notifications, used in harness evaluations or displayed as activity. Delete at the configured work-item continuation retention boundary. If it expires before a resume, start a new linked model segment from public evidence and mark the continuity break explicitly.

Model capability checks are pinned by adapter version. The live enablement fixture must exercise a tool round trip, malformed arguments, parallel requests, usage, cancellation and interrupted completion with the customer's authorized MiniMax model. Existing final-analysis tests do not establish this capability.

## 10. Tool registry and dispatch implementation

```ts
interface AgentTool<I, O> {
  name: string;
  version: number;
  input: ZodSchema<I>;
  output: ZodSchema<O>;
  effect: 'read' | 'stage' | 'apply' | 'external';
  permission: 'read' | 'execute' | 'manage';
  idempotency: 'pure' | 'transactional' | 'provider_key' | 'reconcile' | 'none';
  maxInputBytes: number;
  maxOutputBytes: number;
  execute(ctx: AuthorizedToolContext, input: I): Promise<O>;
  reconcile?(ctx: AuthorizedToolContext, call: PersistedToolCall): Promise<ReconciledResult>;
}
```

The registry is built from trusted imports during startup. Tool schemas are materialized to JSON Schema and hashed with implementation versions. Node integration operations remain in `NodeRegistry`/the integration catalog; agent tools wrap those contracts through authorized handlers rather than making every node globally callable.

Dispatch pipeline: resolve alias/version -> input validation -> grant/current membership -> effect/connection scope -> resolve expected resource versions -> reserve call -> execute -> output validation -> persist observation/activity. Failures before execution are `invalid` or `denied`. Failures after an uncertain external issuance are not reported as safe failures.

A response may request several tools. Allow at most two independent read calls concurrently; collect observations in the model's original call order. Stage/apply/external calls execute serially. Reject cycles/dependencies that reference unobserved results and ask the model for a new turn. The host constructs idempotency keys from workspace/work/turn/provider-call identifiers and an argument hash.

V1 executable tools are workspace/artifact/source reads, capability search, ontology validation/RDF preview, change staging/preview, question creation, memory proposals and compile validation. `changes.apply` is exposed only when the work item has an explicit applicable grant or a matching human decision. Run execution, publication and external messaging are later explicitly granted tools.

## 11. Transaction-aware application service

Extract `KnowledgeStore.validateWithClient(ctx, kind, content, client)`, `saveWithClient(...)` and a corresponding `StudioStore.saveFlowWithClient(...)`. Standalone routes continue wrapping these in their existing transaction. Read permission/evidence checks use the same transaction where concurrency affects correctness; there is no separate pool query observing an inconsistent state midway through Apply.

ChangeSet V1 contains typed artifact replacements/creations, not arbitrary JSON Patch:

```ts
type ArtifactChange = {
  target: { kind: 'ontology' | 'process' | 'workflow'; id: string; create: boolean };
  expected: ResourceRef | null;
  afterPayloadRef: string;
  afterHash: string;
};
type ChangeSet = {
  id: string;
  revision: number;
  workItemId: string;
  changes: ArtifactChange[];
  bindings: { temporaryRef: string; allocatedId: string }[];
  evidence: Evidence[];
  validationRef: string;
  proposalHash: string;
};
```

Preallocate final IDs when staging so all references can be validated; allocation does not reserve or overwrite an artifact head. Apply rejects conflicting existing IDs for `create` operations. Recompute every hash server-side and validate all after-states; no model-supplied validation badge is trusted.

Transaction steps: lock application key -> load receipt if identical -> authorize and fence -> lock heads in stable `(kind,id)` order -> compare versions/hashes -> validate scope, evidence and cross-artifact references -> compile graphs -> create revisions and generation manifest -> insert application receipt/decision/audit/domain outbox -> commit. Any validation error rolls back the entire set.

Existing saved workflows store authored revisions in `studio_flow_revisions` and increment `studio_flows.edit_version`; preserve both. Do not mutate a historical run graph or reset existing schedules as an incidental edit. Generated workflow drafts keep schedules disabled under the current generation contract.

Proposal approval binds revision and hash. Rebase makes a new immutable change-set revision and requires renewed approval if content changes. Repeat Apply with the same idempotency key and matching hash returns the original receipt; key reuse with different content is 409.

Unsaved editor attachments are proposals against an editor snapshot. `apply_to_editor` returns the candidate and expected editorVersion/hash; the browser checks them before replacing local state as one undo entry. Persisting afterward uses the normal Save CAS. A server artifact application cannot silently replace a newer local draft.

## 12. Event production, ingestion and trigger rules

Add `AgentEventWriter.enqueue(client,event)` to domain command transactions: source/knowledge save, ontology import application, workflow save/test completion and connection change. A unique dedupe key contains the event type, stable resource ID and committed revision/version. Outbox insertion and domain update succeed or fail together.

The dispatcher inserts inbox rows with `ON CONFLICT DO NOTHING`, then marks outbox delivery in the same transaction when both live in the application database. A crash cannot consume delivery without the inbox record. DBOS start/wake commands use a separate command outbox because their transport is outside that transaction.

Background triggers first run deterministic policy checks. Observe mode refreshes an artifact/dependency index and notices. Assist mode may create work items from enabled triggers. Relevant changes sharing `(workspace,trigger,subject)` debounce for 2 seconds, with a maximum 10-second window; immediate user/cancel/revocation events bypass debounce. Persist batch membership and cutoff. Events arriving after cutoff form another batch.

Keep `origin_work_item_id`, causation and chain depth. Suppress a work item's own update events as triggers for that same objective. Maximum automatic causal chain depth is 3 by default; reaching it produces an attention item instead of another activation. A manual request or independent external event starts a new chain.

Membership/connection revocation invalidates grants/context and signals matching active calls immediately. A poll/heartbeat also rechecks authoritative state, so missing an in-memory wake notification cannot preserve access.

## 13. Context and memory implementation

`ContextBuilder.prepare(identity,turnNo)` resolves input references and a permission-filtered index; fetches selected source blocks, ontology/process snippets, operation schemas and accepted decisions; assigns bounded resource IDs; then stores a manifest and a compact model payload. Include search queries, retrieval order, omitted references and content hashes.

Context priority: host instructions and scoped grant -> current user goal and unanswered questions -> selected artifact/operation references -> accepted decisions -> relevant evidence -> candidate experience. Imported documents and tool output are typed data, never host instructions. Tool schemas and credentials are not discoverable through document text.

Use Postgres FTS plus exact ID/name and relation traversal first. V1 retrieval caps: 20 hits/query, 5 source excerpts/turn, 10 accepted memories/activation; each tool read is paginated. Deduplicate by revision/hash. These are defaults adjustable within the grant's total request budget.

Compaction produces a new public work summary referencing original evidence, with a dependency hash. Preserve original activity/messages in storage. A changed dependency makes the summary stale. Read-only retrieval can propose a refreshed summary; it cannot mark changed business facts accepted automatically.

Add `agent_inference` and `agent_decision` variants to `lib/knowledge/contracts.ts` with work item/observation or decision identifiers. Validate references against new workspace-scoped tables. Retain legacy source/user/inference variants and route them to the current `wi_*` tables. Extend generation provenance additively with change-set/harness/work-item IDs; do not fabricate legacy task IDs.

Memory acceptance requires explicit user feedback or an enabled skill-adoption policy after evaluation. A memory has a dependency list and status; invalidation sets `stale` without deleting historical evidence. Raw provider continuation is excluded from all memory and search operations.

## 14. RDF parser service and identity mapping

Create `RdfParserAdapter.parse(bytes,{baseIri}) -> ParsedRdfDocument` in `server/knowledge/imports/rdf.ts`. Use the pinned Microsoft parser's supported mapping behind a Node-compatible XML adapter. Add a DOM-capable parser dependency only after a fixture proves the methods/namespaces used by the upstream code. Alternatively extract namespace-aware traversal into a shared pure mapper; do not install global mutable DOM state per request.

The browser can preview for responsiveness, but the server reparses original bytes before storing/applying a candidate. V1 media types: `application/rdf+xml`, `application/xml`, `text/xml`; sniff content and reject Turtle/JSON-LD with a format-specific error. Stream a raw body up to 1 MiB using a dedicated reader. The existing JSON reader's 1 MiB limit cannot carry a fully escaped 1 MiB RDF document reliably.

`ParsedRdfDocument` returns original IRI identities, typed entities/properties/relations, source locations, bindings metadata, supported source features and diagnostics `{code,severity,sourceRef,message}`. No remote fetching or entity expansion. Unknown semantics are retained in the source and surfaced; no unconditional “lossless import” claim.

Within a module, canonical absolute IRIs identify resources. Resolve relative IRIs using explicit/document base; do not strip fragments or lowercase paths. IDs map through `wi_import_identity_map`, not hashes of labels. Identical IRIs from different explicitly separate modules remain separate unless a reviewed mapping says otherwise. Unsupported anonymous restrictions retain source locations and blocking diagnostics rather than fabricated stable meanings.

Preview allocates provisional IDs and a mapping hash without changing accepted mappings. Confirmed Apply locks the module mapping, checks prior mapping version and commits identity rows with the ontology revision. A concurrent preview whose allocations conflict is stale and must be rebuilt.

V1 supports create-module and replace-draft actions with explicit removed/added/changed counts. Reimport/merge is enabled only after identity and override tests pass. Until then, show the unsupported update mode instead of guessing. Imported ontology names can suggest a module name but cannot silently rename the workspace artifact.

Map visual icon IDs through `lib/knowledge/entity-presentation.ts`. Preserve a user override, then a valid imported catalog icon, otherwise infer a catalog suggestion from the concept label/description; use the entity glyph for unknowns. Record icon origin and mapping version. All rendering goes through `host/entity-glyph.tsx` using Font Awesome Pro. Presentation metadata is independent of semantic IDs and validation.

## 15. HTTP command contracts

Route through `server/agent/routes.ts` from `createStudioServer`. Use the same cookie/session/workspace context and error mapping. State-changing commands require CSRF/origin protections consistent with existing routes. A client-provided workspace ID is never a substitute for session context.

```json
POST /api/agent/sessions/:id/messages
{
  "schemaVersion": 1,
  "clientMessageId": "uuid",
  "expectedSessionVersion": 3,
  "text": "Build the account opening process from this procedure",
  "attachments": [{"kind":"source","id":"source-id","revisionId":"rev-id","hash":"sha256"}]
}
```

Return 202 `{messageId,sessionId,sessionVersion,workItemId,state}` after the transaction commits. No model response is awaited. A duplicate request returns the same receipt.

Other contracts:

| Route                                      | Body/query                                                                                       | Result                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `GET /api/agent/state`                     | Current workspace                                                                                | Effective mode/capabilities, queued work and attention counts       |
| `PUT /api/agent/configuration`             | `expectedVersion`, sponsor/grant, connection revision, triggers/budgets                          | CAS configuration; `manage` required                                |
| `POST /api/agent/sessions`                 | Client key, title, initial attachments                                                           | Session receipt                                                     |
| `GET /api/agent/sessions/:id`              | `afterMessageOrdinal`, limit <=100                                                               | Session + messages + linked work summary                            |
| `GET /api/agent/work-items/:id`            | `afterActivityOrdinal`, limit <=100                                                              | Authoritative state, public activity, pending questions/proposals   |
| `POST /api/agent/work-items/:id/decisions` | Client decision key, expectedVersion, subject ID/version/hash, typed answer/approve/reject/retry | Persisted decision and continuation receipt                         |
| `POST /api/agent/work-items/:id/cancel`    | Client key, expectedVersion                                                                      | Cancel receipt; completed earlier side effects remain visible       |
| `GET /api/agent/change-sets/:id`           | Optional proposal revision                                                                       | Before/after refs, safe diff, criteria and validation               |
| `POST /api/agent/change-sets/:id/apply`    | Client key, proposal revision/hash, expected base refs                                           | Atomic receipt or 409 conflict                                      |
| `POST /api/knowledge/imports/rdf/preview`  | Raw RDF/XML body; bounded filename/base/module metadata                                          | Import ID, parsed candidate, diagnostics, icon suggestions and diff |
| `POST /api/knowledge/imports/:id/apply`    | Client key, target/create mode, expected head and mapping hash                                   | Ontology revision/application receipt                               |

Status codes: 400 malformed transport/schema, 403 denied scope, 404 inaccessible/missing resource, 409 version/idempotency conflict, 413 size limit, 422 unsupported semantics/provider configuration, 429 admission/budget limits, 503 unavailable runtime. Background provider failures update the work item; they do not turn a previously committed 202 into a fictional synchronous failure.

Errors use `{error:{code,message,fields?,retry,correlationId}}` on new routes. Add an agent API client; do not break legacy `controlRequest` routes that currently return string errors. GET endpoints return `Cache-Control: no-store` for scoped mutable state.

## 16. UI hooks, activity and draft integration

Add `useAgentSession(sessionId)` and `useAgentWorkItem(id)` using the existing workspace SSE hook. Events invalidate state; hook fetches authoritative DTOs and de-duplicates by message/activity ordinal. One shared EventSource per workspace remains the transport. Abort/discard stale fetch responses when switching session or workspace.

The workbench separates conversation from current work and artifacts. Render structured questions and proposal cards rather than requiring a user to answer opaque IDs. The activity view shows tool name, state, concise input/output summary, evidence links, duration and actionable errors. Hide private payload classifications at serialization as well as in components.

Editor integration provides saved resource attachment and explicit unsaved snapshot attachment. Applying to a local editor requires matching snapshot hash/editorVersion, preserves unrelated draft edits and creates one undo entry. Dirty editors show compare/rebase choices. Server-applied revisions are notifications; they do not automatically reload an unsaved canvas.

Import dialog: Source -> Preview -> Apply, with file/paste choices, supported format, source size, entity/relationship counts, icon previews, unsupported diagnostics and replacement scope. Invalid input leaves the current graph intact. Apply and Save remain distinct where importing into an unsaved designer draft; server-side persisted import must name that action clearly.

Agent administration uses the Stack Proc work-area skill and official Untitled UI controls. Canvas agent panels retain fullscreen editing. Header controls remain reachable while the content scrolls; notification bell receives only questions, proposals, failures and completion summaries rather than every tool observation.

## 17. Event serialization and observability

Reuse `WorkspaceEvents` with new safe event actions. Insert audit/public workspace events in the same transaction as agent state changes; never publish an SSE success before commit. Existing metadata-only `cp_workspace_events` can carry resource IDs; clients load details from `/api/agent/*`.

Public event example:

```json
{ "action": "agent.proposal_ready", "entityType": "agent_work_item", "entityId": "work-id", "workspaceId": "ws-id" }
```

The serializer maps titles/resource names and checks current access. Trace correlation joins session, work item, activation, DBOS workflow ID, turn, call, change set and application receipt. Structured logs record IDs, durations and error codes, never keys, raw documents or provider reasoning.

Metrics: inbox/outbox lag, queued age, activation count, lease loss, issued/uncertain calls, budget reserved/used, rejected tool calls, stale proposals, successful applications and evaluation regressions. An operational replay command must be idempotent and cannot resend uncertain external/model effects automatically.

## 18. Harness evaluation seam

Represent harness packages as immutable manifests with prompt/context guidance, skill refs, retrieval settings, tool guidance, memory policy and budgets. The editable surface excludes tool implementations, grants, credentials and publication policy. A work item pins manifest hash and implementation versions.

`HarnessRunner.run(fixture,harnessVersion,seed)` executes the same production coordinator/dispatcher with isolated stores, deterministic tools and a fixture or authorized MiniMax adapter. Produce public activity/artifact traces and independent validator results. Reference the same scenario IDs for baseline/candidate; test held-out fixtures before adoption.

Harness² integration is required, using the actual upstream engine through adapters around this trace format and the supported executor. Its proposer/probe/composition may produce a package candidate; application adoption is a separate decision with rollback to a previous hash. No benchmark script is executed within a customer workspace or allowed to rewrite live policy.

## 19. Implementation work packages

| Package                       | Primary files                                                                                         | Migration/test exit                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| A. Core contracts             | `lib/agent/contracts.ts`, `state.ts`, `policy.ts`; `server/agent/store.ts`, `service.ts`, `routes.ts` | Core migration; session idempotency, state guards, authorization and workspace isolation           |
| B. Coordinator                | `coordinator.ts`, `workflows.ts`, `server/index.ts` wiring                                            | Leases/outboxes; duplicate start, crash, stale fence and lost notification tests                   |
| C. Tool and change foundation | `tools.ts`, `dispatcher.ts`, `changes.ts`; transaction-aware knowledge/studio methods                 | Runtime migration; real tool schemas, atomic CAS, idempotent application and editor snapshot tests |
| D. RDF capability             | `server/knowledge/imports/*`, identity/source contracts, import dialog and icon catalog               | Parser fixtures, stable identity, unsupported semantics, file/paste/Undo and override preservation |
| E. MiniMax loop               | `server/agent/models/minimax.ts`, call reservations, private payload storage                          | Tool round-trip/recovery/budget fixtures; separately authorized live capability check              |
| F. Ambient memory and UI      | Domain event producers, context/memory, agent workbench/hooks                                         | Memory migration; cross-session decisions, invalidation, coalescing and SSE recovery               |
| G. Process/workflow authoring | Planner mappings, capability tools, generation manifests                                              | Supported-domain fixtures; no fake integrations; legacy task compatibility                         |
| H. Evaluated adaptation       | Version packages, runner, evaluation/adoption services                                                | Evaluation migration; held-out regression and rollback tests                                       |

A-C establish the harness without provider calls. RDF can ship in D before E. Do not present D+E alone as a persistent workspace agent; F supplies the ambient context/continuity contract. Preserve legacy task operation until equivalent scenarios pass through G.

## 20. Verification and release gates

Unit tests cover strict schemas, transition matrix, grant intersection, trigger selection, budget reservation, idempotency hashing, provider alias parsing, evidence validation, context invalidation and icon precedence. Test behavior and contracts rather than CSS class names.

Integration fixtures use an isolated Postgres/DBOS service and fixture adapter. Inject crashes at: message commit before dispatch; DBOS start before outbox acknowledgment; call preparation before issuance; issuance before completion persistence; tool mutation before observation; application receipt before notification. Assert deduplication, uncertainty, fencing and atomic rollback at each boundary.

Concurrency cases: two workers claim one workspace; two Apply requests share a key; same key with different content; user saves during proposal review; concurrent RDF mapping allocations; revoked grant during a wait; late response under an expired fence. Assert actual row/version/outbox invariants, not only HTTP status.

Domain fixtures include at least banking, document ingestion and a third unrelated domain. They share the same tool/runtime contracts. Evaluation includes malformed RDF, ambiguous labels, missing operations, contradictory decisions and an explicit variable overwrite whose value trace must identify the assigning node.

Browser verification covers file/paste import preview, icon selection, invalid-input retention, draft Apply/Undo/Save, session continuation, agent questions, proposal diff/conflict, cancellation, SSE reconnect and narrow viewport/zoom. Run `npm test`, targeted isolated integration tests and `npm run build`. Provider transport fixtures are not evidence of a successful live MiniMax call.

Rollout flags are per workspace: `agent_core`, `agent_tools`, `agent_model`, `agent_ambient`, `agent_adaptation`. A disabled model flag still permits deterministic indexing/manual tools. Rollback stops new claims, preserves DBOS workflow/version handlers for pending work, and leaves legacy analysis and saved artifacts usable. Additive migrations are not dropped as a rollback mechanism.

## 21. Decisions remaining before implementation enablement

Resolve the XML adapter dependency through parser fixtures, MiniMax model-specific continuation tests, encryption key lifecycle for private protocol payloads, retention/attachment policy, production grant renewal UX and usage-price configuration. These do not block contracts/core persistence, but they gate the corresponding capabilities.

No production credentials, model calls, customer-data imports or runtime migrations are executed as part of writing this specification.

## Shell presence and request intake correction — 2026-10-19

The workspace agent is mounted once in the application shell, including the fullscreen designers. Its nonmodal panel is a shared client surface; closing it or navigating does not stop server work. The intelligence work area inspects history, activity, questions and proposed changes.

All new natural-language intents use `useWorkspaceAgent().request(...)` → `POST /api/agent/requests`. This captures the authenticated workspace, actor, current surface and references to saved resource revisions, persists an idempotent request, and returns HTTP 202 before inference. It does not proxy arbitrary HTTP traffic, capture secrets from forms, or silently include unsaved editor buffers. Existing direct session-message APIs remain for backward compatibility; new application features must use the intake hook.

`wa_requests` is the durable intent inbox. The coordinator creates/reuses one `wa_agent_channels` conversation per workspace, dispatches goals in order, and retains follow-ups while the current goal waits for a decision or proposal review. Clarification answers have priority over blocked goals. Policy revision and current membership are checked again before dispatch. A crash between message creation and acknowledgement reuses the recorded message/work item rather than creating another invocation.

Committed workspace events use the same intake queue, with `origin=workspace-event` and a source-event reference. Trigger selection and consent remain workspace policy; inference never depends on the panel being open. Event requests and user requests share context and decision continuity in the workspace channel.

Harness activations are enqueued on DBOS `stackproc.agent.harness.v1`, with global concurrency 4, worker concurrency 2, and partition concurrency 1 keyed by workspace. The model is called by the durable harness worker after authorization, budget and connection checks. These are harness work items, rather than disconnected prompt jobs: tools, observations, questions, memory, recovery and reviewed proposals remain part of the same execution.

The shell consumes shared workspace SSE to display queue/attention state and uses bounded polling only while work is pending. The official Untitled UI slideout primitives provide a nonmodal dock. Untitled UI links use the framework router, preserving shell/provider state during application navigation. Model credentials and inference calls never move into the browser.

### Large-artifact inspection (issue #4, implemented 2026-10-20)

`artifact_read_v1` no longer rejects a revision merely because its serialized form exceeds 64 KB. Existing small automatic reads retain their complete-artifact response. Large automatic reads return an index and supported views; this does not represent a full source read.

Optional views are `summary`, `structure`, `entities`, `entity` (with `entityId`), `relationships`, `text`, `search` (literal `query`) and `json`. Native ontology structure excludes embedded playground/RDF payloads. RDF/XML source structure is projected through the existing importer, with omitted/unsupported assertions disclosed and deterministic revision-derived property IDs. External vocabularies are never fetched. Unsupported source formats remain readable as text/search.

Pages carry the immutable revision ID/content hash, selected-view offsets, total length, next offset and exact continuation arguments. Offsets use UTF-16 units; source text normalizes CRLF/CR to LF, matching source blocks. Continuations preserve the revision and selection/query. Text is bounded to at most 8,000 code units and 12,000 serialized bytes (plus bounded metadata/evidence). Large individual entities remain pageable. `complete` means the entire selected view was returned in that one response, not that all artifact views or external dependencies were read. Search hits and metadata explicitly disclaim full coverage. Source text/search pages include intersecting source-block evidence references; structured projections do not invent source citations.

The same tool name remains available to process agents and research agents under their existing read permissions; this adds no workspace-write capability. Reads pass through the existing authorized immutable revision lookup before paging and retain the existing durable tool receipt path. Source storage/import limits are unchanged. The runtime instructs agents to retrieve relevant source assertions, distinguish source facts from proposed enrichment, and report unread coverage or exhausted budgets rather than substituting recalled vocabulary definitions.

Verification covers the original W3C ORG source above the former limit, exact page reconstruction, structured entity/property retrieval, repeated-read ID stability, literal/Unicode search offsets, oversized Unicode entities, evidence references, output-contract validation, failed authorized lookup, durable model/tool execution and receipt persistence across restart. Existing completed observations are historical; start a new instruction to use the corrected reader rather than treating an old size-error receipt as fresh evidence.
