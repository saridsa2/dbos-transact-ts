# Workspace agent lifecycle technical specification

Status: core lifecycle implemented locally, 2026-10-20. Implements [Workspace agent setup and specialist coordination](workspace-agent-lifecycle.md). The implementation record below identifies delivered behavior, verification and remaining rollout boundaries.

## Architecture and invariants

Retain `server/workspace-harness/query.ts` as the single execution lifecycle and `server/agent/workspace-runtime.ts` as its durable DBOS host. Introduce agent definitions and coordination services around that host. Do not instantiate a second `ToolLoopAgent`, add an SDK chat transport, or restore Harness2.

The execution chain is:

```text
setup template or published agent revision
  → authorized invocation + resolved immutable snapshot
  → existing request intake
  → session/message/work item + command outbox
  → existing DBOS activation/model/tool receipts
  → typed result, question or reviewed proposal
  → idempotent setup/suggestion/assignment projection
```

Required invariants:

1. Every new executable invocation pins an agent revision/hash or setup template revision/hash before queueing. Drafts never execute directly.
2. Publication changes future invocations only. Resume preserves the original snapshot; current revocations can narrow or stop it.
3. Model output cannot publish an agent, expand its authority, activate a coordinator or apply a domain proposal.
4. The accountable execution actor is explicit. An agent owner or the workspace sponsor cannot silently replace the caller.
5. The workspace retains one writer lease. Named agents do not create independent concurrent writers.
6. All application mutations, assignment decisions and model/tool effects retain idempotency receipts. An issued call without a validated receipt is not automatically retried.
7. A suggestion, assignment, agent definition, session and work item remain distinct objects.
8. Runtime-facing tools enforce the effective tool and resource scope at dispatch as well as discovery.

## Source changes

The following table retains the target decomposition. Several responsibilities are consolidated in the delivered definition/setup/coordination services; the implementation record identifies the actual baseline.

| Boundary                                 | Proposed owner                                                              | Existing integration                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Definition, revision and command schemas | `lib/agent/definitions.ts`                                                  | Reuse limits, attachment, harness-option and canonical hash contracts           |
| Setup result and understanding schemas   | `lib/agent/understanding.ts`                                                | Reference existing knowledge evidence and durable source-read receipts          |
| Suggestions and assignment schemas       | `lib/agent/coordination.ts`                                                 | Reuse work states; do not introduce another execution state machine             |
| Definitions and publication              | `server/agent/definitions.ts`                                               | `AgentService`, control transactions and audit                                  |
| Snapshot resolution and runtime access   | `server/agent/policy.ts`                                                    | Intake, `AgentService.authorize`, model/tool gates                              |
| Setup and activation                     | `server/agent/setup.ts`                                                     | Existing typed output validation and DBOS completion                            |
| Understanding reads and invalidation     | `server/agent/understanding.ts`                                             | Knowledge revisions and domain events                                           |
| Suggestions and assignments              | `server/agent/coordination.ts`                                              | Existing request outbox and `AgentTasks`                                        |
| Sanitized list/summary queries           | `server/agent/projections.ts`                                               | Activity, work and event records                                                |
| Routes                                   | Extend `server/agent/routes.ts`                                             | Explicit per-action authorization, not blanket non-GET execute access           |
| UI composition                           | Extend `components/intelligence/workspace.tsx` and add feature compositions | Licensed vendor components, `hooks/use-intelligence.ts`, existing run inspector |

Pass a transaction-scoped repository/client to mutating service methods. Current helpers often read configuration through `service.pool` while another transaction is open. New atomic commands must read their version guards, policy and referenced rows through the same `PoolClient`, or validate a previously loaded immutable reference under a lock. No network/model requests occur while a database transaction is held.

## Type contracts

Use strict Zod schemas and generated JSON Schema at model boundaries. The following TypeScript specifies the logical shape; implementation must import existing runtime limit schemas rather than duplicate their numeric ranges.

```ts
type AgentKind = 'setup' | 'coordinator' | 'specialist';
type AgentRevisionRef = { agentId: string; revision: number; hash: string };
type TemplateRef = { templateId: string; revision: number; hash: string };
type ToolPermission = 'always' | 'ask' | 'never';

type ToolBinding = {
  name: string;
  permission: ToolPermission;
  provenance:
    | { kind: 'builtin'; contractVersion: number }
    | { kind: 'authored'; toolId: string; revision: number; hash: string }
    | { kind: 'extension'; extensionId: string; version: string; hash: string }
    | { kind: 'mcp'; connectionId: string; revision: number; schemaHash: string };
};

type AgentDefinitionV1 = {
  schemaVersion: 1;
  kind: AgentKind;
  name: string;
  description: string;
  instructions: string;
  model: { provider: 'minimax'; connectionId: string; connectionRevision: number };
  tools: ToolBinding[];
  context: { scope: 'selected' | 'workspace_inventory'; resources: ArtifactRef[] };
  skills: { id: string; revision: number; hash: string }[];
  limits: AgentConfiguration['limits'];
  runtime: HarnessOptions;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  interaction: 'interactive' | 'structured_output';
};

type InvocationTarget =
  | { kind: 'published_agent'; ref: AgentRevisionRef }
  | { kind: 'setup_template'; ref: TemplateRef };

type ExecutionSnapshotV1 = {
  schemaVersion: 1;
  target: InvocationTarget;
  definition: AgentDefinitionV1;
  actorId: string;
  sponsorId?: string;
  workspacePolicyVersion: number;
  context: ArtifactRef[];
  understandingRevisionId?: string;
  toolManifestHash: string;
  resourceScopeHash: string;
  parentAssignmentId?: string;
  resolvedAt: string;
  hash: string;
};
```

