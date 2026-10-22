# Workspace agent interactive interface

Status: proposed implementation contract, 2026-10-19. No runtime capabilities are implied by this document. Extends the [ambient harness technical specification](workspace-agent-harness-technical.md); preserves MiniMax reasoning, DBOS execution, workspace authorization and durable intake.

## 1. Product contract

WorkspaceAgent is a persistent application component through which the workspace agent communicates, presents work and asks for decisions. Its interface changes with the task: a document discussion may contain Markdown and citations; a clarification may contain choices or a form; an ontology proposal may contain a structured comparison and review actions.

The floating intelligence orb opens this component. The launcher is only its entry point. The conversation, generated controls, pending decisions and attachments survive closing the surface, navigating between screens and reconnecting. Work continues on the server while the interface is closed. Ambient events can start permitted work and produce updates without a new user message.

Users send messages and respond to controls. They never need to understand model queues, DBOS activations or tool scheduling. Use **Send**, **Stop**, **Continue**, **Submit**, **Review changes**, **Approve** and **Reject** in context. Background execution is communicated as “Working”, “Waiting for your answer”, “Changes ready for review” or “Waiting to start”. Queue details belong in diagnostics, not the default conversation.

This is a domain-independent interaction layer. Domain-specific presentations register through the same component catalog; the core must not assume ontology extraction is every task.

## 2. Current implementation and gaps

Source reviewed in `components/agent/workspace-agent.tsx`, `workspace-agent-launcher.tsx`, `workbench.tsx`, `lib/agent/contracts.ts`, and `server/agent/{intake,runtime,tools}.ts`.

Already present:

- Shell-level provider, shared context, logo launcher, nonmodal slideout and workspace conversation.
- Durable request intake, background DBOS work, workspace SSE refresh and fallback polling.
- Plain text messages, free-text clarification, recorded activity, ontology proposals and separate review/application paths.
- Idempotent text commands and work edit versions; cancellation and uncertain-outcome handling.

Missing:

- Messages currently render a single `content` string inside a paragraph. No typed rich content renderer or streamed message-part protocol.
- The dock has fixed Conversation/Queue tabs and a text-only composer; it does not render a general interaction schema.
- `ask_user_v1` accepts a question string. It cannot describe choice lists, typed forms or resource selection.
- The ambient snapshot does not carry a complete typed pending interaction or rich proposal payload.
- Model output is currently committed after a completed call. SSE invalidation is not token streaming.

Extracting another React file or changing “Queue request” to “Send” alone does not complete this specification.

## 3. Architecture and ownership

```text
MiniMax + registered tools / ambient workspace events
                    ↓
        DBOS harness and domain services
                    ↓
     validated presentation projection + interaction records
                    ↓
       durable UI events / authorized snapshot API
                    ↓
      WorkspaceAgent controller and message store
                    ↓
       trusted Untitled UI renderer catalog
                    ↓
       typed user action → authorized server command
                    ↓
           resume the existing work item
```

The harness owns reasoning, execution and tool state. The presentation service converts permitted outputs into public UI parts; it never exposes private model continuation or hidden reasoning. The renderer owns appearance, accessibility and local form editing. Domain services retain validation, permissions and mutation rules.

Recommended approach: typed message parts and tool-to-component mapping, following AI SDK UI, with a trusted catalog as in A2UI. Do not build a new arbitrary layout language in V1. Keep a transport adapter boundary so AI SDK UI, ADK or A2UI can be supported without changing domain commands. No requirement to install all those frameworks or replace our harness.

## 4. Component composition

Proposed modules, all under `apps/studio`:

| Module                        | Responsibility                                                           |
| ----------------------------- | ------------------------------------------------------------------------ |
| `WorkspaceAgentProvider`      | One workspace-scoped lifecycle, transport, reconnect and draft state     |
| `WorkspaceAgentLauncher`      | Logo, accessible name, tooltip, unread/attention status and open/close   |
| `WorkspaceAgentSurface`       | Reusable view with dock and expanded presentation modes                  |
| `AgentConversation`           | Ordered message parts, scroll anchoring and new-content indicator        |
| `AgentPartRenderer` / catalog | Resolve validated part type and version to a trusted component           |
| `AgentComposer`               | Text, explicit resource attachments, Send and Stop                       |
| `AgentInteraction`            | Pending question/form/choice state and structured submission             |
| `AgentArtifactPreview`        | Authorized resource summary, preview and open-editor actions             |
| `AgentChangeReview`           | Structured diff and review actions using existing domain review services |
| `AgentActivity`               | Tool progress and public execution summaries, collapsed by default       |
| `AgentTransport`              | Snapshot, resumable event stream and idempotent actions                  |

Render the same conversation and interaction components in the dock and intelligence work area. The intelligence page adds history and diagnostics, rather than maintaining another message implementation. Expanded mode retains the current session and draft. Workspace changes clear local state, stop the previous subscription and prevent late responses from entering the new workspace.

Use official Untitled UI controls, local Geist, Font Awesome Pro and Stack Proc styling. Markdown does not bypass these conventions. The work area remains bounded; conversation content scrolls, while surface header and composer remain reachable. No default Queue tab. Surface header provides status, expand/open-history, settings and close; contextual controls live with the content they affect.

## 5. Versioned public content contract

Strict Zod schemas live in `lib/agent/ui-contracts.ts`. Types below are design sketches; implementation must supply complete bounded discriminated unions, not use `unknown` payloads as the public contract.

```ts
type AgentMessage = {
  schemaVersion: 1;
  id: string;
  sessionId: string;
  workItemId?: string;
  role: 'user' | 'assistant' | 'system';
  version: number;
  state: 'streaming' | 'complete' | 'interrupted' | 'failed';
  parts: AgentPart[];
  createdAt: string;
};

type AgentPart =
  | MarkdownPart
  | SourcePart
  | ToolActivityPart
  | ResourcePart
  | InteractionPart
  | ProposalPart
  | NoticePart;
```

Every part has host-issued `id`, `type`, `schemaVersion` and monotonically increasing `version`. Parts stay in committed order. Public DTOs omit provider secrets, internal prompts, raw tool arguments containing credentials and private continuation. A message may mix multiple part types.

| Part            | Payload and behavior                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| `markdown`      | Text and streaming/completed state; headings, lists, tables, fenced code and safe links                           |
| `source`        | Server-verified source ID, title, resource revision and optional excerpt/location; opens authorized viewer        |
| `tool_activity` | Registered tool label, public summary and pending/running/succeeded/failed state; expandable details              |
| `resource`      | Typed artifact reference, revision and summary; approved renderer and open action                                 |
| `interaction`   | Reference to a persisted pending interaction; renders controls defined below                                      |
| `proposal`      | Proposal ID, resource/base revision, summary, change counts and review state; resolves authorized structured diff |
| `notice`        | Informational, warning or error content, with registered recovery action if applicable                            |

Code snippets are display content. Executing code remains a separately registered, authorized workflow capability. An agent message cannot install browser code or turn a Markdown fence into execution.

Unknown part/version renders a readable unsupported-content card without breaking the rest of the conversation. Structured controls are withheld until their complete payload validates; incomplete streamed JSON never becomes a partially actionable form.

## 6. Trusted dynamic control catalog

V1 supports:

- **Question:** a free-text answer with an optional explicit “remember decision” control.
- **Single choice / multiple choice:** stable option IDs, labels, descriptions, cardinality and optional free-text alternative.
- **Form:** named fields of text, multiline text, number, boolean, enum, date and resource reference; labels, help, required flags and bounded declarative constraints.
- **Resource picker:** allowed resource kinds and optional pinned revisions; candidates resolved by the authorized server search service.
- **Change review:** domain-specific diff with Approve/Reject and conflict handling.
- **Artifact card / table:** typed read-only results and registered open/inspect actions. Paginate large results through authorized services.

