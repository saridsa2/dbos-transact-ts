# Workspace Context and Memory Technical Specification

Status: Opt-in first release implemented; remaining target contracts and rollout gates noted below
Date: 2026-10-21
Scope: Stack Proc owned workspace harness, MiniMax model boundary and DBOS durable execution

## Knowledge graph memory

Status: PostgreSQL graph storage and host integration implemented on 2026-10-21.
Migrations 017–018 register every persisted approved-memory version, history segment/head,
working checkpoint, saved answer and accepted workspace understanding atomically. New workspaces get a graph root;
saved/imported knowledge revisions seed canonical concepts, properties, inheritance,
relationships, process elements, lanes and sequence flows. Existing records are backfilled
without rewriting their canonical encrypted content.

The portable repository and pure PageRank are adapted from MIT-licensed
`adoresever/graph-memory` at commit `5841b1987c3967998818764c9d4238add5f3aa7c`.
The clone is a separate sibling repository. The host vendors only the reviewed storage
entry point and ranking algorithm with license, hashes and a reproducible refresh script.
No DSH/OpenClaw runtime, provider client or context takeover is imported.

`WorkspaceGraphMemory.prepare` processes at most one currently approved memory per
context-preparation step, through existing MiniMax model receipts, authorization and
cumulative budgets. It stores encrypted lexical navigation terms and predicates, owned
by the exact approved memory version. These are retrieval aids, not newly approved
business facts or entity identity merges. Malformed output is quarantined; unknown
requests are not repeated; completed receipts replay graph persistence without another
model request. Empty-triple results still retain graph membership. Historical and
session/checkpoint nodes retain provenance and their existing scoped history access;
they are not automatically promoted into cross-session approved facts.

Gemma/Mem0 semantic entry points and lexical hits seed bounded PageRank over only
authorized current memory versions and their owned terms. Reciprocal rank fusion adds
graph-connected approved memories; canonical evidence, agent scope, expiry and final
authority checks still apply. Exceeding graph limits emits a degraded-state event and
retains canonical recall. Graph status distinguishes pending current versions from
superseded, expired or unapproved versions. The owner/admin Memory screen composes
the existing ontology renderer and official controls for overview, knowledge-map and
memory-relationship views. Its graph panel header groups the title and visible/loaded
node counts on the left, with a width-bounded view selector and accessible icon-only
refresh on the right. Controls wrap together below the title at narrow widths; refresh
is disabled while loading. Agents receive the narrower per-activity projection.

### Remaining semantic target

The following typed-domain assertion/identity contracts are a future layer. This release
implements mandatory graph membership and evidence-owned navigation. It does not
claim ontology reasoning, automatic real-world entity resolution, full original RDF
coverage, contradiction resolution or reviewed typed literal/domain-fact extraction.

Semantic workspace memory must represent entities and explicit, evidence-backed relationships,
rather than treating independent prose entries and similarity scores as the complete memory model.
The graph is the canonical representation of approved semantic assertions. Embeddings are a
derived retrieval index; raw activity receipts and episodic observation history remain separate,
authoritative records rather than being discarded or silently promoted into facts.

### Meaning and identity

- Reuse authorized ontology class/property identifiers as vocabulary. Keep ontology types
  distinct from individual business entities, process definitions, process executions and decisions.
  A class named Customer is not a real customer record.
- Link graph nodes to exact artifact revisions, stable ontology entity IDs, process element IDs,
  agent revisions and activity/receipt IDs. Do not merge two entities merely because labels match.
- Represent facts as first-class assertions with subject, predicate and object (entity or typed
  literal), evidence references, scope, status, version and validity interval. This permits multiple
  conflicting claims and their provenance without overwriting the historical record.
- Useful graph relationships include `instance_of`, domain predicates from the ontology,
  `requires`, `supported_by`, `decided_in` and `supersedes`. Structural process relationships
  come from the stored process, not inferred bank-policy claims.
- Example: a stored onboarding process contains its KYC step; a reviewed assertion identifies
  an unresolved policy requirement for that step; that assertion links to the BIAN source revision
  and the review decision. This is distinct from claiming KYC has been performed on a customer.

### Authority and lifecycle

All graph identities and references are workspace scoped with composite foreign keys. Store
assertion text and sensitive entity attributes with the existing vault encryption. Structural
links do not confer permission to read a connected resource. Generated facts, aliases, identity
merges and corrections are proposals until the existing owner/admin review authorizes them.
Publishing a source does not automatically approve every model-inferred assertion about it.

Approval, supersession, revocation and expiry update graph visibility and index work atomically.
Changing a source revision marks dependent assertions stale until reviewed; contradictory
assertions retain their separate evidence and must not be silently reconciled by the model.
Retain the existing durable command keys, audit records, scope fingerprints and cumulative budgets.

### Retrieval and implementation boundary