`ArtifactRef` reuses `{artifactId, revisionId}` from knowledge contracts; existing intake attachments additionally identify kind and must be adapted explicitly. Do not accidentally accept one shape as the other. Names are labels; IDs remain identity. Model configuration uses connection references, never secrets.

Validate supported variables in instructions against a fixed registry such as `workspace.name`, `assignment.goal` and `assignment.input`. Escape substitutions as data; unknown variables block publication. Bound instruction, schema, tool and context sizes against the current model request ceiling. Reject circular/unsupported JSON schemas with the existing schema validator. Skills are revision-pinned; current unversioned option IDs are resolved into the snapshot and cannot reload a newer revision on resume.

Trigger rules, assignments and mutable enablement are outside the immutable definition content. Publishing a new revision does not retarget existing rules or process bindings. Template-derived setup agents retain platform-owned role/tool restrictions independently of any model-suggested draft.

### Understanding and coverage

```ts
type UnderstandingAssertion = {
  id: string;
  section: 'purpose' | 'domain' | 'process' | 'responsibility' | 'capability' | 'gap';
  text: string;
  basis: 'source' | 'user' | 'hypothesis';
  evidence: Evidence[];
  sourceRefs: ArtifactRef[];
};
type CoverageEntry = {
  source: ArtifactRef;
  receiptIds: string[];
  views: string[];
  inspectedEntityIds: string[];
  textRanges: { start: number; end: number }[]; // half-open UTF-16 offsets
  status: 'uninspected' | 'partial' | 'complete' | 'unsupported';
};
type SetupResultV1 = {
  schemaVersion: 1;
  assertions: UnderstandingAssertion[];
  unresolved: { id: string; question: string; sourceRefs: ArtifactRef[] }[];
  coordinatorDraft: AgentDefinitionV1;
  specialistRecommendations: { purpose: string; evidence: Evidence[] }[];
};
```

Coverage is a host-derived projection of successful `artifact_read_v1` receipts, not a model-authored completion flag. Summaries, entity indexes and searches cannot mark a whole source complete. Completeness requires a complete supported representation and contiguous applicable ranges or an explicitly enumerated entity set; source text coverage and ontology-projection coverage are different dimensions. Preserve parser warnings and unfetched external imports. A model may cite receipt IDs; the server resolves and verifies them before materializing an understanding.

Reuse existing `Evidence` variants for source blocks and user decisions. Structured ontology entity/property references require a versioned evidence extension with artifact/revision/element identity; do not invent block IDs for ontology JSON. Hypotheses may lack evidence but cannot claim to be source facts. Source-derived assertions require verified readable references; user-derived assertions require an actual accepted decision.

### Suggestions and assignments

Each suggestion stores: coordinator revision, understanding revision, rule key, subject identity, evidence/source refs, goal, success criteria, executor recommendation, context needs, proposed limits and `proposed|accepted|dismissed|superseded|withdrawn`. The executor recommendation is a discriminated union of a published specialist reference, a proposed specialist role, a workflow reference or a human clarification. Only published specialists are dispatchable in the first assignment slice; other kinds open the appropriate review/editor flow.

Separate `findingKey = hash(coordinatorId, ruleKey, subjectKind, subjectId)` from `evidenceHash = hash(sorted source revision refs, relevant assertions)`. A new relevant evidence hash can supersede a finding without changing its stable identity. Dismissal suppresses the same finding/evidence pair. Unrelated source changes do not bypass suppression. Hash inputs exclude timestamps and generated prose.

An assignment records its suggestion when present, exact executor, goal/input/schema, context revisions, actor, parent work, budget root, admission reservation and resulting work item. Work state is joined from `wa_work_items`; do not store a second mutable copy. Assignment attempt IDs differ from retry idempotency keys. A retry of the same command returns the same assignment; a user-requested new attempt creates a new assignment and records its reason.

## Database design

Add migrations after the current `007-context-uploads.sql`; reserve final sequence numbers when implementation starts. Retain checksum validation and all existing migrations. Use `text` IDs for compatibility with UUID and deterministic hashed work IDs, `bigint` for versions/cursors, `timestamptz` for dates and constrained JSONB for validated payloads. Serialize bigint cursors as strings; agent revision numbers must stay within JavaScript safe integer limits.

All tables include `workspace_id` and composite foreign keys to tenant-owned records. Immutable records have no general update API. Do not rely on client-provided workspace IDs or database row-level security that does not currently exist.