Nested arbitrary form builders, model-generated JSX/HTML, custom CSS, remote component bundles and arbitrary client handlers are outside V1. Repeated field groups can be added as a versioned catalog extension after the initial lifecycle works.

The agent selects registered presentations and supplies schema-valid data. It cannot invent operation names, authority, URLs for mutation handlers or executable validators. Domain tools can produce richer registered previews without making each tool its own chat implementation. A model may request a resource picker, but the server determines which resources can be offered.

## 7. Interaction and action lifecycle

Persist interactions independently of transient React state:

```ts
type AgentInteraction = {
  id: string;
  version: number;
  workItemId: string;
  messageId: string;
  partId: string;
  kind: 'question' | 'single_choice' | 'multiple_choice' | 'form' | 'resource_picker' | 'review';
  state: 'pending' | 'submitted' | 'cancelled' | 'expired' | 'superseded';
  // `kind` selects a strict presentation and response schema.
};

type AgentAction = {
  schemaVersion: 1;
  clientActionId: string;
  sessionId: string;
  workItemId: string;
  interactionId: string;
  expectedInteractionVersion: number;
  expectedWorkVersion: number;
  action: 'submit' | 'approve' | 'reject' | 'dismiss';
  // Typed response union, derived from the persisted interaction.
};
```

The client never provides a trusted response schema. The server loads it from the interaction and validates submitted values. Submission transaction rechecks workspace membership, current grants, interaction state/version and work state/version; records the response, consumes the interaction and schedules continuation atomically through the existing outbox. Retries with the same action ID return the original receipt; reuse with different content conflicts.

V1 permits one blocking interaction per work item. One form can collect several answers. The sequential workspace harness continues to serialize work. Multiple ambient cards may be visible, but only pending interactions belonging to authorized current work accept actions.

On accepted submission, controls become a read-only answer summary. During transmission show “Sending”; only a durable receipt changes the UI to “Submitted”. Lost connections preserve entered values and the action ID. A second tab submitting first yields a stale-interaction response and refreshes the card; it does not overwrite the accepted answer. Stop/cancel supersedes pending controls. Closing the panel does not cancel work or consume questions.

Approval is distinct from answering a question. Reuse the domain proposal service, base revision/CAS checks and audit receipt. Approving one proposal never approves subsequent proposals. “Remember” remains explicit and scoped, not an implicit consequence of any form submission.

## 8. Streaming, persistence and reconnection

Reuse workspace SSE as transport infrastructure, with an authorized agent-specific event projection and replay. Do not subscribe to raw internal activity and treat that as a public UI protocol.

Public event envelope: `schemaVersion`, `eventId`, workspace cursor, `sessionId`, optional `workItemId`, event type and strict payload. Event kinds include message-created, part-updated, interaction-updated and work-status-updated. Use complete part snapshots for durable upserts in V1; identity/version makes duplicate delivery harmless. Cursor and projection updates commit together under the existing ordering guarantee.

The initial snapshot includes current messages, parts, pending interactions, public work status and a replay cursor. Reconnect from that cursor; ignore already applied versions. For expired history, fetch a fresh bounded snapshot and replace server-derived state while preserving compatible unsent drafts. Load older messages using stable pagination. A completed tool call must not execute again because a client reconnected or replayed a UI event.

Two-stage streaming delivery:

1. **First slice:** durable message/part updates after completed model turns and during tool progress. Explicitly describe this as live progress, not token streaming.
2. **Next slice:** extend the MiniMax adapter for actual text deltas. Coalesce bounded deltas into durable part checkpoints and emit only committed updates. Keep checkpoint frequency/size configurable; do not checkpoint every token. A crashed in-flight model call retains existing uncertain-outcome semantics; mark its incomplete message interrupted. Never silently replay a non-idempotent provider call to reconstruct missing text.

Transient indicators may be dropped on reconnect. Questions, proposals, accepted answers, source references and artifact results must be durable. Thinking indicators show status only; private chain-of-thought is never a user-visible part.

## 9. API and storage changes