Begin with versioned node, assertion and evidence tables in the existing PostgreSQL deployment;
a separate graph database is not required merely to introduce explicit graph semantics. Add new
migrations without modifying applied ones. Preserve existing text memories as legacy entries;
extract candidate assertions through a bounded, audited migration workflow rather than treating
automatic extraction as approval.

Retrieval combines Gemma semantic entry-point selection with bounded graph traversal and exact
identifier lookup. Revalidate every node, assertion and evidence reference against the current
published agent policy, authorized revisions, approval state and expiry before including it.
Never traverse an unauthorized intermediary to disclose a relationship. Bound traversal depth,
nodes, edges, returned evidence and output tokens; record the graph generation and assertion IDs
in the context manifest. Fall back only with an explicit degraded-state event, never by claiming
that unrelated vector hits establish a graph relationship.

The Memory screen should expose connected knowledge, assertion evidence and pending changes,
using the existing licensed graph/editor and review components. A graph visualization alone is
not implementation of this contract. Acceptance requires tests for identity disambiguation,
multi-hop retrieval, conflicting evidence, source changes, revocation, tenant isolation, encrypted
attributes and recovery without duplicate graph writes.

## Implementation record — 2026-10-21

The opt-in implementation is in `server/agent/context-memory.ts`, `server/agent/context-budget.ts`, `server/workspace-harness/working-context.ts` and the existing context/runtime facade. Migrations 014–015 add encrypted immutable working checkpoints, scoped memory entries/versions, idempotent review commands, request admissions and approved token grants. Previously applied migrations remain unchanged.

Published definitions explicitly select a versioned memory policy. Older revisions keep their original contract. Working memory summarizes complete cold rounds incrementally, retains protected goals/decisions and recent complete rounds, and excludes provider private reasoning from summary inputs. Exact receipt addresses, pinned artifact revisions and inspected ranges remain available in host-generated context manifests. Requests reserve estimated prompt/output tokens against the root activity balance, including summary calls and children. Estimates use bytes/3 plus a 20 percent margin; they are not billed-token counts.

Approved memory is encrypted, versioned, evidence-linked and disabled until an owner/admin approves it. Editors can propose entries. Retrieval checks workspace, agent, exact authorized revisions, current source heads, expiry and published memory policy before decrypting. Review/revocation uses a workspace memory lock shared with final request admission. Scope fingerprints include current workspace policy, sponsor membership, pinned agent/resources and active memory versions. Incompatible history is excluded; a current activity with changed authority pauses instead of recycling its old context. Management lists paginate; searches explicitly report truncation.

The Memory destination composes licensed Decision Inbox, Artifact Panel and Agent Gate with existing Untitled controls. Agent draft Memory settings, published-policy summaries and an execution Context and memory inspector are available. An owner/admin can approve a bounded token extension and resume a compatible checkpoint; original turn/tool/time ceilings, cancellation and uncertain-outcome protections still apply. Resumption does not repeat completed tool effects. Session deletion preserves histories that published approved memory.

Validation evidence:

- Context-dependent fixture: ten pinned source pages, three checkpoints and approximately 54,000 tokens under the original 200,000-token allowance.
- Real configured MiniMax-M2.7: activity `5af6711b-e2b1-4d81-aa93-8bae8de6c814`, five 8,000-character FIBO ClientsAndAccounts pages, two checkpoints, **56,865 recorded input/output tokens**, completed. The result explicitly discloses partial 40,000/94,847-character coverage. The separate read-only verification agent was paused afterward.
- The initial live attempt exposed missing source-activity identifiers in receipt references. Exact receipt addresses and default current-activity lookup were added, then verified through the successful rerun and an isolated tool round-trip test. Its 44,519 consumed tokens remain in audit history.
- Verification passed: 291 unit tests, all 36 isolated concept tests on 3024, all 70 runtime regressions on 3022, production build and browser inspection. Focused reruns additionally cover current-activity receipt lookup, missing/expired/foreign-agent memory exclusion, an uncertain-call resume rejection, known-failed-call advancement, over-ceiling grant rejection, idempotent resume and concurrent parent/child reservations. A regression exposed the coordinator/legacy event-intake handoff race; legacy intake now leaves coordinator-owned commits pending for its next reconciliation. Detailed run artifacts are retained locally under `.studio/memory-2026-10-21/`.

Current boundaries relative to the target design below:

- Working summaries are bounded encrypted text, with host-derived receipt coverage in manifests. The richer typed `WorkingCheckpoint` finding/decision object and a separate polymorphic dependency table remain target schema, not current storage.
- Source/memory/policy changes conservatively invalidate derived context; fine-grained dependency reuse is not enabled. Oversized protected context or summary input pauses safely rather than performing an unbounded multi-batch summary.
- Token extensions are implemented. Time/turn/tool extensions and automatic budget increases are not offered. Unknown provider outcomes retain reservations for review. No private-reasoning summaries, semantic embeddings or external memory service are introduced.
- Existing banking agents are not silently republished. Enable through Agents → Edit draft → Memory, save, review and publish. Approved retrieval and memory-proposal tools require explicit publication. The 40-round target is outside the current 12-turn published-agent ceiling and has not been claimed as verified.
- Keep broader automatic adoption disabled pending the remaining structured-checkpoint, exhaustive crash-boundary and longer-loop rollout gates. The implemented profile is available for explicitly reviewed agent revisions.

