# Long history and Mem0 integration

Status: Opt-in implementation delivered; deployment and verification record below
Date: 2026-10-21
Supersedes: The remaining large-history design in workspace-context-memory-technical.md, not its implemented authorization, encryption, budget or approval contracts.

## Implementation record — 2026-10-21

Implemented in `server/agent/context/history.ts`, `mem0-index.ts` and `local-embeddings.ts`, through the existing context facade, runtime, approved-memory service and budget ledger. Migration 016 adds immutable history generations, cursors, encrypted derived segments, vectors and an approval index outbox. Applied migrations 014–015 remain unchanged.

The production profile is explicitly selected by `memory.history: observational_v1`; `memory.index: mem0_v1` independently enables semantic recall. Draft controls expose both options. Existing published revisions are unchanged. `agent_history_read_v1` is separately publishable and pages scoped checkpoint lineage with original receipt addresses and exact fragment coverage. The existing Context and memory inspector includes history/index metadata.

The implementation adapts the pinned Mem0 OSS bundle with a narrow, reproducible provider-injection patch; it retains the real `add`/`search` engine. Inference, telemetry, promotional notices, entity boosts, SQLite history and default provider calls are disabled. All payloads **and vectors** are application-encrypted. Canonical approval/revocation and workspace eligibility remain authoritative. Approval creates an outbox record; eligible requests lazily reconcile at most four missing vectors and perform one query embedding. Revocation immediately excludes and removes indexed versions.

Deployment: `npm install` runs the integrity-checked adapter preparation script. Installations using `--ignore-scripts` must run `node scripts/prepare-memory-vendor.mjs` explicitly. For local semantic recall, provision EmbeddingGemma 2 with `npm run memory:setup`, start `npm run memory:serve`, select `STUDIO_MEMORY_EMBEDDINGS_PROVIDER=embeddinggemma`, and restart the application service. The Apache-2.0 text-only worker runs offline with a pinned revision and normalized 768-dimensional vectors; Apple GPU inference is available through `-- --device mps`. See [local memory runtime](../../scripts/memory-embeddings/README.md). The adapter uses loopback HTTP only, rejects oversized input instead of truncating, and includes revision, precision, task format and dimensions in its vector namespace. The explicit legacy Ollama adapter remains available for existing deployments; it is not a fallback. A trusted `STUDIO_ADAPTER_MODULE` may alternatively supply a local `memoryEmbedder`. Without configuration or during index failure, approved lexical recall remains available and an observable `memory_index_unavailable` event explains degradation. Observation/reflection work independently of embeddings.

Implementation choices relative to the target below:

- Reuse `wa_calls` and `wa_command_outbox` as durable job identities/continuations instead of introducing a redundant job system. Generations and source manifests in `wa_history_segments` retain the lineage; reflection links to prior generations rather than flattening unbounded dependency lists into the prompt.
- Prepare at most four new maintenance model calls per reasoning preparation. Incomplete preparation requeues the same turn. Completed replies replay without a provider call; unknown outcomes remain blocked. Invalid or non-reducing output pauses safely; automatic stronger-compression retry is deferred.
- Group up to twenty bounded fragments and approximately 18,000 bytes of input per observation. SQL text ranges use explicit Unicode code-point offsets, avoiding emoji/surrogate gaps. Original tool pairings remain in the retained raw rounds; archived fragments are labelled historical data rather than executable tool messages.
- The first index implementation scans at most 200 already-authorized canonical candidates using encrypted vectors, then lets Mem0 rank them. It intentionally does not introduce plaintext pgvector payloads or claim an ANN index across an unlimited memory corpus. Broader candidate paging/ANN deployment is a separate scaling increment; current truncation is reported by the existing canonical search contract.
- The model response format contains typed findings/decisions/actions/questions/corrections and remaining work. Source identities/ranges and protected goals/answers are host-derived, independent of the generated prose. Original records remain available; semantic compression is not lossless.
- Tests exercise a 700-message backlog, automatic durable continuations, reflection, ten revision-pinned artifact reads and lineage retrieval, real Mem0 add/search with deterministic fixture embeddings, encrypted storage and revocation. No real MiniMax spend or local model download was required for these fixtures. Million-message resource measurements and exhaustive process-kill fault injection are not claimed.

