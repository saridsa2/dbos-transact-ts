# Workspace intelligence implementation notes

Status: first usable foundation, 2026-10-19. This records actual scope separately from the broader [technical design](workspace-intelligence-technical.md).

## Available path

1. Open **Sources** and import a UTF-8 `.txt`/`.md` process document, or paste its text.
2. Open **Connections**, add the **MiniMax** provider, choose a model and enter the API key there. Credentials remain encrypted in the existing vault; no OpenAI connection or key is used.
3. Open **Workspace intelligence**, select a source and MiniMax connection, and start analysis. Starting explicitly discloses that document content is sent to MiniMax.
4. Review the separate Ontology and Process tabs, follow source paragraph citations, answer clarification questions and save corrections to the proposal.
5. **Accept knowledge drafts** saves reviewable ontology/process records even when required executable capabilities are missing. This does not publish knowledge or run a workflow.
6. **Create workflow draft** is available when the current process is completely supported and its questions are resolved. It creates a new ordinary workflow, with scheduling disabled, and opens the existing fullscreen editor.

Knowledge can also be authored manually without a model connection. A saved, reviewed, supported process can create a workflow draft from its header action.

## Implemented boundaries

- Strict, domain-independent schemas for ontology entities/properties/relationships, linear process steps, questions, evidence and task proposals.
- Versioned canonical JSON hashing, immutable knowledge revisions, head version checks, review and separate admin publication.
- Workspace-scoped Postgres persistence and a checksum-tracked knowledge schema migration under a transaction/advisory lock.
- Text/Markdown source normalization and stable paragraph block references; protected access to current and older source revisions.
- Native MiniMax connection configuration using the existing credential broker. The adapter calls only `https://api.minimax.io/v1/chat/completions`, with no automatic redirects or retries, bounded source/response sizes, timeout/cancellation and strict final-output parsing. It discards reasoning fields rather than exposing them as task output.
- MiniMax final JSON is validated locally; this adapter does not claim provider-enforced JSON Schema output. A malformed or truncated response is an explicit failure.
- DBOS authoring tasks with checkpointed model results, durable clarification waits, transactional start/answer outbox, at most three reserved model calls and cancellation state checks. An interrupted request with no recorded completion is reported as an uncertain outcome; it is not automatically issued again.
- Immutable proposal history and user-answer decisions, independent of the current task snapshot.
- Evidence references are checked against the workspace and selected source. Uncited model elements are labelled as inferences for review.
- Atomic, idempotent acceptance/application, immutable generation manifests and preservation of generated provenance through authored graph parsing and run snapshots.
- Manual processes can pin ontology revisions; generation requires those revisions to have been reviewed.
- Optimistic edit versions and retained authored revisions for saved workflows. Existing graphs are backfilled; older browser drafts without a version must reload before saving. A stale save cannot overwrite another writer.
- Official Untitled UI work areas, tables, icon row actions, dialogs and fields; shared workspace SSE notifications; separate admin pages and fullscreen canvas.

The first deterministic generator supports linear **Construct a value** and **Return result** operations. External service calls, branches, loops, approvals and operational agents stay explicit capability requirements. They do not become placeholder executable nodes or constant-success substitutes. The existing runtime supports more graph semantics than this initial process planner exposes; expanding the planner requires its own mappings and acceptance fixtures.

## Limits and deferred work

- This source intake uses bounded JSON text (200,000 characters) in the private application database. Analysis has a smaller 80,000-character serialized-request limit. The binary streaming/blob-store protocol in the technical design is not implemented yet.
- PDF/DOCX parsing, OCR, original binary document previews and diagram interpretation are unavailable; the import UI states supported formats.
- Ontologies open in a separate fullscreen designer/explorer using pinned Microsoft Ontology Playground source, with Stack Proc controls/icons/typography. Designer forms, the graph explorer, inspector, search, insights, path finder and supported RDF editing are reused. The original visual document is retained beside the typed ontology projection. Multiple inheritance is blocked rather than silently flattened; arbitrary OWL reasoning and persistent cross-session graph positions remain outside this pass.
- The process editor is linear. Agent generation, executable integration dispatch, richer control structures and framework workers remain separate delivery increments.
- Generation creates a new workflow. The authoring agent does not patch existing workflow graphs; CAS protection is already in place for future collaborative editing.
- Published revisions are pinned by reference; full ontology impact analysis, explicit merge proposals and source retention/archive policy remain pending.
- Source-list and task-list endpoints are cursor paginated. Source block retrieval is bounded by the 1,000-paragraph document limit.
- A live MiniMax call requires a configured, customer-authorized workspace connection. Contract/recovery tests use an explicitly installed fixture model in the isolated integration service; they are not evidence of live account access.