## Long-history extension — 2026-10-21

The separately published `observational_v1` history profile and `mem0_v1` approved-recall index are implemented in the [long-history extension](long-history-mem0-technical.md). Existing memory policies retain the behavior recorded above. The extension documents bounded observation/reflection, local embeddings, encrypted Mem0 integration, deployment configuration and the remaining scaling gates.

## Objective

Provide bounded, evidence-linked context for long-running workspace activities and continuity across instructions without resending an ever-growing transcript. Preserve immutable execution receipts, user approvals and workspace authorization. Token exhaustion must preserve a resumable checkpoint rather than require a new task description.

This layer runs inside the existing harness. It adds no second agent runtime, external memory service or autonomous source of permissions. DBOS remains responsible for durable workflow and step execution; the context coordinator owns prompt assembly and memory selection.

## Current implementation and defects

| Existing code                         | Current behavior                                                       | Required change                                                           |
| ------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `server/agent/context.ts`             | Session summaries, compaction calls and cumulative usage               | Become the compatibility facade over the coordinator                      |
| `server/workspace-harness/context.ts` | Complete-round grouping, byte-based compaction and receipt replacement | Preserve pairing; add token targets and protected context blocks          |
| `server/agent/definitions.ts`         | Published-agent access forces `compact: false`                         | Permit host compaction when both pinned and current policies allow it     |
| `server/agent/workspace-runtime.ts`   | Rebuilds context from session history and all completed activity calls | Assemble a durable summary plus observations after its cursor             |
| `lib/agent/definitions.ts`            | Published tool allowlist excludes memory and receipt retrieval         | Support explicitly published memory capabilities                          |
| `wa_memories`, `wa_memory_proposals`  | Approved answers/facts and proposal review                             | Preserve provenance; introduce scoped, versioned approved memory          |
| `AgentExtensions`                     | Trusted extension tools and hooks                                      | Keep extension boundary; memory storage uses a dedicated internal adapter |

The observed failed inspection made seven model calls, consumed 213,613 input/output tokens and emitted no compaction event. Context grew from 18,891 input tokens to 48,376. The cumulative budget and disabled published-agent compaction are separate problems; changing the stop message does not repair either.

## Invariants

1. Every lookup, receipt, snapshot, command and relationship carries `workspace_id`; composite foreign keys enforce workspace ownership.
2. The effective scope is computed by the server from current membership, pinned execution snapshot, current policy and resource access. Requests cannot supply their own authorization scope.
3. Summaries and approved facts are contextual data. They cannot grant capabilities, approve a proposal or override system instructions.
4. Source revisions and raw execution receipts remain authoritative. Compaction does not delete or rewrite them.
5. Current goal, accepted user decisions and pending interaction state cannot disappear into an unconstrained model summary.
6. A model/tool call with an uncertain outcome is never automatically reissued during recovery.
7. A granted spending budget is cumulative across activations, summarization and delegated children. Compaction does not reset it.
8. Process-agent executions retain their isolated input/output and capability contract. Cross-session memory is disabled for them unless separately published and authorized.

## Modules and ownership

| Module                                   | Responsibility                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `server/agent/context/coordinator.ts`    | Assemble requests, enforce context policy, select snapshots and memory |
| `server/agent/context/postgres-store.ts` | Persist snapshots, memory versions and retrieval metadata              |
| `server/agent/context/scope.ts`          | Calculate authority fingerprint and eligible evidence/memory           |
| `server/agent/context/compaction.ts`     | Incremental summaries and observation reduction                        |
| `server/agent/context/budget.ts`         | Usage ledger, admission estimates, reservations and grants             |
| `server/agent/context/estimator.ts`      | Provider token-count capability or explicit conservative estimates     |
| `server/agent/context/contracts.ts`      | Zod contracts and TypeScript interfaces                                |
| `server/agent/context.ts`                | Preserve existing imports during phased migration                      |

The store is replaceable through `WorkspaceMemoryStore`; authorization and budget logic are not replaceable by plugins. Existing extension hooks may observe host events without receiving model credentials, private reasoning or unscoped memory.