| Table                           | Columns and constraints beyond workspace/id                                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `wa_agent_definitions`          | `kind`, `name`, `description`, `owner_id`, `draft`, `draft_hash`, `edit_version`, `published_revision`, `enabled`, `archived_at`, created/updated timestamps; kind check; published pointer constrained to same identity |
| `wa_agent_revisions`            | `agent_id`, `revision`, `definition`, `content_hash`, `created_by`, `publication_command_id`, `created_at`; PK `(workspace_id,agent_id,revision)`, immutable rows                                                        |
| `wa_workspace_agent_bindings`   | PK workspace; coordinator ID/revision/hash, understanding ID, edit version, activation command ID; composite FKs; exactly one active pointer, not one active row per coordinator                                         |
| `wa_setup_runs`                 | Template ID/revision/hash, purpose `initial                                                                                                                                                                              | reconfigure`, actor, work ID, inspected source refs/hash, expected binding version, result bundle ID, state and edit version |
| `wa_setup_bundles`              | Setup run, validated result JSON/hash, understanding ID, coordinator draft ID/version/hash, coverage receipt manifest/hash, created time; immutable review snapshot                                                      |
| `wa_workspace_understandings`   | Parent ID, generating work, assertion/evidence JSON, coverage JSON, source manifest/hash, content hash, accepted command ID nullable; immutable content, acceptance linked by separate decision                          |
| `wa_understanding_dependencies` | Understanding/assertion ID, artifact/revision ID or decision ID, dependency kind; indexes for source invalidation                                                                                                        |
| `wa_agent_suggestions`          | Coordinator ref, understanding ID, finding/evidence hashes, validated proposal JSON/hash, state, edit version, created/updated; unique `(workspace_id,coordinator_id,finding_key,evidence_hash)`                         |
| `wa_agent_assignments`          | Suggestion ID nullable, executor ref, actor ID, context/input JSON/hash, parent work nullable, budget root ID, reservation ID, request ID, work ID nullable; one request per assignment                                  |
| `wa_agent_commands`             | Actor, operation, target ID, client key, request hash, result JSON, created time; unique `(workspace_id,actor_id,operation,client_key)`                                                                                  |
| `wa_agent_channels_v2`          | Agent ID, audience key, session ID; unique `(workspace_id,agent_id,audience_key)`; replaces neither existing sessions nor legacy channel immediately                                                                     |
| `wa_agent_event_targets`        | Source event, target binding/revision, causal root, request ID; unique `(workspace_id,source_event_id,target_binding_id)`                                                                                                |
| `wa_agent_budget_roots`         | Limits, reserved/consumed accounting, period or parent root, edit version; serialized admission under lock                                                                                                               |
| `wa_agent_budget_reservations`  | Root, assignment/work, maximum turns/tools/tokens, state, observed consumption, admission key; unique assignment reservation                                                                                             |

The published-pointer FK on definitions creates a cycle with revisions. Add it after table creation, nullable initially; publication inserts the revision before updating the pointer, in the same transaction. Coordinator activation additionally verifies `kind='coordinator'` in the locked service transaction; a foreign key alone cannot enforce that role.

Add nullable agent target, execution snapshot/hash and actor fields to requests/work. A work item uses either legacy `config_snapshot` semantics or `execution_snapshot` schema v1, never an ambiguous mixture. Sessions gain nullable `agent_id`; individual work items pin revisions, so a new goal in the same agent session may use a new published revision without changing historical work. Session summaries store their source work/snapshot references and must be regenerated or filtered if resource scope narrows.

Add `agent_id`, revision and assignment attribution to context manifests, schedules, memory and domain audit/event payloads where applicable. New scoped memory uses `workspace|agent|session|assignment` plus the corresponding reference and explicit acceptance decision. Existing memory is labeled legacy and remains on the legacy execution path until reviewed classification.

Index list queries by `(workspace_id,updated_at DESC,id DESC)`, assignments by agent and creation cursor, suggestions by state/finding, dependencies by artifact revision, pending event targets and pending requests by dispatch order. Count queries must exclude archived/deleted presentation records consistently while retaining durable receipts.

## Transaction and concurrency protocols

Use PostgreSQL advisory transaction locks for workspace lifecycle changes. New registry/intake/setup/assignment/lifecycle commands acquire the same `wa-v2-command:<workspace>` lock before record locks. This deliberately serializes short admission/control transactions in the first release; it does not serialize model network waits. Acquire rows in order: workspace policy, coordinator binding, definitions sorted by ID, budget roots sorted by ID, suggestion/setup, session, work. Retrofit interacting session-delete and publish/apply paths to this order where necessary. Existing execution lease fencing remains separate.

Every mutating API accepts `clientKey` and expected target version/hash. Under the command lock, check `wa_agent_commands` first. Same command/hash returns its stored response; different hash is 409. Insert the command receipt in the same transaction as the mutation/outbox record. Never commit a receipt that claims queued execution without its request/outbox.

### Publication

1. Authorize manage; lock policy and definition; check editable state, expected edit version and draft hash.
2. Validate strict definition, template restrictions, context access and registered tool/model/skill references. Immutable server-held references may be loaded before the transaction, but compare their hashes and current enablement under lock. Remote MCP discovery is a separate preparatory operation, not a transaction-time network call.
3. Set revision to the next number allocated under the definition lock, insert immutable revision, update published pointer/edit version, and record audit and command response.
4. Do not automatically enable it, retarget triggers or activate it as coordinator. Publishing and activation are distinct commands. The activation transaction below may publish the exact reviewed coordinator draft as part of that explicit operation.