Extend the current agent service rather than adding a parallel conversation backend:

| Proposed endpoint                  | Responsibility                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| `GET /api/agent/ui/session`        | Workspace channel snapshot; optional authorized historical session and pagination |
| `GET /api/agent/ui/events?after=…` | Resumable public UI events over existing SSE infrastructure                       |
| `POST /api/agent/requests`         | Existing durable text/attachment intake, presented as Send                        |
| `POST /api/agent/ui/actions`       | Validated structured interaction response and durable receipt                     |
| Existing proposal/cancel commands  | Reused behind registered action handlers                                          |

No model call runs inline inside a UI command handler. HTTP 202 confirms durable acceptance, not completion. Domain updates remain proposals until separately approved.

Proposed migration extends existing message records with public schema/version/state and adds message parts, interactions, action receipts and UI event projection tables. Workspace ID is included in keys and all lookups. Enforce unique message-part IDs, `(workspace, actor, clientActionId)` receipts and one pending blocking interaction per work item. Persist canonical request hashes to reject idempotency-key misuse. Keep payload bounds and retention compatible with existing encrypted storage and workspace deletion policies.

Backfill old message content to one completed Markdown part without changing IDs, authors or order. Project legacy waiting questions into stable free-text interactions and legacy proposals into proposal parts. Backfill IDs once in a migration or persistent reconciliation; never generate new interaction IDs on every GET. Keep the old text-answer path during rollout, mapping it to the same interaction transaction to prevent double continuation.

`ask_user_v2` adds bounded structured question definitions while `ask_user_v1` remains compatible. The tool dispatcher, not the model, allocates interaction identity and permission-bound actions. Tool-output-to-UI projections use an explicit registry; arbitrary tool result JSON is not automatically exposed to the browser or copied into model context.

## 10. Context and presentation rules

The composer shows what context will accompany a message through compact resource chips. Saved resource references stay pinned to revisions. Unsaved drafts are attached only through a deliberate future capture action; navigation must not silently transmit them. Raw file upload remains subject to the existing source ingestion pipeline, rather than being encoded into UI action payloads.

Ambient work appears as an agent update with its cause, such as “Reviewing the ontology you saved”. It must not fabricate a user message. The launcher marks unseen updates separately from work status; reading content clears unseen state, not pending decisions.

Markdown renders through a maintained renderer with raw HTML disabled, safe URL protocols, accessible tables and escaped code blocks. Citations must resolve to authorized, real resources. External links use safe opener behavior. Dynamic forms show field-level errors, retain values after failure and move focus to the first invalid field. A pending control renders only where the user can act; viewer access displays the result and required role without enabling submission.

Scroll follows new content only while already near the end. Otherwise show a new-update affordance. Streaming does not steal focus or announce every token to screen readers. Return focus to the launcher on close. Honor reduced motion and provide textual status alongside color through tooltip/accessibility labels.

## 11. Delivery plan and acceptance gates

### Slice 1: shared interactive component foundation

Extract the surface, transcript, composer and catalog. Add typed Markdown, notice, activity and resource parts. Render existing messages through the shared component in both dock and intelligence page. Replace queue language with Send/Stop/status wording. Add explicit empty/disabled/disconnected states. Preserve the current harness.

Acceptance: navigate and close/reopen without lost drafts; old conversations render; Markdown displays lists/tables/code correctly; unsupported parts degrade locally; both surfaces behave consistently; keyboard access and bounded scrolling hold at smaller viewports.

### Slice 2: durable dynamic interactions

Add interaction/action storage, strict schemas, `ask_user_v2`, choice/form/resource controls and server-side continuation. Present proposal reviews inline using existing authorized review commands. Keep review conflicts and uncertain results visible.

Acceptance: fixture harness issues a choice then a typed form, receives structured values and continues; reload preserves pending controls; duplicate submission resumes once; stale tabs cannot answer twice; unauthorized/cross-workspace actions fail; a rejected or conflicting proposal cannot mutate artifacts.