```ts
type ContextScope = {
  workspaceId: string;
  actorId: string;
  sponsorId: string;
  workId: string;
  sessionId: string;
  agentRef?: { agentId: string; revision: number; hash: string };
  authorityFingerprint: string;
  resources: Array<{ kind: string; id: string; revisionId: string }>;
}; // Internal: only scope.ts constructs this value.

interface WorkspaceMemoryStore {
  loadCheckpoint(scope: ContextScope): Promise<WorkingCheckpoint | null>;
  appendCheckpoint(scope: ContextScope, input: CheckpointWrite): Promise<CheckpointReceipt>;
  searchApproved(scope: ContextScope, input: MemoryQuery): Promise<MemoryPage>;
  propose(scope: ContextScope, input: MemoryProposal): Promise<MemoryReceipt>;
  review(scope: ContextScope, input: MemoryDecision): Promise<MemoryReceipt>;
  revoke(scope: ContextScope, input: VersionedCommand): Promise<MemoryReceipt>;
}

interface WorkspaceContextCoordinator {
  prepare(input: PrepareContextInput): Promise<PreparedContext | BudgetPause>;
  reconcileUsage(input: ProviderUsageReceipt): Promise<void>;
}
```

## Published contracts and defaults

Add an optional `memory` contract to new agent definitions and execution snapshots. Absence on an existing immutable revision retains its existing semantics; do not parse new defaults into historical content before validating its hash.

```ts
type AgentMemoryPolicy = {
  version: 1;
  session: 'off' | 'same_revision';
  working: 'off' | 'compact';
  approved: 'off' | 'agent' | 'workspace';
  maxRetrievedEntries: number; // 0..20
  maxRetrievedTokens: number; // 0..4000
};
```

New drafts default to `same_revision`, `compact`, and approved memory `off`, with a maximum of eight entries and 2,000 retrieved tokens when enabled. Owners/admins approve workspace-wide memory access through publication. Effective permissions are the intersection of pinned policy and current workspace policy; later restriction applies immediately.

Add scoped `memory_search_v2`, `agent_memory_propose_v2` and `agent_result_read_v2` to the supported published capabilities. Existing v1 tools retain their existing legacy contracts. Selecting a tool in a draft requires republishing before invocation. Memory proposal remains a write capability requiring review; read-only delegated execution cannot propose memory.

Host-managed compaction is an internal lifecycle capability, not permission to search arbitrary data. The host can rehydrate an eligible observation already produced by this activity without granting the model a new tool. Receipt references advertised to the model must either have an authorized retrieval tool or be transparently rehydrated by the host; never emit unusable instructions.

## Data model

Reserve migrations `014-context-memory.sql` and `015-context-budget.sql` if these versions remain free at implementation time. Applied migrations remain unchanged. Use the existing checksum-verified initialization sequence and tenant-safe migration transaction.

### Working snapshots

`wa_work_context_snapshots` is append-only:

| Column                                        | Contract                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `workspace_id`, `work_item_id`, `revision`    | Composite primary key; workspace/work foreign key                                                            |
| `scope_hash`, `agent_hash`, `policy_revision` | Authority and configuration used to create the snapshot                                                      |
| `through_turn`                                | Last complete model/tool round represented; cannot include a pending call                                    |
| `through_message_ordinal`                     | Session message cursor represented in the snapshot                                                           |
| `summary`                                     | Existing vault-sealed JSON; never returned as plaintext by list endpoints                                    |
| `source_hash`                                 | Canonical hash of input summary, covered receipts, decisions and scope                                       |
| `summary_call_id`                             | Nullable composite reference to the completed summarization receipt; null only for deterministic checkpoints |
| `created_at`                                  | Database timestamp                                                                                           |

Unique `(workspace_id, work_item_id, scope_hash, source_hash)` prevents duplicate checkpoints. Add `(workspace_id, work_item_id, revision DESC)` for lookup. The highest eligible revision is the head; no mutable head pointer is needed initially.

`wa_context_snapshot_dependencies` stores `(workspace_id, work_item_id, snapshot_revision, dependency_kind, dependency_id, revision_id)` and composite foreign keys where the referenced domain supports them. Receipt dependencies must belong to this activity or an explicitly authorized ancestor; arbitrary workspace receipt IDs are rejected. Artifact dependencies pin exact revisions. A service validation transaction covers polymorphic references that cannot have a single SQL foreign key.

```ts
type WorkingCheckpoint = {
  schemaVersion: 1;
  goal: string;
  expectedOutcome?: string;
  decisions: Array<{ decisionId: string; text: string }>;
  findings: Array<{ text: string; evidence: EvidenceRef[]; verified: boolean }>;
  coverage: Array<{
    artifactId: string;
    revisionId: string;
    view: string;
    inspectedRanges: Array<{ offset: number; end: number }>;
    receiptIds: string[];
  }>;
  completedActions: Array<{ receiptId: string; outcome: string }>;
  pendingQuestions: Array<{ interactionId: string; question: string }>;
  remainingWork: string[];
};
```

Host-derived fields such as receipt IDs, coverage ranges, current goal and pending approvals are validated against durable records. A generated finding is not marked verified merely because a model produced it. Provider private reasoning, credentials and raw secret values are excluded from summary input and output. Summary bodies are capped at 16 KiB; bounded metadata lists carry pagination references rather than silently dropping dependencies.

### Approved memory