### Setup result and activation

Bootstrap requires workspace policy enablement, explicit `allowModel`, a configured MiniMax connection and an owner/admin actor. Setup target resolution uses a server-packaged immutable template, not the missing coordinator pointer. Treat setup as a restricted first-class target, not a hidden admin override. A development/testing fixture does not grant live model consent.

`POST /setup-runs` writes setup identity, immutable source manifest and an intake request atomically. The template permits source reads and typed questions plus final structured output; it cannot invoke publication, activation, assignment dispatch or domain write tools. Reuse the harness's output validation, bounded repair attempts and work lifecycle. Generation uses one known setup work item; it cannot recursively invoke another setup agent.

After validated completion, an idempotent projection keyed by `(workId,resultHash)` creates the understanding, coordinator draft and setup bundle. If the process crashes between completion and projection, a reconciler repeats only the deterministic projection. It must not rerun the model. Multiple draft alternatives generate separate bundles; they never mutate a reviewed bundle.

Activation request contains setup/bundle IDs, bundle hash, expected binding version, coordinator draft edit version/hash and explicit accepted-gap IDs. In one command transaction:

1. Check actor authority and setup readiness; reload reviewed bundle and its actual source dependencies.
2. Reject stale required sources, missing evidence, changed policy, edited draft or replaced binding with a conflict carrying refresh information. Optional accepted gaps cannot excuse missing credentials/consent.
3. Publish the exact coordinator draft if necessary, record the understanding acceptance decision, and update the single workspace coordinator pointer.
4. Mark setup activated; record audit, command response and a domain outbox event.

Do not enqueue unsolicited model work in the activation transaction. A reviewed trigger rule may schedule the first coordinator inspection as a separate, attributable request. Reconfiguration uses the same protocol against a nonzero binding version, preserving the old pointer until commit.

### Suggestion acceptance

Accept requires suggestion ID/version/hash, exact published executor reference and an optional bounded context/input adjustment. Under the command lock, authorize the actor, check source freshness, verify unchanged suggestion, resolve executor and scope, reserve budget, insert assignment and intake request, and change suggestion state to accepted. The request ID is allocated in this transaction; the existing dispatcher later materializes session/work.

Do not hold this transaction across harness execution or call a pool-owned enqueue helper from inside it. Refactor intake into `enqueueInTransaction(client,...)` plus the public transaction wrapper. A crash before dispatch leaves a pending assignment/request, not a lost acceptance. When dispatch creates work, link the assignment in the same work-creation transaction.

Duplicate acceptance with the same key returns the same assignment. Concurrent different acceptance keys for an already accepted suggestion return its existing assignment or a 409, without reserving twice. A deliberate second attempt uses a distinct retry command naming the prior assignment and reason. Dismissal writes a decision and suppression identity; source freshness determines whether a later suggestion supersedes it.

### Pause, cancellation and safe boundaries

Pause changes operational enablement and writes a control event. Before every new model/tool issuance, `authorizeExecution` checks this flag and all current grants. Mark affected new/queued work suspended. An active issued call may finish and record its result; do not cancel its database receipt or declare it unexecuted. Prevent subsequent issuance and settle at the next safe boundary. If aborting a provider request produces an uncertain outcome, retain `uncertain` rather than rewriting it as paused.

Make the authorization check and transition to the existing `wa_calls.state='issued'` atomic under the command lock. Pause and issuance therefore have a defined ordering: calls admitted as issued before pause may complete; later calls cannot be issued. The network call runs after transaction commit. A crash in that interval remains an uncertain issued receipt, preserving the no-repeat guarantee. Checking a flag in a separate pool read before inserting the receipt is insufficient.

A waiting interaction may accept and retain an authorized answer while paused, but cannot resume until the agent and current policy permit it. Preserve the saved next-turn position and pending interaction. Explicit resume revalidates the original revision and context; it never upgrades to the latest agent revision. Archive prevents resume/new invocation; users may inspect history. Cancellation remains a separate work-level action.

## Invocation resolution and runtime enforcement

Implement two functions:

```ts
resolveInvocation(client, principal, target, restrictions): Promise<ExecutionSnapshotV1>
authorizeExecution(client, workId, operation): Promise<EffectiveExecutionAccess>
```

The first creates the immutable snapshot at admission. The second loads that snapshot and intersects it with current actor membership, workspace policy, agent enablement, tool availability, connection access and scope restrictions. Snapshot expansion is forbidden. Any new authority requires a new assignment; reduced access either filters reads safely or suspends the operation with a specific reason. Do not silently swap credentials, tool revisions or source revisions.

The existing `AgentService.authorize` uses `work.sponsor_id` and requires exact workspace configuration version equality. Keep those semantics for legacy work. For schema-v1 snapshots, authorize the stored invocation actor, retain sponsor separately for automation accountability, and use current policy as a ceiling over the pinned snapshot. Configuration changes that only expand policy do not expand the snapshot; revocations apply immediately. An owner/admin reviewer can accept a specialist request, but an editor's direct invocation is never executed as that admin.

