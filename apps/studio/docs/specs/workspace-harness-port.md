# Stack Proc standalone workspace harness

## Decision and source

On 2026-10-19 the user replaced the Harness2 runtime direction with an owned, modifiable workspace harness based on their supplied `claude-src` source. They affirmed reuse permission. `vendor/claude-source-reference` retains 15 unchanged runtime modules, hashes and a dependency audit. No original license was supplied, so the provenance record states the user authorization without assigning an invented open-source license.

The original tree is incomplete: 1,884 TypeScript files, 1,765 reachable from QueryEngine/query, and 536 unresolved local import occurrences in that reachable graph. It cannot be installed as a standalone package. The original modules remain reference material; the executable implementation is a **Stack Proc standalone lifecycle port**, not the original Claude Code engine or the published Claude Agent SDK. Terminal UI, private feature flags, global machine state and vendor authentication have not been transplanted.

## Executable boundaries

| Module                                 | Responsibility                                                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/workspace-harness/query.ts`    | Bounded model → authorized tools → continuation lifecycle, read batching with serial barriers, question/proposal/task suspension and terminal decisions |
| `server/agent/workspace-runtime.ts`    | DBOS activation and model/tool checkpoints, fenced workspace lease, authorization, context assembly, durable receipts and recovery                      |
| `server/agent/model.ts` / `AgentModel` | Provider boundary; selected workspace MiniMax connection, bounded requests/responses, cancellation and protocol validation                              |
| `server/agent/service.ts`, `intake.ts` | Persistent sessions, typed questions/answers, ambient inbox, reviewed changes and SSE records                                                           |
| Existing shared agent components       | Conversation, structured controls, Markdown and Activity presentation                                                                                   |

The agent may call only registered workspace operations. No shell, filesystem, arbitrary package loading or host credential access is exposed to model-generated tool names. Authoritative workspace identity and permissions come from the host, not prompts or tool arguments. Documents and observations remain untrusted data.

## Execution and recovery

A fully received provider response with a non-executable finish reason is a known failure, not an interrupted effect. Record finish reason, response ID, usage and configured response limit on a failed model receipt; dispatch no calls from that response. A `length` finish settles as budget exhausted with a specific explanation. Transport interruptions without a complete receipt remain uncertain and are never automatically repeated. Response token limit is editable under Agent settings → Runtime (new configuration default 16,384); existing work remains pinned to its configuration snapshot.

Each model and tool invocation is a distinct non-retrying DBOS step with a persisted issued/completed receipt. A completed checkpoint replays its result. An issued receipt with no result becomes uncertain and is not automatically repeated. Model protocol messages are encrypted at rest. Connection revision and policy are checked on each fresh model/tool boundary; cancellation is polled during provider I/O.

A question or proposal pauses the activation immediately. Remaining tool calls in that response receive explicit skipped results without executing effects, preserving a complete protocol transcript. Typed answers enter the durable intake and resume the same work item at its next turn. Optimistic versions, canonical JSON validation and idempotent decision receipts remain authoritative.

Each work item records the port revision, source snapshot hash, executable implementation hash, provider and explicit capability flags. Work pinned to a different engine or implementation revision is suspended with an explanation rather than silently switched. Historical Harness2/OpenCode records remain inspectable; no automatic fallback selects those engines. The workflow/queue names are retained for durable outbox compatibility and do not identify the execution engine.

## Revision 2 capabilities

The full supplied source tree is retained unchanged under `vendor/claude-src`; its `.grepai` index is excluded from Git. The owned runtime implements the source concepts at Stack Proc service boundaries:

- MiniMax SSE text streaming with encrypted private protocol, durable replay cursors and separate Conversation/Activity presentation.
- Complete API-round grouping, microcompacted receipt references, encrypted rolling session memory and checkpointed context summaries. Original messages and observations remain stored and accessible through pagination.
- Bounded consecutive read concurrency, serial mutation/question barriers, exact-input single-use approvals and trusted lifecycle hooks.
- Versioned workspace skills, progressive schema discovery, trusted server extensions and authenticated HTTP MCP connections with reviewed effect classifications, credential revisions and schema hashes.
- Durable read-only delegated tasks, bounded depth/fan-out, independent reader leases, parent joins, result paging and cancellation propagation.
- Persistent plans, reviewed workspace memory, isolated QuickJS transformations, schema-validated structured output with bounded repair and user steering applied at model boundaries.
- Immutable conversation forks from message checkpoints, UI history pagination, aggregate token/time/tool budgets and DBOS schedules that enqueue ambient work.

Configure the runtime through Agent settings → Runtime, Skills, Tools and Schedules. Skills and schedules save independent revisions; save agent settings to apply capability selections. Extensions must be installed by trusted server code exporting `agentExtensions` from `STUDIO_ADAPTER_MODULE`. The model cannot install plugins, choose credentials, classify tool effects, bypass approvals or grant permissions through skill text.

A conversation fork copies the selected history, not execution receipts or approvals. Delegated tasks have read-only execution profiles. MCP effects default to approval; only administrators may explicitly classify reviewed offerings as read-only. Pure code runs in the existing disposable QuickJS worker with no filesystem, network, packages, process, shell or secret APIs. External side effects belong in registered connection-bound operations.

Terminal UI, machine filesystem session storage, vendor login/telemetry and Anthropic-private infrastructure are replaced by Stack Proc equivalents. The original source is not compiled as an upstream engine. Harness2 recursive optimization and automatic self-modifying code are not part of the active runtime.

## Verification

Run `npm test`, `npm run test:integration`, and `STUDIO_INTEGRATION=1 npx vitest run server/agent-concepts.integration.test.ts`. The integration service executes the new port with a deterministic injected model; injection is forbidden outside the integration environment. Real MiniMax checks use a separate copied application database and system database, the existing encrypted connection, read-only workspace inspection and a typed question. Never use fixture success as live-provider evidence.

The development service is restarted only after isolated checks complete and no durable workflows are pending. Existing editor drafts are not refreshed or modified by the cutover.

## Tool authoring design

The [Tool builder and developer CLI](tool-builder-and-cli.md) specification supersedes the preliminary authoring design. It defines a dedicated code editor, a portable source package shared with the developer CLI, isolated execution profiles, developer authentication, immutable builds/releases and shared agent/workflow invocation. Status: first pure-code browser/CLI release implemented; see the [implementation notes](tool-builder-implementation.md) for current availability and remaining profiles.