`wa_memory_entries` stores workspace, ID, scope kind (`agent` or `workspace`), optional agent ID, current version, state (`proposed`, `approved`, `superseded`, `revoked`), creator and creation/update timestamps. SQL checks enforce that an agent scope has an agent ID and a workspace scope does not.

`wa_memory_versions` stores immutable versions: sealed content, evidence/dependency references, content hash, origin work item and decision ID, author, approving actor/time, expiry and superseded version. Composite keys bind every version and dependency to its workspace. Revocation is an audited state change, not deletion of provenance. Old snapshots referring to revoked entries become ineligible for future model requests.

Version dependencies must be complete. For model-generated memory, conservatively include the activity's eligible evidence set as well as explicitly cited evidence; narrowing scope must not recover hidden facts through an incomplete citation list. Approval can reclassify reviewed guidance as workspace-wide only through an explicit owner/admin action.

Preserve `wa_memories` and `wa_memory_proposals` for compatibility. Historical approved records lacking resource scope are classified `legacy_unscoped`; they remain readable through the existing legacy policy but are not automatically injected into published agents. An explicit review creates a scoped new version referencing the original decision.

### Budget admission

`wa_work_budget_grants` stores workspace/work, grant ID, monotonically increasing revision, token/time allowance deltas, actor, reason, client key, request hash and timestamp. Unique `(workspace_id, actor_id, client_key)` implements idempotency; mismatched reuse returns 409.

`wa_context_admissions` stores workspace/work, invocation ID, context hash, prompt estimate, exact/estimated flag, output cap, reserved allowance, state (`reserved`, `issued`, `settled`, `released`, `uncertain`), provider-call reference and actual usage. Unique `(workspace_id, work_item_id, invocation_id)` prevents double admission. Index unresolved admissions by workspace/work.

Reservations and grants lock the root activity budget row. Children and summarization calls reserve against that same root, preventing concurrent children from each spending the same remaining allowance. An issued or uncertain reservation is not released merely because the caller timed out.

## Request assembly algorithm

1. Authorize actor/sponsor and revalidate the pinned execution snapshot under the existing agent lock. Resolve current resource revisions only where the published contract permits following heads.
2. Compute an authority fingerprint from the pinned agent, resolved resources, relevant memory policy, membership/permission generation and current policy. A matching hash is a lookup aid; every dependency is still checked at use time.
3. Load the latest compatible working checkpoint. Reject snapshots with inaccessible, revoked, expired or incompatible dependencies. Do not include summaries from broader or older agent configurations. Rebuild from currently eligible receipts if possible; otherwise pause with an explicit scope-change reason.
4. Retrieve eligible approved memory within entry and token limits. Add its version IDs and dependency references to the context manifest. Never load the last ten workspace memories indiscriminately.
5. Read session messages after the compatible session-summary cursor and activity observations after `through_turn`. Avoid duplicating the current goal or completed activity messages through both session and activity histories.
6. Assemble protected blocks, checkpoint, approved memory, relevant evidence and recent complete rounds. Protected blocks include system policy, active goal, current accepted decisions and unresolved interaction state.
7. Calculate request sizing including tool schemas and output reservation. Apply the context and cumulative-budget rules below.
8. Reduce eligible older observations and compact complete rounds when necessary. Persist the summary receipt and immutable checkpoint before switching the active cursor.
9. Recheck authority, invalidation generations and budget admission in a short transaction immediately before issuing the provider call. Use the same permission lock protocol as memory revocation/policy changes so a revocation cannot race admission. A call already issued before revocation is recorded and never treated as retractable.
10. Persist a manifest and admission receipt, then execute the model call through the existing DBOS step. Record actual provider usage and reconcile the reservation exactly once.

The manifest extends `wa_context_manifests.manifest`; no separate full-prompt audit table is required. It contains snapshot revision, memory version IDs, evidence revisions, receipt references, scope hash, token estimate method, sizing/reserve values, reduction decisions and hashes. Private reasoning and credentials are excluded.

## Retrieval and evidence coverage

First release uses Postgres metadata filters and bounded retrieval of encrypted candidate content. Authorize before decrypting. Rank a maximum of 200 eligible candidates in the application by query match, applicability and recency; return stable pagination and a `truncated` flag when the candidate bound prevents exhaustive recall. Do not promise semantic search or silently claim a complete memory search. Full-text indexes over plaintext or embeddings require a separate storage/privacy decision.

A memory answer includes `memoryId`, `version`, scope, evidence, expiry/staleness and relevance explanation. Model-visible content is bounded; metadata references permit explicit retrieval of details where authorized.

Artifact inspection coverage is derived from successful `artifact_read_v1` receipts keyed by `(artifactId, revisionId, view, query, offset, limit)`. Identical reads may reuse a receipt within the same resolved scope and immutable revision. Do not reuse reads against an unresolved head. Repeated reads with no new coverage emit a progress warning; they do not silently suppress a tool requested by the model. After two unchanged inspection rounds, inject a bounded progress note asking the agent to synthesize findings or identify the missing capability.