Until a provider/model allowlist is represented in workspace policy, require the agent connection/revision to equal the workspace-configured MiniMax connection/revision. Future multi-connection policy is additive. An administrator publishing a definition alone cannot bypass this workspace restriction.

Represent effective scope explicitly: readable artifact/revision IDs, inventory visibility, permitted receipts/work families and memory scopes. Enforce it in `workspace_describe_v1`, artifact reads, source blocks, resource-link generation, memory/result/task reads, uploaded context and understanding retrieval. The returned description cannot disclose resource names merely because it is metadata. Empty scope means no resource access, not all access. Context inherited by a child is a subset of parent scope.

Resource-restricted sessions cannot reuse an old summary containing broader data. Track summary source scope hashes and evidence dependencies; recompute from currently authorized messages/receipts or omit unavailable history. A UI authorization check and a narrow initial attachment set do not protect context construction by themselves.

### Tools and approvals

Resolve the tool manifest once at admission and persist exact provenance/schema hashes. Only authorized tools appear in `modelTools`, search results, MCP discovery projections and later loaded schemas. Immediately before dispatch, verify the call is in the same effective manifest and recheck registered effect/current enablement. A forged tool name must fail before issuing an external effect or consuming approval.

Permission ordering is `never < ask < always`; the effective value is the most restrictive applicable rule. An agent setting of always cannot bypass the current extension write approval protocol. In the first release, all tools classified as write retain exact argument-bound approval, even when the library exposes always. Show the enforced value in the UI. Proposal creation remains distinct from proposal application and cannot bypass the existing hash/version review gate.

Tools needed for this feature are narrow, host-authorized contracts:

| Tool                                 | Output/effect                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| `workspace_understanding_read_v1`    | Paginated authorized assertions/coverage; read                                       |
| `agent_definition_search_v1`         | Published specialists visible and invocable by this actor; read                      |
| `workspace_suggestion_propose_v1`    | Validated deduplicated suggestion record; planning metadata, no assignment execution |
| `workspace_understanding_propose_v1` | Staged understanding revision with verified evidence; no automatic acceptance        |

Setup uses its final typed result for coordinator configuration; no general agent-publish tool is exposed. Initial coordinator dispatch has no autonomous assignment tool. Later policy-bound read-only dispatch is a separate capability with a durable authorization receipt and aggregate admission limit. Extend `toolArguments`, tool outputs, effect classification and lifecycle deletion rules together. Unknown metadata effects remain non-deletable until classified.

### Channels, fairness and durable dispatch

The legacy `wa_agent_channels` is one row per workspace. V2 uses agent plus audience: `user:<actorId>` for direct work, `ambient:<ruleId>` for event work, and dedicated assignment sessions for specialists. No user accidentally continues another user's hidden context. Sessions are agent-bound, and answers derive their target from the existing work; an answer payload cannot change agent identity.

Refactor drain selection to choose an eligible channel head, prioritizing valid answers, rather than repeatedly blocking on the oldest busy channel. Preserve order within a channel. A busy coordinator waiting for a decision must not prevent unrelated eligible read-only specialist work from entering the runtime. The existing writer lease still determines actual exclusive execution; reader tasks use existing reader leases only when their manifest and policy qualify as read-only.

The dispatch transaction reuses request-derived stable message/work IDs after a crash, creates session/message/work/outbox and links assignment/request together. Do not split work materialization and acknowledgment in a way that selects a new agent revision on replay. Policy denial becomes a rejected request with a reason; optimistic conflicts use bounded retries and observable queue age, not an invisible infinite loop.

Register DBOS workflows once with stable application names at startup. Agent definitions are database data, not dynamically registered workflow functions. Keep the existing command outbox activation identity and turn fencing; include the resolved snapshot hash in its provenance. Projection reconciliation uses database receipts keyed by completed work/result hash and the existing durable worker lifecycle, rather than introducing one timer or independent worker loop per agent.

## Budget accounting and event routing

Keep existing per-work limits. Add aggregate admission before automatic/delegated work: a root budget is associated with the coordinator activation or approved automation period. Reserve child ceilings under a root lock; committed reservations plus consumed totals cannot exceed the root. Count compaction and draft-generation model usage as well as ordinary calls. Children cannot allocate additional budgets outside their ancestors' limits.

Store reserved capacity separately from actual usage. Completed work reconciles measured usage and releases unused capacity once by receipt. Uncertain model/tool usage retains its reserved upper bound until resolved or conservatively charged. Do not assume an interrupted request cost zero. Work without authoritative provider token usage retains unknown usage plus reserved capacity; do not display invented dollar costs. Initial automatic dispatch stays disabled until this aggregate path is tested.

Event bindings pin agent revision, filter revision, sponsor and limits. Build event targets transactionally from existing domain outbox/inbox records. Current inbox uniqueness is one source event per workspace, so fanout belongs in `wa_agent_event_targets`, not by inserting duplicate inbox rows. Idempotency includes source event and target binding. Schedules include schedule ID, scheduled timestamp and pinned binding in their request identity.

All generated events carry `causationId`, `rootEventId`, `originWorkId` and bounded hop count. Filters ignore self-generated planning metadata and coalesce repeated changes to a source before review. The coordinator cannot modify its trigger rules. Source updates create invalidation records and supersede affected pending findings; they do not rewrite accepted understanding content. Read projections expose freshness computed from these dependencies.