## Reference

MiniMax's [official compatibility guide](https://platform.minimax.io/docs/api-reference/text-openai-api) and [Chat Completions contract](https://platform.minimax.io/docs/api-reference/text-chat-openai) were checked for the endpoint, bearer authorization, non-streaming response, reasoning split and output limit fields. The code uses native fetch; it does not add an OpenAI SDK dependency.

## Verification

The unit suite passes, including both domain fixtures executing through the existing authoring compiler. Isolated integration coverage includes immutable knowledge revisions, foreign evidence denial, viewer permissions, reviewed ontology gates, stale/concurrent saved-flow writes, idempotent generation/application, clarification recovery, cancellation, and suppression of uncertain model-call retries after a crash. Production build and authenticated read-only smoke checks pass. Saved workflow JSON was compared before and after the additive local migrations and was unchanged.

Browser verification covered unsaved entity/relationship creation, renaming, search-to-inspector selection, graph zoom, path-finder expansion, RDF view, 125% browser zoom, and discard/reopen. It exposed and corrected reset-style collisions, low-contrast labels, expansion event handling, graph label text and SVG namespaces. Banking remained at revision 1 after discarding the test edits. No live MiniMax request was made without a configured MiniMax workspace credential.

## Ambient harness implementation — 2026-10-19

The first usable harness slice is implemented separately from the existing document-analysis task service. `/intelligence` opens the agent workbench; `/intelligence?view=documents` retains the existing analysis flow, and existing `task`/`source` links keep working.

Delivered:

- Workspace-scoped agent configuration, persistent conversations, optimistic session revisions and idempotent goal/decision commands.
- DBOS activations with a Postgres command outbox, workspace writer leases/fences, bounded model/tool turns, recorded tool observations and context manifests.
- MiniMax tool protocol with a fixed endpoint, workspace connection revision checks, request/response bounds and encrypted private continuation payloads. Only public answers and tool observations reach the workbench. Provider transport fixtures verify behavior; a real MiniMax conversation has not been verified in this pass.
- Durable questions and optional user-approved workspace decision memory. Restarting after a question does not lose the question or its answer. Issued requests with an unknown outcome become `uncertain` and are not automatically repeated.
- Trusted tools for workspace context, immutable artifact reads, registered capability discovery, ontology validation, ontology proposals, clarification and accepted-memory retrieval.
- Ontology proposals reviewed side by side against the current draft and applied with expected-version/hash checks in one transaction. Application creates a draft revision, never publishes it. Duplicate application returns the original receipt.
- Transactional audit-to-domain outbox, inbox deduplication and opt-in ambient review work for knowledge saves, workflow saves and failed runs. Observe mode indexes context without model requests; Assist mode requires explicit MiniMax content permission and a configured connection. Disabling/changing agent configuration invalidates older work authorizations.
- Workbench uses official Untitled UI controls, shared workspace SSE, bounded conversation/activity scrolling, clarification answers and proposal review. Existing viewer/administrator restrictions are enforced on the server.
- RDF/XML file/paste import with server parsing through an isolated JSDOM XML document and the vendored Microsoft parser. DTD/entity declarations and oversized files are rejected; referenced imports are not fetched. Preview assigns catalog icons and Material colors, replacement is one Undo action, and Save persists the native projection plus original RDF/XML in the immutable revision.

### Deliberate remaining stages

This slice does not implement the complete technical specification. In particular:

- Harness² package mutation, sandbox evaluation, held-out scenarios, promotion and rollback are not yet wired. No self-modifying production harness is enabled.
- Process-to-workflow authoring continues through the existing document-analysis service and its supported linear compiler. The ambient agent currently stages ontology changes; it cannot create arbitrary workflows or executable integrations.
- Agent configuration revision plus a current administrator sponsor is the initial authorization boundary. Separate expiring capability grants, granular rollout flags and production renewal UX remain to be implemented.
- Memory is explicit user-approved answer text. Dependency-based invalidation, contradiction resolution, evidence-derived memory and its management UI remain open.
- Ambient triggers currently create one idempotent bounded review work item per matching domain event. Burst coalescing, debounce windows, causal-chain tracking and advanced prioritization remain open. Accepted ontology application suppresses its own transactional save event.
- RDF import is replacement, not merge. Unchanged properties reuse their existing IDs when entity ID/name match; full-IRI identity maps, rename-safe reimport and preservation of manual presentation overrides across changed source files remain open. Original XML is retained for future reprojection. Full OWL reasoning, arbitrary Turtle/JSON-LD and SHACL execution are not supported.
- Cost accounting currently bounds turns, tool calls and output tokens. Monetary budgets, usage price tables and retention/key rotation policies remain open.

Local browser verification used a separate development QA identity/workspace, without adopting existing workflows or sending workspace content to MiniMax. It exercised observe configuration, goal submission, completion/activity, RDF preview/replacement/Undo/Redo/Save and reload. Integration fixtures cover model/tool continuation, crash uncertainty, question recovery, proposal application, ambient event ingestion, tenant isolation and viewer denial.

### Shell-native ambient agent correction

The agent now lives in `WorkspaceAgentProvider` in the authenticated application shell, including the fullscreen canvases. The global launcher opens a nonmodal agent dock with a persistent draft, workspace conversation, queue and attention state. Client routing preserves its state across screens. The intelligence work area is an inspection/review surface and forwards clarification answers through the same queue.

New request intake is `POST /api/agent/requests`; it acknowledges persisted intents before model execution. `wa_requests` survives restart, deduplicates client request IDs and pins the submitting actor, configuration revision and saved-resource context. `wa_agent_channels` provides one shared channel per workspace. Follow-ups wait behind active work; clarification answers can unblock it. Queued requests recheck policy and membership before dispatch. Committed workspace-event requests now pass through the same intake.

DBOS `stackproc.agent.harness.v1` is the actual inference/harness execution queue, partitioned by workspace with concurrency bounds. The agent remains server-side while the shell is closed. Existing session APIs remain for backward compatibility; new feature requests must use `useWorkspaceAgent().request`, not call MiniMax or create ad hoc sessions.

### Workspace agent lifecycle · current implementation, 2026-10-20