Verification: 301 unit tests, all 37 isolated concept tests on 3024, all 70 runtime regressions on 3022 and production build passed. The final targeted rerun also covers a large Unicode message split into contiguous code-point ranges, numeric ordinal ordering, reflection and same-turn DBOS continuations. Browser inspection confirmed the new draft options and pinned header/tabs during content scrolling; the draft was discarded without saving or publishing. Evidence is recorded locally in `.studio/history-2026-10-21/verification.json`. Existing accessibility-label warnings in the licensed form fixture remain unrelated.

Selected embedding model source/license: [EmbeddingGemma 2, Apache-2.0](https://huggingface.co/google/embeddinggemma-2). Legacy optional model: [Nomic model card](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5), [Ollama package](https://ollama.com/library/nomic-embed-text). Models are installed separately and are not included in this repository.

## Decision

Keep the Stack Proc harness and DBOS. Add bounded observation and reflection to the existing context coordinator, informed by Mastra's Apache-licensed implementation. Use self-hosted Mem0 OSS for durable semantic recall through a host-controlled adapter. Do not install Mastra's runtime, replace DBOS, or make a fork of Mem0's agent loop.

These are two different stores of derived information:

- Activity/session observations summarize execution history. They are automatically generated, scope-bound context; they never become approved workspace knowledge automatically.
- Mem0 indexes reviewed durable memory versions. Retrieved candidates must resolve to current, eligible canonical records before their content reaches a model.

Raw messages, execution receipts, source revisions, approved memory and model usage remain authoritative in Stack Proc PostgreSQL. Neither a summary nor a vector hit grants permission or proves a source has been fully inspected.

## Source review and licensing

Reviewed immutable source revisions:

- Mastra: `aa6b42f67476c3d57ec310142780ed2d7874483f`.
- Mem0: `2c81af3bbe27d9bccb09c772d583df9e9be72ee5`.

Research checkouts are outside the application under `/tmp/stackproc-{mastra-memory,mem0}-review-20261021`. No vendor code or runtime dependencies were added by this review. These are research commits, not selected production package versions; select and verify a stable published release before installation.

Mastra's [license at the reviewed revision](https://github.com/mastra-ai/mastra/blob/aa6b42f67476c3d57ec310142780ed2d7874483f/LICENSE.md) puts code outside excluded enterprise directories and other restrictions under Apache-2.0. The observation/reflection files reviewed below are outside `ee/`. Third-party dependencies retain their own licenses. Mem0's [root license](https://github.com/mem0ai/mem0/blob/2c81af3bbe27d9bccb09c772d583df9e9be72ee5/LICENSE) is Apache-2.0.

Before reusing source, prompts or tests: record original paths, commit, SHA-256, copyright and any applicable notices; retain the license and notices; identify modified files and the changes. Create a third-party attribution manifest with the implementation. This review is not a dependency-tree license clearance. Do not copy `ee/`, separately restricted packages, or entire upstream dependency trees.

### Mastra implementation map

All paths below are relative to `packages/memory/src/processors/observational-memory/` at the pinned commit. [Browse the reviewed implementation](https://github.com/mastra-ai/mastra/tree/aa6b42f67476c3d57ec310142780ed2d7874483f/packages/memory/src/processors/observational-memory).

| Source                                                                  | What it does                                                                                                                                                  | Stack Proc adaptation                                                                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `observer-agent.ts`                                                     | Formats history; generates dated observations; distinguishes statements from questions; parses and checks generated text                                      | Typed findings with host-validated receipt references; no inferred authority from user-like document text            |
| `reflector-agent.ts`                                                    | Reorganizes accumulated observations, preserves corrections and completion information; checks compression and provides bounded stronger-compression guidance | Separate durable reflection calls with explicit lineage and output limits                                            |
| `observer-runner.ts`                                                    | Creates Mastra Agents for observation and integrates model selection, temporary memory and retries                                                            | Replace execution plumbing with `AgentModel`, existing vault credentials, budget admission and durable call receipts |
| `thresholds.ts`                                                         | Computes observation/reflection thresholds, buffering activation and retained recent context                                                                  | Start with explicit bounded synchronous thresholds; model-aware token estimates and safety margins                   |
| `observation-turn/step.ts`, `safe-buffer-prefix.ts`                     | Coordinates per-step preparation and avoids observing incomplete tool messages                                                                                | Use complete API rounds and stable host ordinals, not timestamp ordering or content hashes alone                     |
| `commit-queue.ts`                                                       | Orders in-process commits; explicitly relies on storage generation fencing for correctness across processes                                                   | PostgreSQL compare-and-swap generation plus DBOS jobs; an in-process queue is insufficient                           |
| `token-counter.ts`                                                      | Caches estimates keyed to content and tokenizer details, with media-specific handling                                                                         | Cache host-derived estimates; do not trust estimates supplied by clients                                             |
| `__tests__/buffer-write-generation.test.ts`, `context-overflow.test.ts` | Exercises reflection/buffer races and distinguishes context overflow from rate limits and other failures                                                      | Reproduce failure cases against our receipts and DBOS; do not import the upstream test harness wholesale             |

This is selective adaptation, not a claim that Mastra's full memory subsystem runs in Stack Proc. Observation/reflection are lossy compression. Preserve traceable originals and test task continuity instead of promising lossless recall.

### Mem0 findings that affect the adapter

The [reviewed TypeScript implementation](https://github.com/mem0ai/mem0/blob/2c81af3bbe27d9bccb09c772d583df9e9be72ee5/mem0-ts/src/oss/src/memory/index.ts) exports OSS separately as `mem0ai/oss`. Its reviewed package.json says 3.3.1; that is not confirmation of an installed or verified release.

- `add` defaults to inference: it can extract and change memories through model calls. Use `infer: false` for approved canonical facts in the first release; do not let inferred updates bypass review.
- Even with inference disabled, `createMemory` generates a random UUID and invokes the embedder. Retrying `add` is not an application-level idempotency guarantee.
- The native `pgvector` provider has SQL metadata filters. Search filters are a narrowing mechanism, not tenant authorization.
- The reviewed generic LangChain vector-store wrapper explicitly ignores search filters and does not reliably implement get/update. Reject that wrapper for this integration.
- Default history storage and provider behavior must be replaced or disabled explicitly. No silent SQLite file, external default model or hosted Mem0 Platform.
- `MEM0_TELEMETRY=false` must be set before module import and verified with an outbound-request test. No auto-signup or evaluation Platform key.
- The source includes a MiniMax LLM provider. That does not establish embedding support, exact usage accounting, cancellation or recovery compatibility with our host.

The stock SDK is therefore not a safe drop-in for our current encrypted, idempotent memory contract. Slice 1 below must prove an adapter seam before the dependency is adopted. Prefer a supported provider injection seam; if absent, use a narrowly attributed patch/addition exposing that seam and propose it upstream. Do not pretend TypeScript private-field mutation or the filter-dropping wrapper is a supported integration.

## Existing implementation and changes

| Current location                              | Retain                                                                        | Extend                                                                                         |
| --------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `server/workspace-harness/working-context.ts` | Tool pairing, protected context and recent rounds                             | Replace one large summary operation with paged observation batches and hierarchical reflection |
| `server/agent/context.ts`                     | Public facade, durable model-call receipts and usage reconciliation           | Dispatch typed observation/reflection calls and reconstruct a bounded checkpoint plus tail     |
| `server/agent/context-memory.ts`              | Approved version records, review locks, eligibility and exact evidence checks | Optional Mem0 candidate index; canonical revalidation on every retrieval                       |
| `server/agent/context-budget.ts`              | Shared root reservations, cumulative usage, approved grants                   | Account for observation, reflection and memory indexing/query costs; distinct pause reasons    |
| `server/agent/workspace-runtime.ts`           | Durable host lifecycle and authority pinning                                  | Page history before constructing protocol messages; supply only bounded prepared context       |

Today, `workingContext` stores an expanding `prefixHashes` array, repeatedly summarizes the prior text with a cold prefix, and rejects clean summary input above 180,000 bytes. `sessionHistory` also rolls a summary forward. This protects a single request but does not provide bounded ingestion of a very large history. Building the full transcript first would still exhaust application memory even if the final prompt is small.

## Proposed modules

Under `server/agent/context/`:

- `contracts.ts`: versioned observation/checkpoint contracts and validation.
- `history-reader.ts`: cursor-based, bounded normalized history reads.
- `history-planner.ts`: pure complete-round batch and reduction planning.
- `observer.ts`, `reflector.ts`: prompts and validated responses through `AgentModel`.
- `history-store.ts`: encrypted immutable segments, dependencies, generation fencing.
- `mem0-adapter.ts`: reviewed-memory indexing and scoped candidate search.
- `memory-index-worker.ts`: DBOS outbox reconciliation and tombstones.

Retain existing facade imports during migration. Avoid a broad refactor of unrelated runtime logic.

## History representation

Use a stable composite address `(workspace, session, work, ordinal)` for each normalized message or complete round. Assign missing ordinals once in a deterministic migration/backfill transaction. A duplicate message with identical content must retain its distinct identity. Hashes verify content; they do not replace identity or grow as an unlimited exclusion list.

Add new migrations after the current highest applied migration; do not edit migrations 014–015.

| Proposed table            | Contract                                                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wa_history_heads`        | Workspace/session/agent-revision/authority partition, generation, contiguous observed cursor, active segment manifest root; compare-and-swap updates |
| `wa_history_segments`     | Immutable encrypted observation/reflection output, source hash, prompt version, model receipt, level, covered cursor interval and creation time      |
| `wa_history_dependencies` | Segment-to-child lineage and evidence/receipt dependencies; indexed and paginated, not an unbounded JSON array in each prompt                        |
| `wa_history_jobs`         | Durable bounded batch identity, source interval/hash, expected generation, state and call receipt                                                    |
| `wa_memory_index_outbox`  | Canonical memory ID/version, namespace, index generation, operation, idempotency key, status and mapping to vector identity                          |

Every primary key/reference includes workspace ownership; content uses the existing vault envelope. Metadata list endpoints never expose decrypted content. Include a prompt/output-schema version in source hashes so new algorithms cannot silently reuse old output.

```ts
type HistoryObservation = {
  schemaVersion: 1;
  items: Array<{
    kind: 'finding' | 'decision' | 'action' | 'question' | 'correction';
    text: string;
    evidence: Array<{ workId: string; receiptId: string }>;
    observedAt?: string;
    uncertainty?: string;
  }>;
  remainingWork: string[];
};

type PreparedHistory = {
  checkpointId: string;
  generation: number;
  throughOrdinal: string;
  protectedContext: unknown; // Rebuilt from trusted host state.
  historicalData: HistoryObservation;
  recentCompleteRounds: unknown[];
  estimatedTokens: number;
};
```

The host supplies coverage intervals, pending question IDs, current goal, accepted decisions and completed effect receipts independently of generated prose. Validate every generated evidence reference against the input manifest. Generated text may carry an unsupported claim, but must never mark it verified automatically.

## Bounded observation and reflection

1. Revalidate authority and the immutable agent policy. Read the eligible head and only a bounded page of subsequent complete rounds.
2. Estimate the full request, including system/tool schemas, approved recall, recent rounds and output reservation. Use the small working target only to trigger context maintenance, never as a failure or spending threshold. Keep essential current context within the configured safe request capacity, accounting for tool schemas and serialization overhead. Byte estimates are not billed-token counts or a model tokenizer.
3. Protect the current goal, accepted user answers, pending interactions, exact output contract and latest two complete rounds. If these alone cannot fit, pause explicitly rather than dropping them.
4. Partition cold history into batches of at most 8,000 estimated input tokens including observer prompt overhead. Cap each observation output at 1,000 tokens and validate the byte limit too. These are initial profile values to tune through fixtures, not model-independent guarantees.
5. For a single oversized historical tool result, retain the authoritative receipt and inspect bounded content ranges. Child extraction batches may read fragments, but represent the enclosing tool round as observed only after every required fragment is committed. Preserve exact inspection ranges and disclose uninspected ranges. Never split a live call/result pair or truncate silently.
6. Commit leaf observations independently with source hashes and receipt lineage. Advance the contiguous observed cursor only across fully covered rounds. Original messages remain stored.
7. When observations exceed a 3,000-token target, reflect bounded groups into a smaller parent. A parent must fit the target and be smaller than its input. Retain all children for authorized rehydration. Continue through additional levels for large backlogs; no single model call sees the full history.
8. Permit at most two validated compression attempts per reduction. Invalid/non-reducing output records failure and leaves the old head intact. At most four model calls run in one maintenance activation; checkpoint and enqueue continuation rather than draining an unbounded backlog in one DBOS execution.
9. Atomically activate a new manifest only after its required segments are durable and authority/head generation still match. Preserve newly appended rounds beyond the captured high-water mark.
10. Assemble protected host context, one bounded historical checkpoint, eligible Mem0 recall and the recent complete tail. Label historical content as data. Validate tool pairing and full prompt size immediately before budget admission.

For huge initial histories, expose `Preparing earlier history` and progress by committed cursor/round count. Ingestion is pausable and cancellable. A valid smaller prompt can proceed while eligible background work remains only if the full active request still fits and does not omit unobserved required history. Otherwise wait or pause; do not execute with hidden context loss.

## Recovery and concurrency

Each batch's identity is a hash of authority, source interval/hash, prompt version and generation. Store issued/completed/failed/uncertain model receipts through the current host before activating derived state.

- Crash before issue: safely resume the planned batch.
- Completed receipt but no segment: validate and commit the recorded result without calling the model again.
- Issued request with no known result: keep its reservation and pause for uncertain-outcome review. DBOS does not make an external model request exactly-once.
- Stale generation after a concurrent reflection: preserve the derived result but do not overwrite the head. Replan against the new manifest; reuse only if its dependencies remain valid.
- Scope/source revision change: stop activation, invalidate affected derived context, and rebuild only from currently eligible originals.
- Concurrent session instructions: existing session execution ownership serializes host turns; use database fencing as the final write authority, including across worker processes.

Ship synchronous observation first. Add background buffering only after crash/race gates pass. Background work still uses the same root allowance and cancellation state; no untracked fire-and-forget model calls.

## Mem0 boundary

First release indexes only explicit approved memory versions; observations stay local unless separately proposed and approved. Use one logical namespace per workspace and visibility partition. Server-derived filters include workspace, agent or workspace visibility, canonical memory/version and embedding generation. Never accept namespace, filter expressions or provider credentials from the model or browser.

```ts
interface ApprovedMemoryIndex {
  upsertApproved(input: { workspaceId: string; memoryId: string; version: number; commandId: string }): Promise<void>;
  candidates(
    scope: TrustedScope,
    query: string,
  ): Promise<
    Array<{
      memoryId: string;
      version: number;
      score: number;
    }>
  >;
  tombstone(input: { workspaceId: string; memoryId: string; version: number }): Promise<void>;
}
```

Required adapter behavior:

- Persist canonical approval and an index outbox entry in one application transaction. Vector indexing is an eventually consistent projection.
- Upsert with a deterministic canonical version key. The native random-UUID `add` behavior is not enough: the adapter must reconcile writes after acknowledgement loss, prevent duplicate versions and handle deletion before indexing. Prove this with the selected SDK/provider seam.
- Preserve the existing application encryption boundary for memory content. The stock native provider's `data` payload would introduce a plaintext duplicate; do not silently accept that. The selected adapter must seal text/derived lexical payload and return canonical IDs for host decryption. Semantic vectors themselves are sensitive derived data and require restricted DB access and configured storage protection.
- Run canonical eligibility checks after retrieval and again under the admission/revocation lock before injection. An old vector can never resurrect revoked, expired, superseded or unauthorized content. Bound candidate overfetch, return truncation explicitly, and fall back to canonical approved-memory search if indexing is unavailable.
- No direct model/browser access to Mem0 get/update/delete. Host ID lookup always checks workspace ownership first.
- Rebuild the index from eligible canonical versions after changing embedding models/dimensions. Do not mix vector spaces or overwrite the active index before the replacement is ready.
- Disable Mem0's optional history when host records provide the audit trail. No duplicate plaintext SQLite history. Disable telemetry before import and test outbound destinations.

The integration spike must resolve encryption and deterministic IDs through a supported adapter seam or a small reviewed provider patch before production indexing. If it cannot, report that finding and revise the integration plan; do not install a second vector system as an unannounced substitute.

## Models and budgets

Observer and Reflector are internal model operations, not newly published specialist agents. They have no tools or workspace write access. Use the existing MiniMax credential resolver and `AgentModel` boundary. Do not introduce OpenAI defaults, a new key requirement, or a second orchestration runtime.

An embedding provider is a separate requirement. The configured MiniMax chat key is not proof of a usable embedding endpoint. Select a self-hosted, appropriately licensed embedding model or an explicitly configured approved endpoint; pin its weights/license, dimensions and resource limits. No model download or new external data transmission is authorized by this spec alone.

Reserve prompt/output before every observation/reflection call; settle actual provider usage once. Account for embedding/indexing/search invocations and any reranking separately with a published allowance; disable model reranking initially. Failed validation and bounded retries still consume budget. Never reset usage when activating a checkpoint or continuing a session.

Expose different actionable states: `history_preparing`, `context_limit`, `activity_budget_exhausted`, `memory_index_unavailable`, `uncertain_model_outcome`. Context overflow can trigger replanning only after a known provider rejection; network timeouts cannot trigger automatic reissue. A cumulative 200,000-token cap can still be reached even with excellent compression. Continuing then requires the existing explicit grant or a genuinely new activity with its own reviewed allowance.

## Compatibility and rollout

Add a versioned optional history policy selecting `observational_v1` and optional approved index `mem0_v1`. Existing published hashes and memory v1 definitions retain their behavior. Do not rewrite old revisions or silently republish banking agents. Carry the effective algorithm/profile into immutable execution snapshots.

Existing working/session summaries remain audit history. For opted-in revisions, build new lineage from eligible original messages and receipts; do not relabel an old free-text summary as a fully evidenced observation checkpoint. Keep the previous profile available for compatible old work while new work is enabled explicitly.

No new page layout is needed. Extend the existing Context and memory inspector with checkpoint coverage, observation/reflection receipts, estimates/actual usage, backlog state and index health. Preserve pinned header/tabs and bounded content scrolling. Do not display provider private reasoning.

## Delivery slices and acceptance

1. **Integration proof and license manifest.** Pin stable artifacts, inspect transitive licenses, prove the Mem0 injection seam, encrypted payload handling, deterministic version writes, strict SQL scope and host-controlled model/embedding calls. No production adoption until these pass.
2. **Paged history and typed checkpoints.** Stable cursor reader, protected-state manifest, complete-round planner, immutable encrypted segments and lineage. Synthetic million-message reads must never load the full transcript; measure bounded batch memory and query behavior.
3. **Durable Observer and Reflector.** Bounded ingestion, multi-level reduction, context admission and uncertainty handling. Turn/model loops continue to use the owned harness and DBOS.
4. **Approved Mem0 recall.** Approval outbox, scoped index, canonical revalidation, revoke/delete/reindex behavior and degraded fallback. No automatic promotion of observations.
5. **Recovery and user verification.** Extend the existing inspector; verify with isolated fixtures first and a separately approved live provider allowance. Existing agents remain unchanged until explicitly published with the new policy.

Required tests before enabling the new profile:

- Exact tool-call pairing, repeated equal messages with different IDs, pending questions/approvals and current-goal preservation.
- Large historical result fragmented across batches, cursor gaps, truncated artifact coverage and multiple reflection levels.
- Corrections retain time and source attribution; citations resolve to eligible original receipts. Evaluate seeded decisions, unresolved work and source coverage after many reductions; do not use an LLM's self-rated summary quality as the only oracle.
- Crash before/after provider issue, result persistence, segment commit and head activation; no automatic repeat after an unknown outcome.
- Concurrent observation/reflection and session append; stale generation never loses new history.
- Foreign workspace/agent IDs, source revision change, memory revocation during admission, expired versions, index poisoning and prompt injection in imported documents.
- Index write acknowledged then worker crash, duplicate outbox delivery, revoke-before-add and delete/rebuild races; one canonical indexed version and immediate retrieval exclusion after revoke.
- Telemetry disabled, no hidden model calls/default credentials, no plaintext content/history duplicate and embedding-model dimension mismatches.
- Shared parent/child/maintenance reservations, budget exhaustion during reflection, cancellation and idempotent approved resume.
- Existing unit suites plus isolated concept tests on 3024, runtime regressions on 3022 and production build when runtime code changes. Record concrete long-history fixture results and cost/latency before claiming rollout readiness.

The implementation record above distinguishes delivered behavior from remaining scaling and fault-injection targets. The following target design remains useful for later increments; it does not imply every delivery detail is already enabled.

## Context-pressure continuation (2026-10-22)

The observational working target is a maintenance threshold. Crossing it runs the existing observer/reflection stream over completed recent turns and rebuilds the prompt from its durable checkpoint and remaining complete rounds. The active goal, system and published instructions, user answers and guidance, authorization scope and receipt references remain intact. Original source material and tool receipts are never replaced in storage. There is no second independent summary stream and no new user activity.

Normally two recent turns remain verbatim. Under pressure the same stream may observe all completed turns before the next model call. Bounded maintenance can yield through the existing durable outbox and resume the same work item. If protected/current blocks still exceed the working target, execution continues while within the configured request capacity. Only a genuine inability to fit essential context after maintenance produces a context preparation error; it is not reported as an exhausted budget.

The existing byte-based safe request ceiling remains 250,000 bytes. The assembled message allowance is the smaller of configured contextBytes and that ceiling minus tool schemas and 1,024 bytes of JSON framing reserve. This is a conservative host request bound, not a provider-advertised token-window calculation. Approved token/time/tool/turn limits, authorization checks, uncertain-outcome rules and cancellation remain enforced. Maintenance model usage is metered normally.

Verification covers a single activity reading ten pinned source pages with early context pressure, encrypted observation lineage, preserved original receipts, complete tool pairing, safe capacity fallback and separate context/budget error classifications. The existing 700-message history, repair/replay, isolation, cancellation, typed question and recovery tests remain required.

### Structured history results — defect #9 (2026-10-22)

Observation and reflection now return through the harness internal `record_history_observation` result tool. `structured-response.ts` supplies the Zod-derived JSON schema, requires the named result tool, validates exactly one matching call and its argument object, and provides one bounded repair policy. The MiniMax adapter forwards named `tool_choice`; live synthetic probing verified a typed tool result with the configured provider. Internal result tools never enter the workspace execution registry.

The durable history host retains admission, usage settlement, encrypted receipts and uncertain-outcome protection. It records only public text and structured calls in the private result envelope, omitting private reasoning. New request keys are versioned `:tool:v1` and hashes cover messages, tool schema and tool choice. Known invalid responses may receive one repair; network/unknown outcomes are not automatically repeated. Replays reuse the same receipt and never reissue completed or uncertain calls. No free-text JSON extraction is used for new observations; JSON decoding remains only for the provider protocol and persisted receipt envelopes.

Regression coverage includes fenced prose returned instead of a tool, missing/wrong/multiple tools, invalid argument types and extra fields, correct provider request fields, encrypted replay, repair billing and uncertainty. The UI-reported failure and acceptance criteria are recorded at https://github.com/saridsa2/dbos-transact-ts/issues/9.