## Process and delegation integration

Retain `stackproc.process-agent.v1` and old inline process definitions. Introduce a new versioned binding/handler only for named agents, with `{agentRef,input,outputSchema,tools,deadlineSeconds,maxTurns}`. Compiler output includes the exact reference and definition hash in its manifest. Do not overload the existing strict `processAgentDefinitionSchema` and break historical run snapshots.

At execution, use the existing run actor and validate the same-workspace published specialist. Effective tools are the intersection of the process's current read-only tool ceiling, activity restriction and agent revision. Input and output schemas must be compatible or explicit mappings must validate both at runtime. No interactive specialist may be bound to a non-interactive process activity unless its selected execution profile guarantees structured output without user waits. Parent run failure/cancellation continues to reconcile child work.

`AgentTasks.delegate` gains a versioned named-specialist path while preserving old goal-only delegation. Exact revision, ancestry, scope and budget references are copied into the child. Parent waiting releases the activation's writer lease before child execution; waiting must not deadlock the child by holding a writer lease. Preserve max depth/children and read-only child enforcement. Cross-agent assignments are observable children, not an undisclosed second delegation system.

## API and error contracts

Use the authenticated workspace from `ControlService.context`. V2 command bodies include `{clientKey,expectedVersion,...}`. Definition publication also requires a draft hash; setup activation requires bundle and binding guards. List endpoints return `{items,nextCursor}` using stable timestamp/ID cursors, filters and bounded page sizes. Summary queries report the configured workspace timezone or UTC explicitly.

| Endpoint under `/api/agent`                                        | Permission and response                                                                            |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `GET /definitions`, `GET /definitions/:id`                         | Read authorized data; actions include server-projected capabilities                                |
| `POST /definitions`, `PATCH /definitions/:id`                      | Editor or manage role, within policy; 201/200 definition draft                                     |
| `POST /definitions/:id/publish`                                    | Manage; immutable revision receipt                                                                 |
| `POST /definitions/:id/pause`, `/resume`, `/archive`, `/duplicate` | Manage, with duplicate producing only a draft                                                      |
| `POST /definition-drafts/generate`                                 | Authorized draft author; 202 request/work receipt using setup-style restricted generation template |
| `POST /setup-runs`, `GET /setup-runs/:id`                          | Manage for start, authorized read for inspection; 202/200                                          |
| `POST /setup-runs/:id/activate`                                    | Manage; binding/revision/understanding activation receipt                                          |
| `GET /understanding`, `GET /suggestions`                           | Scoped read; include freshness, evidence and permitted actions                                     |
| `POST /suggestions/:id/accept`, `/dismiss`                         | Execute/review authority plus executor/resource constraints; accepted assignment receipt           |
| `GET /assignments/:id`, `GET /definitions/:id/summary`             | Scoped activity and measured aggregates                                                            |
| `POST /requests`                                                   | Existing route extended with optional target; no target resolves coordinator at admission          |

Do not use default route classification `non-GET → execute` for manage operations. Perform action-specific checks in both routes and service methods. Draft authorship never permits editing platform setup templates or changing an agent's kind to obtain coordinator authority.

Errors use `{error,code,details?,retryable}`: 400 malformed commands, 401 missing session, 403 denied action, 404 unavailable/foreign resource, 409 version/key/freshness conflict, 422 invalid executable configuration, 429 aggregate admission limit. Details contain safe current versions and conflict categories, not foreign identifiers, secrets or inaccessible source text. Existing legacy endpoints retain their response contracts.

Audit actions include definition drafted/published/paused/archived, setup started/bundle staged/activated, understanding accepted/invalidated, suggestion proposed/accepted/dismissed, assignment admitted/blocked and budget reserved/reconciled. Record actor, target, pinned hashes and command IDs. Store source text in its authorized content store, not audit metadata.

## UI adapters and state ownership

Use the component reuse map in the product spec. Add adapters under `lib/agent/` for library view models; application compositions own fetching and commands, while vendor components remain presentation. Import missing licensed sources with original snapshots/provenance before adapting them. Do not hand-build Agent List, Agent Create or Agent Summary replacements.

| Adapter             | Mapping                                                                                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Definition list     | Identity availability plus latest run state; omit unsupported callbacks, map referenced deletion to archive through a properly labeled action rather than pretending it is delete            |
| Agent Create        | `onSubmit` creates durable generation request; provisional validated fragments map to draft preview; `onStop` cancels that work; `onOpen` opens persisted draft only                         |
| Agent Summary       | Publication/enablement map to draft/live/paused; work failures and review needs use attention state; run bars come from authoritative daily aggregates                                       |
| Tool/model settings | Display effective enforced policy alongside requested draft settings; no unsupported provider/fallback controls                                                                              |
| Setup review        | Generative Form collects unresolved answers; Artifact Panel presents understanding/configuration versions; Agent Gate submits the exact activation command, with demo auto-approval disabled |
| Activities          | Existing inspector consumes work hierarchy, event cursor and receipts with agent/assignment labels; sessions remain nested history                                                           |