### Slice 3: resumable presentation stream

Add public snapshots/cursors and committed part events. Verify real tool progress before adding MiniMax text-delta support. Use the same transport/controller for dock and expanded history.

Acceptance: disconnect/reconnect and server restart recover content without duplicate parts or tools; cursor expiry resnapshots; incomplete model output is marked interrupted; partial form payloads never become actionable. Verify live MiniMax streaming separately with an explicitly configured connection; fixture success is not evidence of live provider support.

### Slice 4: domain renderers and ambient polish

Register ontology comparisons, process previews and workflow graph summaries as their actual tools become available. Add explicit attachments, unseen-update state and optional richer catalog extensions. Do not advertise workflow generation before the harness can perform it.

Tests focus on protocol/state transitions, authorization, replay, idempotency and real interaction behavior. Use isolated fixture integration tests for model-driven sequences, plus browser verification of controls, Markdown, field errors, focus, responsive layout and navigation continuity. Run TypeScript and production build. No CSS-class snapshot tests as a substitute for behavior.

## 12. References and decision record

- [AI SDK UI: Generative interfaces](https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces): typed tool results rendered as React components.
- [AI SDK UI: Streaming custom data](https://ai-sdk.dev/docs/ai-sdk-ui/streaming-data): persistent data parts, transient events and updates by identity.
- [Google ADK: Action confirmations](https://adk.dev/tools-custom/confirmation/): pause/resume with confirmation and structured responses; currently documented as experimental.
- [A2UI: Introduction](https://a2ui.org/introduction/what-is-a2ui/): declarative interfaces rendered from a trusted application component catalog.

Decision: adopt these interaction patterns through our own versioned public contract, retaining the existing MiniMax/DBOS harness and Untitled UI renderer. Framework adapters can translate into this contract later. This proposal does not claim A2UI wire compatibility or replace durable execution with a browser chat hook.

## Implementation checkpoint — 2026-10-19

The first licensed React Bits composition is implemented, with adapted `ai-chat-3`, `tool-calls-1`, `agent-activity-2` and `agent-approval-2` source under `vendor/reactbits`. Provenance and source hashes are recorded there. Both dock and intelligence view share the conversation, Markdown, tool-result, activity, question and review-card renderers. The default Queue interface and queue-oriented submit labels are removed. Existing authorized ontology proposal review/application remains the mutation path.

`ask_user_v2` now emits bounded typed fields (text, number, boolean, select and multiselect). Its host-issued interaction identity and definition persist in the durable tool result. The current waiting question is projected through the work-item API. Both intake and transactional answer handling validate values against that persisted definition, work version and workspace before continuation. Decisions remain idempotent. Open form values survive route navigation and closing the dock; submitted answers are visible as read-only cards. Reload restores the pending definition, but unsent form drafts are currently in-memory only.

Verification includes isolated model-fixture restart/duplicate/stale-answer tests and browser checks against a clearly labelled persisted QA fixture. This checkpoint does not implement the proposed general message-part event stream, replay cursor protocol, actual MiniMax token streaming, arbitrary resource-picker controls or inline structural ontology diffs. Those remain explicit follow-on slices. Live provider reasoning was not used to verify the UI.

### Tool-specific renderer bindings

`lib/agent/tool-outputs.ts` now binds every versioned registered tool to a result schema and renderer identity. Server dispatch validates successful results against those schemas. `components/agent/tool-output.tsx` renders workspace resources, ontology/process/source inspection, executable capability lists, validation issues, accepted memories, question summaries and proposal references. Unknown and incompatible results remain explicit fallback states. The React Bits tool-call component hosts the bound renderer; raw observations are available only inside collapsed Technical details.

Ontology proposal review compares stable entity/relationship identities, shows changed domain descriptions and designer metadata, and offers structured current/proposed entity inspection. The existing reviewed application endpoint remains authoritative. Verification now includes live MiniMax completion through the durable harness (workspace lookup), isolated integration tests and browser checks of authorized read-tool output. Credentials are stored through the existing encrypted connection service, not in repository configuration.

### Response content and tool diagnostics — revised interaction contract

User-facing resource links belong in the assistant response. The tool-call disclosure is a diagnostic surface and may display raw arguments/results. This supersedes the earlier placement of resource cards inside the tool-call result slot; the output schema registry remains available for validated domain presentations and interactive controls in response content.

Assistant messages now retain their originating work item and verified resource metadata. References are extracted only from the recorded `workspace_describe_v1` and `artifact_read_v1` outputs for that work. Names in response prose and inline-code labels become internal application links. Existing hyperlinks and fenced code are preserved. Duplicate workflow names expose separate numbered links rather than choosing an arbitrary ID. URLs are constructed by the application from resource kind/ID, never guessed by the model. The migration associates legacy assistant responses with an unambiguous exact settlement record so their captured resource results can also supply links.

### Compact chat layout (React Bits reference refinement)

Use the licensed `ai-chat-3` compact assistant structure, checked against its official browser preview and the `ai-chat-1` tool/source preview. The dock has a single compact header for identity and icon actions, a bounded scrolling transcript, and a persistent composer. Start the composer at one line, grow to 144px, and scroll its content beyond that. Keep the paper-plane Send action inside the same row; actual running work replaces it with Stop at the same position. Enter submits, Shift+Enter inserts a line break, and IME composition must not submit. Running work displays the server state and latest recorded activity in the transcript; do not simulate progress. Context details belong to a focusable tooltip. Do not repeat accepted-request confirmations beneath the input; the recorded user message confirms acceptance. Questions retain their typed controls and hide the message composer until answered.

Structured-answer dispatch compares parsed typed values using canonical JSON, since PostgreSQL JSONB can reorder object keys. Validate both when accepting a request and when dispatching it; changed values, types, array order and stale interactions still fail. A queued answer must disable Continue and show a continuing state. A rejected intake receipt must re-enable the form and show its reason next to Continue, including after reopening the dock. Dynamic Untitled UI controls use square corners in both dock and workbench; preserve explicit control IDs so field labels and errors remain connected.

### Conversation and Activity separation

Both dock and full-screen intelligence now use Conversation / Activity tabs. Conversation contains user messages, assistant responses, questions and reviewable proposals. Tool calls and public execution summaries belong exclusively in Activity, using the licensed React Bits Pro `agent-activity-2` timeline. Expand a recorded row to inspect raw details. Show recorded state and counts, with a spinner only while work is actually running; private model reasoning is never exposed.

The full-screen Conversation has the same persistent icon-only paper-plane composer as the dock. New conversation replaces the unrelated Document analysis header action. Sending targets the selected conversation through the durable request intake; the server verifies workspace ownership before dispatch. Document ingestion remains available through Sources and agent tools.

### Floating intelligence entry point

Use the licensed React Bits Pro AI Blob (`@reactbits-starter/ai-blob-tw`) as one shared bottom-right launcher on admin pages and fullscreen editors. It overlays the page without reserving a footer. Keep canvas controls above its hit area and the shared panel above the launcher. Idle motion is ambient; the thinking mood represents actual active server work. Disable simulated audio. Preserve reduced-motion, hidden-page pausing, status on hover/focus and in the accessible name, and keyboard activation. Do not render a persistent status label beside the orb. The launcher uses a 132px stage while the chat panel is closed, shrinking to 84px while it is open. Closing chat restores the larger stage. Size transitions respect reduced motion; retain a visible fallback if WebGL initialization fails.

When chat opens, the compact orb anchors the panel's lower-right corner. Align both to the same viewport inset and connect the panel with a small surface-colored tail that reaches the orb. Panel entrance originates at this anchor. Keep the composer inside the panel and the orb outside its content; preserve safe-area insets and narrow-screen alignment.

The dedicated `/intelligence` workspace hides both the floating orb and compact chat dock: its full-page agent surface is the active intelligence interface. Other workspace routes retain the shared floating launcher.