The earlier shell/orb descriptions above are historical. The authorized fullscreen composition now includes Activities, Suggestions, Agents and Workspace setup, using licensed catalog components. The current lifecycle, owned runtime integration, named process adapter, opt-in knowledge review and explicit rollout boundaries are recorded in [the lifecycle technical specification](workspace-agent-lifecycle-technical.md#implementation-record--2026-10-20). No historical schedule or workspace is automatically adopted, and no live model consent is changed by migration.

## Workspace Intelligence UX redesign — 2026-10-20

Implemented against the 29-family inventory in `docs/reviews/workspace-intelligence-screen-inventory.csv`. Scope is the Intelligence frontend only; existing harness, DBOS, MiniMax, authorization and persistence contracts are preserved.

- **WI01–04:** one AppSidebar/ChatLayout composition and work-area header; overview distinguishes workspace readiness, saved knowledge inventory and recent work. Activity filters and Started-only RunLog remove empty metrics.
- **WI05–08:** New activity collects an explicit executor, optional expected outcome, evidence and goal. A selected recorded activity has its own result/status and explicit follow-up action. Real pending questions retain the licensed GenerativeForm; execution stays in the inspector.
- **WI09–12:** one evidence entry point opens searchable saved revisions and role-gated uploads. Filtered selections retain state. History/archive actions live in a dedicated panel, while related activities select the canonical work item.
- **WI13–16:** existing AgentRunTree, TraceViewer and RunLog remain separate execution views. Ontology and process proposal reviews compose the product's read-only domain renderers, semantic change tables and technical disclosures. Applied snapshots do not show a misleading diff against a later saved draft.
- **WI17–18:** suggestions have search/state filters, clear empty states, an assignment brief and explicit “Accept and start activity” wording.
- **WI19–23:** licensed AgentList/Create/Summary remain in use. Agent configuration separates Responsibility, Capabilities, Knowledge and Runtime without discarding edits. Activity and automation tabs are distinct; publication/archive use explicit reviewed dialogs.
- **WI24–28:** workspace setup stages purpose and evidence before inspection; inspection/activation remain separate. Automatic knowledge review belongs to the coordinator's Automation tab. Workspace policy identifies saved readiness and disables unchanged saves.
- **WI29:** unsaved edits use the existing application confirmation. Provider loading no longer flashes a false disabled warning. Errors, viewer restrictions, stale proposal protection and uncertain outcomes remain explicit.

### Component provenance

No replacement chat, form, sidebar, source picker, run-tree or trace primitive was authored. Host layouts compose licensed AI SDK Agents components, official Untitled UI controls and existing product renderers. Vendor changes are recorded in `vendor/aisdkagents/provenance.json`; upstream source snapshots remain unchanged.

### Verification

- Production build and TypeScript passed.
- Full suite: 287 passed, 107 skipped (integration-gated tests were not enabled).
- Browser verified at 1440×1000 and 720×800: overview, navigation, activity brief, evidence selection retained through search, staged setup, custom discard prompt, agent draft section retention/conditional schema, recorded result, execution trace/receipts, applied ontology visual review, and unchanged policy save state.
- No model request, agent publication/enablement, proposal application, upload or workspace policy mutation was performed for UI QA.
- Live working/question/proposal application branches, populated suggestions, activated coordinator automation and process proposal review require suitable runtime fixtures; compilation/unit coverage does not constitute live end-to-end verification of those branches.

## Layout correction — 2026-10-21

Reviewed the authenticated AI SDK Agents registry and browser previews for Agent List, Run Log and Decision Inbox; inspected Chat Screen, Thread Header, App Sidebar, Agent Summary and Prompt Input source metadata. Existing source snapshots remain intact. Added the authentic Decision Inbox source and hash, using the existing durable suggestion accept/dismiss APIs. Added official Untitled UI Empty State through its CLI; no replacement primitive was written. The registry credential was used in memory and was not written into project configuration.

- Header search/select wrappers now have explicit widths and align with the primary action. The activity CTA always opens New activity; workspace-agent setup is a separate optional notice.
- Activity rows have state icons, bounded two-line goals, consistent padding and separators. Host status filters replace the duplicate Run Log filter controls.
- Suggestions uses a proper setup/empty state. Executable pending assignments use Decision Inbox with explicit acceptance; blocked assignments retain the disabled approval gate. Failed decisions remain retryable.
- Agent list fills the workspace until selection, then opens a readable detail layout. Name, responsibility, icon, status and menu have room; search uses the official input icon slot.
- New activity opens at scroll position zero, with compact executor/outcome fields, three icon starter prompts and an aligned composer. Starting another draft clears prior draft text only after the application discard confirmation.
- Mobile navigation closes after starting a new activity; narrow header controls wrap within the fixed work-area header.

Verification: production build/TypeScript and 289 unit tests passed (107 integration-gated tests skipped). Browser inspected at 1440×900 and 720×800, using both Browser verification and the populated Service Operations Lab workspace. No model calls, agent publication, proposal application, uploads or permission changes were made. Pending suggestion decision success/failure was exercised with component fixtures, not a live workspace mutation.

References: https://www.aisdkagents.com/ai-components/agent-list, https://www.aisdkagents.com/ai-components/run-log, https://www.aisdkagents.com/ai-components/decision-inbox.