## Compaction and token policy

Use a tested provider tokenizer/count endpoint when available. Otherwise expose a conservative estimator and its uncertainty; calibrate against observed prompt usage without treating estimates as billing facts. Account separately for messages, tool schemas, output reservation and summarization overhead. A hard billed-token guarantee cannot be promised when the provider does not support exact preflight counting; enforce application reservations conservatively and provider account limits where available.

Proposed first-release defaults:

| Setting                     | Default                                               | Constraint                                                                  |
| --------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------- |
| Working prompt target       | 12,000 estimated tokens                               | Includes system text and tool schemas; cannot exceed effective model window |
| Prompt ceiling              | 24,000 estimated tokens                               | Also bounded by published/current workspace policy and model capacity       |
| Recent complete tool rounds | 2                                                     | Preserve additional rounds only within budget                               |
| Approved-memory allowance   | 2,000 tokens, 8 entries                               | Included inside the prompt target                                           |
| Finalization reserve        | Greater of 4,000 tokens or 5 percent of initial grant | Capped by total grant; very small grants may not admit a tool loop          |
| Summary output allowance    | Up to 2,048 tokens                                    | Input plus output must have its own budget reservation                      |
| Estimated-request margin    | 20 percent                                            | Must be configurable and observable; not represented as exact counting      |

These are engineering defaults to validate against the banking scenario, not claimed MiniMax model limits. Model context capacity must come from a verified capabilities registry or explicit deployment configuration. Refuse unsupported configurations rather than assuming a model window.

Trigger reduction/compaction when the request exceeds its target, is projected to consume the completion reserve, or contains predominantly older tool observations. Preserve current goal and decisions outside the generated summary. Reduce retained rounds down to one complete round if necessary; never split a call/result pair. If protected context plus the latest round still exceeds the ceiling, return a checkpointed context-limit pause rather than truncating silently.

Use a persistent input cursor so each compaction summarizes only the previous checkpoint and new cold rounds. Summary requests are bounded: process complete-round batches and preserve remaining batches for subsequent checkpoints. Oversized individual observations become receipt-backed bounded excerpts before summarization. Keep immutable originals in storage.

A compaction provider call uses an idempotency key derived from scope hash, prior snapshot hash, covered receipt boundaries and source hash. A completed call is reused. An issued call without a completed receipt produces `uncertain`; no automatic duplicate call. Validate returned summaries, reject tool calls, retain source references and run existing before/after compact hooks. A received invalid summary may be repaired once only if explicitly budgeted; network uncertainty is never classified as a repairable summary.

## Budget pause and resume

Continue to expose `budget_exhausted` for compatibility. Add `pauseReason` and a resume checkpoint reference to work detail, distinguishing `token_budget`, `active_time`, `context_capacity`, `compaction_failed` and `scope_changed`. An exhausted activity remains ineligible for automatic queue reconciliation.

For newly admitted activities, pin `initialTokens`, `maxTotalTokens`, `initialActiveMs`, `maxTotalActiveMs` and `allowExtension` in a versioned budget policy. Existing `totalTokens` maps to both initial and maximum tokens, with extension disabled. It is not silently converted into a larger ceiling.

When an upcoming request would consume the finalization reserve, request a bounded synthesis using existing evidence. If no model request can be admitted, create a deterministic checkpoint from goal, decisions, coverage, receipts and pending work; no unbudgeted final summarization is required.

`POST /api/agent/work-items/:id/resume` requires:

```json
{
  "clientKey": "UUID",
  "expectedVersion": 7,
  "checkpointRevision": 3,
  "additionalTokens": 50000,
  "additionalActiveMs": 120000,
  "reason": "Finish inspecting the remaining customer-account entities"
}
```

Owner/admin approval is required for an increase. Extensions must fit both the originally pinned maximum and current workspace maximum; otherwise the response explains that a new policy and activity are required. Never upgrade the pinned agent to a new revision during resume.

The transaction validates state/version, current authority, checkpoint eligibility, no unresolved provider outcome, agent enabled state and total approved grant. It atomically inserts the grant and one existing command-outbox entry at the saved next turn. Same key/body returns the same receipt; changed body/key reuse returns 409. A work already completed, cancelled, awaiting a question/proposal or uncertain is not resumed through this endpoint. Cancellation cannot be reversed by resume.

Before resuming after changed evidence, request an authorized reinspection or a new activity. Do not reuse completed write tools or treat an old approval as permission for a different action. If the provider returned a tool-call response before a budget pause, record its complete assistant receipt and explicit unexecuted tool results before the next model boundary; never leave an orphan call/result pair or execute the old calls merely because a grant was extended.

## APIs and roles