A host-controlled `?view=activities|suggestions|agents&agent=...&activity=...&setup=...` route state restores selection on refresh. Keep legacy `session` deep links opening their activity/history. Switching agents cannot reuse pending answer forms, upload drafts or idempotency keys from another selection. Scope cached data and event reducers by workspace/agent/work ID, and clear unavailable data on membership changes.

Split `hooks/use-intelligence.ts` into explicit definition/setup/suggestion/activity query responsibilities when implementation warrants it; do not add polling to every vendor component. Reuse existing workspace SSE for invalidation and selected work streams for activity. Sanitized aggregate changes use existing event infrastructure or a transaction-backed projection event, not browser inference. Deduplicate cursors as strings, reconcile after disconnect, and cancel obsolete fetches without cancelling backend work.

One work-area header owns title, search/filters and contextual actions. Tabs sit immediately beneath, flush to the content edge. The content region alone scrolls. In an agent detail, compose the library summary without duplicating the outer page's title/actions. Approved theme adaptation uses existing Geist/charcoal/square-control tokens, accessible icon actions and reduced-motion support. No retired orb, new chat-first shell or duplicate workflow canvas.

## Rollout and verification

Feature gates are independent: definition storage/resolution, definition UI, setup activation, suggestion acceptance, ambient routing and named process binding. Automatic assignments remain off by default. Gate checks are server-side as well as UI-side.

1. Add storage and resolver behind a flag. Populate no new live definitions automatically. Keep all legacy authorization and replay tests passing.
2. Add manual definition publication and library administration. Require real server contracts before exposing callbacks.
3. Add restricted setup templates, result projection, reviewed activation and source coverage. Exercise a new workspace and explicit adoption of a legacy workspace.
4. Add suggestions, explicit assignments, scope enforcement and aggregate reservations. Prove two agents cannot leak context or exceed admission limits.
5. Add event/schedule routing with sponsor reauthorization, invalidation and deduplication. Enable bounded read-only automation only after its admission and feedback-loop tests pass.
6. Add versioned named process/delegation adapters. Preserve old compile/run snapshots and read-only restrictions.

Do not downgrade schemas or delete revision records on rollback. Disable new admission while retaining pinned history readers and already-issued receipt reconciliation. A rollback that cannot execute new snapshots suspends them explicitly instead of falling back to legacy instructions. Existing legacy channel/schedules remain unmapped until an administrator reviews adoption; no hidden setup calls or live policy changes occur during migration.

Required tests:

- Contract tests: strict schemas, canonical hashes, malformed tool provenance, incompatible input/output schemas, prohibited role/kind changes and revision bounds.
- Transaction tests: concurrent publication, coordinator activation, accept/dismiss, duplicate commands with conflicting hashes, pause-versus-dispatch, source-change-versus-activation and budget reservation races.
- Isolation tests: actor versus sponsor authority, cross-workspace agent/context/evidence/receipt access, narrowed session summaries, memory scopes and server-backed resource-link filtering.
- Durable tests on port 3022: crash after admission/before dispatch, after model completion/before setup projection, after activation commit/before response, and after assignment work creation/before acknowledgment. Assert no repeated calls or duplicate assignments.
- Concept tests on port 3024: typed questions, duplicate/stale answers, cancellation, revision pinning, tool allowlists at discovery and dispatch, approved write restrictions, process child reconciliation and parent/child budget accounting.
- Event tests: source-event fanout uniqueness, no self-trigger loops, dismissed finding suppression, changed evidence supersession, schedule revision pinning and sponsor revocation.
- Browser tests: licensed loading/empty/error states, setup-to-activation flow, explicit specialist assignment, reliable progress/review states, keyboard focus and scroll ownership at narrow widths/zoom. No synthetic run counts.
- Live MiniMax evaluation: source-grounded setup, a structured clarification, partial large-ontology coverage, a justified suggestion and bounded specialist output. Treat deterministic fixtures as protocol evidence, not proof of model compliance.

Run `npx vitest run`, the applicable port 3022/3024 integration suites, and `npm run build` for each delivered slice. The implementation record below distinguishes executed checks from remaining rollout gates.

The release criterion is one reproducible path from new workspace through imported knowledge, reviewed coordinator activation, justified suggestion, published specialist assignment and explicit result review, with every command and execution traceable to an actor and immutable agent/source revisions.

## Implementation record · 2026-10-20

The first executable lifecycle is implemented on the owned Stack Proc harness and existing DBOS queues. Migrations 008–013 add agent identities/revisions, idempotent commands, setup bundles and immutable review history, accepted workspace understanding, coordinator bindings, suggestions/assignments, and automatic-review admission records. Existing sessions, schedules and process-agent v1 snapshots retain their previous routing.

Delivered behavior:

- Owner/admin setup uses a hidden immutable read/ask template, selected saved revisions and typed questions. Its validated final result becomes a review bundle. Administrators can revise purpose, goals, gaps and coordinator configuration, explicitly accept gaps, then atomically publish/activate the exact reviewed bundle. The UI offers a checked initial-inspection option; compatibility callers must explicitly request it. Activation itself never dispatches specialists.
- Editors can author specialist drafts. Administrators separately publish, enable, pause, duplicate and archive identities. Duplication creates an inactive unpublished draft. Every assignment pins its definition/source revisions, accountable actor and policy ceilings; current revocation can narrow execution at issuance. A failed run never changes publication state.
- Coordinator suggestions distinguish an uninspected knowledge gap from an observed finding. Observed findings require real source-read receipts from the activity. Explicit acceptance revalidates executor/context freshness and atomically admits one read-only specialist assignment; duplicate acceptance returns the same receipt. Assignments are linked into existing task/activity history.
- An administrator can opt into coalesced `knowledge.saved` reviews for the active coordinator. The persisted rule pins its revision and actor and bounds daily review admissions and token reservations. Pauses preserve pending changes. Rule replacement/revocation stops work at safe issuance gates. Unknown model outcomes retain reservations; resumable suspended work does not release its reservation. Daily tokens are an admission budget checked between model calls, not a guarantee against one model call overshooting. Specialist dispatch remains human-reviewed. Legacy schedules and other triggers are not silently adopted.
- Process activities can select an enabled published structured-output specialist. `stackproc.process-agent.v2` pins `{agentId,revision,hash}`, requires the exact published output contract, intersects profile/activity/read-only tool restrictions, narrows turns/deadline, and records the execution snapshot. The compiler manifest retains the reference. Historical inline `stackproc.process-agent.v1` is unchanged. Both use the existing durable host and parent-run cancellation reconciliation.
- Activities, Suggestions, Agents and Workspace setup compose licensed AI SDK Agents/Cult components. Agent List/Create/Summary originals and hashes are retained under `vendor/aisdkagents`. Official Untitled UI supplies controls; no second SDK runtime, orb or replacement chat shell was introduced. Agent/setup selection has restorable URLs and bounded scrolling.

Verification: 281 default tests, 33 isolated harness concept integration tests, and 70 runtime regression tests passed; subsequent targeted checks cover duplication/archive and incompatible named-process schemas. The production build passed. Browser inspection verified saved draft configuration, publication review, selection after reload, and 720px-wide bounded scrolling. No live MiniMax evaluation or real-workspace activation was performed in this implementation pass.

Rollout boundaries still open: published profiles currently support the enumerated built-in knowledge tools only; extension/MCP/skill manifests and permission-mode controls are not exposed as supported named-profile capabilities. Named-agent schedule adoption, automatic named delegation without reviewed assignments, exhaustive result-review management, paginated administration beyond the bounded first page, and independent rollout flags remain follow-on work. Source coverage is conservative (uninspected/partial), not a claim of complete OWL understanding. Live source-grounded MiniMax evaluation remains a release gate; deterministic provider fixtures establish protocol behavior only.

## Layout restoration · 2026-10-20

At the user’s request, the prior layout is restored: Activities, Suggestions, Agents and Workspace setup remain separate tabs; agent details use the licensed Agent Summary; conversations retain the session sidebar and Session Tabs. The single-header/configuration-menu redesign is withdrawn. Activity-specific reading improvements are retained independently of the layout. No backend/runtime changes or data migrations accompany this restoration. Verified with the production build and browser inspection.

### App Sidebar host · 2026-10-20

`components/intelligence/intelligence-shell.tsx` composes licensed `AppSidebar` and `ChatLayout`. Lifecycle views and the instruction workbench share it. `FullscreenWorkbench` accepts optional leading content and brand/back visibility with unchanged defaults for other consumers. Overview reads existing lifecycle inventory, understanding, suggestions and activity endpoints; no new backend contract. Compact navigation uses the library layout context and overlay behavior. Activity lists select only the Started column when no other telemetry is available.

Verification: production build passed; default Vitest suite passed 281 tests (107 integration tests skipped by that suite). Browser checks covered Overview, Activities, Suggestions, Agents, Workspace setup, opening a specific historical activity, desktop rail collapse and 720px overlay navigation. At 1440×1000, document scroll dimensions equal the viewport; the lifecycle content owns its vertical overflow. No model request or configuration activation was submitted during these checks.

### Testing refinements — 2026-10-21

Completed executions retain an inline composer in the same working session. Each submitted instruction gets its own immutable work item and budget; this does not reopen completed tool receipts. Published-agent history is reused only when all work in the session has the same published configuration hash. A changed or narrower revision does not inherit earlier context. Process-activity executions remain isolated. Pending questions, proposals, uncertain outcomes and archived sessions retain their existing gates.

Suggestions are proposed activities from the coordinator's authorized knowledge and review rules. Acceptance starts the proposed activity; it does not apply knowledge changes. The page explains this even when suggestions are present. Agent record CTAs live in the persistent header. Instruction display uses the existing react-markdown/GFM renderer without raw HTML. Budget stops identify the exhausted limit and measured usage; caps are not increased automatically. Tracked in GitHub issue #7.

### Agent record scroll ownership

The Agents work-area frame does not scroll. Its page header/actions and agent record summary/Configuration–Activities tabs remain outside the content scroll region. The selected tab uses the bounded, keyboard-focusable `Agent record content` region. The agent list has its own bounded row viewport; narrow layouts retain both list access and reachable record content. No global sticky-position offsets or second page scrollbar are required.