| Endpoint                                | Purpose and authorization                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GET /api/agent/work-items/:id/context` | Authorized activity inspection: manifest, usage, checkpoint metadata and permitted provenance; no hidden reasoning |
| `GET /api/agent/memory`                 | Scoped, paginated approved-memory retrieval for permitted members; viewers cannot start work                       |
| `POST /api/agent/memory/proposals`      | Owner/admin/editor proposes memory with evidence and requested scope                                               |
| `POST /api/agent/memory/:id/review`     | Owner/admin approves/rejects with expected version; workspace-wide approval is explicit                            |
| `POST /api/agent/memory/:id/revoke`     | Owner/admin revokes a versioned entry and invalidates dependent context                                            |
| `POST /api/agent/work-items/:id/resume` | Owner/admin authorizes an extension and resumes an eligible checkpoint                                             |

All mutation contracts include UUID client keys, expected versions and canonical request hashes. Successful mutation and its audit event commit in the same transaction. Agent tool entry points use the same services and cannot bypass review or scope filters.

Existing `memory_search_v1` and `agent_memory_propose_v1` remain legacy compatible. Add scoped v2 tools with explicit memory/evidence contracts for new published revisions; do not broaden old tool semantics without a version boundary. Receipt retrieval must apply the agent guard as well as workspace/work ownership checks. Snapshot readers return redacted provenance if a dependency is no longer visible.

### Scoped tool contracts

```ts
type MemorySearchV2 = {
  query: string; // 1..500 characters
  limit?: number; // 1..20, bounded again by published policy
  cursor?: string; // opaque server cursor bound to scope and query hash
};
type MemoryProposeV2 = {
  content: string; // 1..4000 characters
  scope: 'agent' | 'workspace'; // requested scope, not an authorization grant
  evidence: EvidenceRef[]; // 1..20 validated references
  supersedes?: { memoryId: string; version: number };
};
type ResultReadV2 = {
  sourceWorkId: string;
  receiptId: string;
  offset?: number; // default 0, nonnegative
  limit?: number; // default 4000, maximum 12000 characters
};
```

`memory_search_v2` returns bounded content, entry/version identifiers, scope, evidence, `nextCursor` and `truncated`. It cannot accept another workspace, agent ID or unrestricted resource scope. A cursor becomes invalid when the authority or memory generation changes.

`agent_memory_propose_v2` records a proposal and review request. Its returned receipt is not an approved-memory receipt. A revoked/superseded target or stale expected version prevents approval. Tool-generated proposals use the existing durable interaction machinery with owner/admin review, rather than allowing an arbitrary activity answer to approve workspace-wide memory.

`agent_result_read_v2` supports current activity receipts and explicitly eligible prior session/ancestor receipts. The service verifies source work ownership, the original context fingerprint, current dependency access and that the receipt is a completed tool observation. Model/private reasoning receipts are ineligible. A prior session alone does not authorize access to its broader evidence. Return an offset, total length and bounded excerpt; offsets are character positions, not tokens.

All v2 arguments are strict Zod objects with unknown fields rejected. Errors use stable codes: `scope_changed`, `memory_revoked`, `stale_version`, `checkpoint_ineligible`, `budget_extension_denied`, `budget_insufficient`, `provider_outcome_uncertain` and `idempotency_conflict`. Resource existence is not disclosed to an unauthorized principal.

## Activity and management UI

Reuse the licensed Run Log, Trace Viewer, Agent Run Tree, Generative Form and existing Untitled UI controls. Do not create replacement primitives or another memory chat surface.

Activity events include `context_loaded`, `memory_retrieved`, `context_compacted`, `evidence_stale`, `inspection_repeated`, `budget_paused` and `budget_extended`. Each carries a stable event key and bounded structured metadata. Existing SSE replay applies; duplicate events do not duplicate UI records.

The execution inspector shows actual cumulative usage, estimated next-request cost, checkpoint revision, before/after context size and included memory/evidence. Clearly label estimates. A paused activity shows completed findings, unfinished work and a top-level Resume action only for authorized managers. The extension dialog shows consumed usage, requested extension, total after extension and maximum before submission.

A Memory section in Workspace setup supports scoped listing, detail, pending review, supersession and revocation. Header actions and bounded scrolling follow the existing work-area contract. Private or ineligible memories must not appear through counts, search snippets or provenance links.

## Recovery and consistency

Persist checkpoint updates through existing fenced activity execution. Only complete read/tool rounds advance the cursor. Concurrent model calls use ordered invocation IDs and a root-budget reservation transaction; they cannot compact a prefix that contains an unfinished call.

DBOS step replay uses saved results. Snapshot append, source hash and admission receipts are idempotent even when a process dies after a provider receipt but before the context cursor advances. A resumed activation reconstructs context from the committed snapshot and later receipts, not process memory.

Memory revocation, evidence replacement and permission changes increment a workspace invalidation generation. Admission compares that generation under the same lock as the mutation, then validates dependencies. A stale cache cannot bypass a revocation. Session summaries become ineligible on scope changes; summaries cannot be reliably redacted by editing a few citations, so rebuild from eligible raw records instead.

## Rollout and rollback

1. Add migrations, contracts and a versioned `workspace-context-v1` execution profile. No automatic memory promotion or external service provisioning.
2. Build store, dependency validation and retrieval with the layer disabled for existing work.
3. Add working snapshots and shadow context metrics without issuing extra model calls. Validate request estimates against real provider usage.
4. Enable compaction and bounded context for newly admitted opt-in workspace activities. Published agents adopt through explicit reviewed revisions and compatible execution profiles.
5. Add scoped memory tools, management views and approved-workspace-memory retrieval.
6. Add budget extension/resume after pairing, cancellation and recovery tests pass.
7. Enable the profile for new workspace setup defaults after the banking acceptance scenario passes.

Active work keeps its original context profile. Old exhausted work is not resumed under new semantics automatically; use a supported explicit adoption path only after validating receipts and policy, otherwise create a linked activity. Rollback stops new admissions to the profile and retains the old history reader. Never drop memory/snapshot tables or silently execute an unsupported profile using legacy context assembly.

## Verification and release gates

Unit tests cover complete-round splitting, protected-block preservation, incremental cursor use, summary validation, budget arithmetic, output reservation, estimate flags and policy intersections.

Integration tests on the existing isolated port 3024 cover:

- Published agents compact when pinned/current policy permits; `compact: false` is not forced.
- Forty tool rounds produce a bounded prompt and incremental checkpoints rather than quadratic replay.
- The original banking-style fixture completes within its unchanged 200,000-token grant using realistic context-dependent fixture usage, not a constant per-call usage value.
- One configured real MiniMax banking inspection reports actual usage and compaction events; any live run requires the existing authorized connection and records costs honestly.
- Crash before/after summary receipt, snapshot insert and admission settlement produces no duplicate provider/tool effect.
- Cross-workspace/agent access, narrowed revisions, revoked/expired memory, changed membership and concurrent revocation fail closed.
- Review rejection cannot become approved memory; duplicate acceptance is idempotent.
- Pending questions and proposal approvals survive compaction.
- Budget extensions preserve scope/turn/receipt identities, obey ceilings and cannot revive cancellation or uncertainty.
- Parent and parallel children cannot oversubscribe one budget reservation balance.
- Archived/deleted-session rules and existing workspace deletion dependencies include the new tables.

Run the port 3022 runtime regression suite and existing context, durable question, duplicate, cancellation, tenant isolation and recovery tests. UI checks cover responsive header actions, memory review, pause/resume, stale-context errors and reconnect replay. Production build/type checks remain required.

Release gates: no known authority leaks; no repeated side effects during crash recovery; bounded request context after compaction; unchanged raw receipt/source history; clear usage and checkpoint visibility. Genuine budget exhaustion remains possible and must pause safely; it is not a promise that every request completes within every cap.

## Implementation sequence

| Slice | Deliverable                                                    | Exit criterion                                                                |
| ----- | -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1     | Contracts, migrations, scoped store, dependency validation     | Isolation and legacy compatibility tests pass                                 |
| 2     | Coordinator, incremental compaction and published-agent wiring | Banking fixture completes within the original grant; snapshot recovery passes |
| 3     | Scoped memory retrieval and reviewed publication               | Revocation/narrowing/provenance tests pass                                    |
| 4     | Admission reservations and explicit resume                     | Concurrent-budget and duplicate-resume tests pass                             |
| 5     | Inspector and Memory management composition                    | Browser flows and accessibility checks pass                                   |
| 6     | Real provider verification and controlled rollout              | Measured results satisfy release gates                                        |

## Implementation anchors

- `server/agent/context.ts`
- `server/agent/workspace-runtime.ts`
- `server/agent/definitions.ts`
- `server/agent/tools.ts`
- `server/agent/service.ts`
- `server/agent/routes.ts`
- `server/workspace-harness/context.ts`
- `server/workspace-harness/options.ts`
- `lib/agent/definitions.ts`
- `lib/agent/contracts.ts`
- `hooks/use-intelligence.ts`
- `components/intelligence/workspace.tsx`
- `components/intelligence/agent-lifecycle.tsx`
- `server/agent-concepts.integration.test.ts`
- `server/runtime.integration.test.ts`

DBOS execution reference: https://docs.dbos.dev/ai/ai-quickstart

DBOS model/tool checkpointing reference: https://docs.dbos.dev/integrations/vercel-ai

### Working context is not an activity budget (2026-10-22)

Crossing a working-context target triggers automatic maintenance and continuation in the same activity. The observational stream can checkpoint recent completed rounds under pressure; goals, instructions, user decisions, source revisions and original receipts remain available. Compact working-memory profiles also distinguish a maintenance target from safe input capacity. Context preparation errors are classified separately from approved spending allowances. A byte estimate is never presented as billed token usage. See the context-pressure continuation section of `long-history-mem0-technical.md` for the implemented host bounds and verification.
