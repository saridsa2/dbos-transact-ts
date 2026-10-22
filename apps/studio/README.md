# Stack Proc

StackProc's existing visual flow builder, graph model, and graph traversal ported into the DBOS repository. This is a standalone application in `apps/studio`, using this checkout's SDK through a local package link. It is excluded from the SDK's published package.

## Start locally

Requires Node.js 22.13+ and Docker with Compose. From the repository root:

```sh
npm ci
npm run build
cd apps/studio
npm ci
npm run db:up
npm run dev
```

Open **http://127.0.0.1:3100**. The Node service listens on `127.0.0.1:3021`; Next forwards `/api/*` requests to it. Postgres listens on `127.0.0.1:55432`. No model account is needed to run the review example.

The local defaults work without an env file. To customize database connections, copy `.env.example` to `.env.local`. The service creates its application tables on startup; DBOS creates/migrates its own system database.

Stop the web/service processes with Ctrl+C. `npm run db:down` stops Postgres while preserving the named volume.

## Customer control plane

Open **http://127.0.0.1:3100/control**. Continue with the labelled development identity, then create a customer/workspace. To retain access to existing local workflows/history, select **Include the existing local workflows and history** during onboarding. Leaving it unchecked preserves those workflows in the original local workspace for later adoption.

The control plane has connection creation/editing, encrypted secret storage, rotation/revocation, people/invitation management, run history and an audit trail. OpenAI, Anthropic/Claude, Microsoft Foundry, HTTP, MCP, Postgres and AWS STS have typed connection forms. Saved connections show that live provider access is unverified; framework/integration adapters consume their references in the next phase.

Invite links are bound to email and expire after seven days. Share the generated link yourself; no email is sent by the application. Owner/admin manage credentials and people, editors build/run/review workflows, and viewers read scoped data. The workflow APIs now require an identity and authorized workspace. Development sessions survive a service restart.

Authentication is behind `AuthAdapter`; temporary AWS credentials use a separate `CredentialResolver`. External identity deployments require `STUDIO_AUTH_ADAPTER_MODULE` and `STUDIO_CREDENTIAL_KEY`. The service refuses the development identity adapter in production. In development it creates an ignored `.studio/credential-key` file with restricted permissions; keep that key when backing up or moving the development database. Raw credential values have no HTTP read endpoint.

Separate [product specifications](docs/specs/README.md) cover the customer control plane, identity and both STS cases, framework offerings, and integration nodes inspired by n8n. Enterprise SSO/token exchange implementations, provider connectivity validation and live node adapters remain configuration/implementation milestones beyond this local slice.

## Try the complete path

1. Click **Open review example** on the workspace page.
2. The imported StackProc canvas opens. Drag nodes to arrange them. Right-click a node, or use its wrench action, to open the original inspector.
3. Edit the trigger's **Run input** field. Click **Done**, then **Save** in the top toolbar.
4. Click **Run**. Start and Prepare request complete; Review request waits.
5. Click **Resolve** on Review request. Approve or reject it. Only the matching output branch runs.
6. Click **Back** to inspect saved workflows and run history. Open a run to replay its persisted trace and original graph snapshot. Run snapshots are read-only; use **Edit saved workflow** in the banner to return to editing.
7. To check recovery manually, start another run and leave it waiting. Restart just the service (`npm run dev:service` if running separately). Reload the flow and resolve it. The existing run resumes with its completed node results.

For a blank graph, use **New workflow**. Add nodes from the catalogue or canvas context menu. Use node handles to connect them, drag connector endpoints to reconnect, and select an edge to configure its branch. **Export graph JSON** downloads the existing StackProc nodes/edges format; **Import graph** accepts it on the workspace page.

## DBOS-native graphs

The workspace includes 15 runnable source-derived graphs, including Document ingestion pipeline, Human-in-the-loop, Transactional outbox, Queue worker, Customer service refund flow, CI/CD Slackbot pattern, S3Mirror pattern, and Hacker News research pattern, alongside the original seven fixtures. Select a card, then **Run**. The existing StackProc canvas now renders schema version 2 graphs with these operations:

- Durable steps and datasource transactions; step retry/timeout policy.
- Decisions with success/error/true/false/timeout control edges and typed data bindings.
- Child workflow calls (await or background), ordered result collection, parallel branches, bounded loops and sequential/parallel collection scopes.
- Durable delays, message send/receive, event publish/wait, native human review, data mapping and return.

Right-click a node to open its inspector. Choose a registered step/transaction handler and edit **Operation and data bindings** as JSON. Bindings select literals, workflow input, upstream outputs, the current item, loop state or execution IDs. References cannot read arbitrary JavaScript properties or execute source. **Open referenced graph** lets you inspect/edit an embedded child; **Back to parent (keep edits)** incorporates it into the root draft. Save at the root. Run progress links to each independently persisted child execution.

**Resources** configures queues (global/worker/partition concurrency and rate limit) and cron/timezone schedules. Enabling a schedule and saving activates it; disabling and saving removes it. Scheduled runs use the saved Start input. Queue references and optional partition/delayed-start bindings belong to child dispatch operations. **Debounced run** submits keyed invocations of the saved graph. Each accepted submission shows a counter, pending run ID, accepted input and countdown. Re-submitting the same key before execution starts replaces input and restarts the countdown; submitting after it starts schedules another run. The dialog stays open and shows execution status/results; **View run** opens the trace. This uses the SDK debouncer.

To test payment success, run **Payment and compensation**, then **Send message** with topic `payment` and JSON value `"paid"` within 30 seconds. Letting it time out or sending another value follows inventory compensation. The reservation/ledger/restore operations are actual local Postgres datasource transactions. To test recovery, run **Reminder** and restart the service while it waits. The run continues from its original snapshot. API invocation remains available at `POST /api/flows/run`; debounced invocation uses `POST /api/flows/:id/debounce` with `{key,periodMS,input}`.

The outer graph is acyclic. Repetition uses child execution scopes, with stable separate IDs for each item/iteration. Independent ordinary DAG nodes execute sequentially; use explicit parallel/foreach operations for concurrent child work. Loop and collection limits are validated. The v1 interpreter and existing StackProc graphs remain separate from v2 semantics.

The document fixture accepts inline text or page arrays, parses pages and writes a full-text index to local Postgres. Its output counts documents/pages; it does not download PDFs, create vector embeddings or provide RAG chat. **Human-in-the-loop** waits on a durable review task with the existing **Resolve** form and an expiry. Customer refunds use local purchase records, a price policy and a detached review child. The outbox fixture implements the source's `atomic_workflow.py` transaction/notification sequence; it does not implement the separate transactional enqueue SQL variant. Mirror copies and deployment notifications write local records.

Example handlers prepare reminder data and simulate fleet operations; they do not send email, provision infrastructure, charge payments or call models. The research fixture searches supplied articles, accumulates deduplicated findings across passes, and assembles a report with source links. It has no live Hacker News search, LLM reasoning, LangGraph runtime or connected agent. Streams, first-completion joins, queue rescheduling, and explicit break/continue ports are follow-on work. See [node model](docs/dbos-node-model.md) and [reference catalog](docs/example-reference-catalog.md).

## Runtime and persistence

```text
StackProc canvas → graph JSON → local Node service
                                  ├─ application Postgres: graphs, snapshots, runs, events, approvals
                                  └─ DBOS workflow: graph traversal
                                       ├─ DBOS.runStep: node result + retry policy
                                       ├─ DBOS.runStep: idempotent application events
                                       └─ DBOS.recv: durable approval decision
```

- Every run receives an immutable graph snapshot, input, and stable workflow ID. Editing the saved graph does not alter an in-flight run.
- Durable step results are DBOS checkpoints. Transactions use the Postgres datasource adapter and atomic checkpoints; waits/messages/events/child dispatch run at workflow level. Recovery replays traversal and reuses completed operations.
- Approvals are real durable waits. Resolving an approval writes a decision to a Postgres outbox; the service sends it with a DBOS idempotency key. Restarting between recording and sending a decision does not lose it.
- Browser streams read persisted run events. Disconnecting the browser does not cancel execution. A stream closes when a run finishes, fails, or reaches a durable wait; the editor polls persisted events so timed waits and native messages update automatically. Resolving a legacy approval reconnects its stream.
- Queued application runs are reconciled into DBOS using the same run IDs, closing the startup/dispatch failure window.
- The application database (`studio`) and DBOS system database (`studio_dbos`) have separate ownership and schemas. No direct reads or writes to DBOS internal tables are used.

Completed-step reuse does not make an external side effect exactly once: an interruption after a remote service accepts a request but before its result is checkpointed can still repeat the request. Domain tool adapters should use idempotency keys where appropriate and observe `context.signal` for timeout cancellation.

## Domain adapters

The core graph remains domain-neutral. Trigger, prompt, legacy boolean condition, output, human approval, and the **Echo input** tool work out of the box. LLM nodes and other tools fail with explicit configuration errors until a trusted server module registers handlers. There are no simulated model results or live provider calls in this port.

Set `STUDIO_ADAPTER_MODULE` to a local TypeScript module exporting `register(registry)`:

```ts
import type { NodeRegistry } from './server/registry';

export function register(registry: NodeRegistry) {
  registry.registerTool('reference.lookup', 'Lookup reference', async (_node, context) => {
    return { reference: context.input.variables?.reference, found: true };
  });
}
```

`registerTool` adds an operation to the existing tool selector. `registerModel(profile, handler)` adds a model profile and handler to the existing model selector. `register(kind, handler)` overrides a core node handler, for example to add richer condition evaluation. Handlers receive the node plus input, prior outputs, and an optional timeout signal. Keep credentials inside server adapters/environment variables. Do not mutate graph or context objects from a handler.

Existing StackProc visual kinds remain available for legacy graphs. Native graphs use the DBOS palette. `registerStep(id, label, handler)` registers domain operations; `registerTransaction(id, label, handler)` registers adapters that must call a DBOS datasource's `runTransaction` at workflow level. The registry does not wrap arbitrary SQL in a transaction automatically. Native handler context includes `runId`, `nodeId`, `executionId`, bindings and step cancellation signal. Register datasource instances before `DBOS.launch()` as shown in `server/example-handlers.ts`.

## Source and scope

Imported from `saridsa2/stackproc-ai`, branch `agentic-sop-compiler`, commit `2fd8f0d7fdc6af20b4f72bf732ce37ed5913725d`:

- `components/flows/flow-builder.tsx`: actual custom canvas, pointer handling, edge routing, inspector, palette, run visualization. Adapted API calls, model/tool defaults, JSON export, branch configuration, reliability fields, and status handling.
- Supporting UI primitives, connector configuration fields, node actions, fonts, and the existing canvas stylesheet.
- `lib/flows/types.ts`: existing graph and event contracts; adds optional execution policy.
- `lib/flows/executor.ts`: existing graph traversal, branch pruning, resume frontier, and join readiness; node behavior is injected through runtime adapters. Node/edge validation now rejects cycles.
- Edge-branch, escalation-mapping, and node-action tests are retained from upstream.

Persistence is adapted to small application-owned Postgres tables instead of bringing over StackProc's entire Drizzle schema, auth system, and workspace application. The local approval form replaces its password/e-signature flow; it records developer decisions, not verified signatures. The service remains bound to loopback. The control plane adds workspace authorization and a development identity adapter; enterprise authentication is supplied through the documented adapter contract.

SOP compilation, clinical templates, model providers, governed connector broker/runner, e-signatures, workspace auth, and Foundry provisioning have **not** been migrated. These remain separate follow-on modules; the graph retains their existing configuration fields for compatibility. The visual editor is reused, not replaced.

## Verification

```sh
npm test
npm run test:integration  # needs the Compose Postgres instance
npm run build
```

Integration tests use separate `studio_integration` and `studio_integration_dbos` databases. They run the real SDK and a separate service process, kill it with SIGKILL while a run is waiting, restart, and verify completed side effects are not repeated. They also check immutable graph snapshots, approval/rejection branches, duplicate decisions, failed tools, and invalid graphs. Native integration coverage also includes document page indexing across restart, approve/reject/expired native reviews, outbox gap recovery, worker/deployment/mirror children, low/high-value refunds, research state accumulation, repeated debounce submissions after completion, nested replacement graphs, loop state and identities, queued ordered collection, transaction checkpointing, payment timeout compensation, message recovery, durable delay recovery, delayed dispatch, schedules and debouncing across restart. Unit tests cover bindings, native outcomes, inherited branch/join behavior, adapters, graph validation and stable edge geometry.

### UI components

The customer control plane uses official Untitled UI React components, installed through the Untitled UI MCP/CLI, with Font Awesome Pro Regular icons and locally bundled Geist Variable. Product styling follows the licensed Nexbic reference: warm neutrals, black actions, square controls, and light display headings. License notices are in `licenses/`. The `ui-` Tailwind color namespace prevents the controls from overriding the existing workflow canvas colors.

To update the component sources, use the authenticated Untitled UI MCP and official CLI. Preserve the Font Awesome import mapping and namespaced theme when updating; no API or registry token belongs in this repository.

### Stack Proc shell and notifications

The workspace header/sidebar shell uses the original StackProc logo mark, Untitled UI workspace/profile menus, and a notification menu. Open `/control?tab=runs` for execution history or `/control?tab=connections` for provider connections, including Azure service principals, Azure OpenAI and Microsoft Foundry.

One authenticated SSE stream updates workspace data and execution traces through shared hooks. Notifications are persisted in Postgres and replay after reconnect; node checkpoints refresh execution views without appearing as individual bell notifications. Run a workflow to see live execution notifications. Workspace changes and revoked memberships are checked server-side.

The visual builder opens fullscreen at `/flows`; Back returns to the workspace. Notifications open the referenced resource and persist read state per user. The profile menu includes account details and explicit identity/sign-out actions.

Initial integration definitions and the HTTP-first delivery plan are in [the v1 catalog](docs/specs/integration-catalog-v1.md). The discovery API returns definitions, not a claim that provider adapters are installed.

### Admin layouts

Admin features use the shared `WorkArea` composition in `components/control/work-area.tsx` and the `stackproc-work-area` skill linked from `AGENTS.md`. The header contains page actions and search/filters; tabs follow it. Table/content viewports scroll inside the fixed frame, with sticky table headers and a persistent footer. Table actions are accessible icon buttons. People and the workflow library have separate task views; creation/editing occurs in focused dialogs with fixed action footers.

### Expressions, variables and code nodes

Open **Workflows → Examples → Code and workflow variables → Use example**, then **Run**. The default input `[1, 2, 3]` and factor `3` return `18`. Inspect the code node to view its checkpointed array, logs and source revision. **Resources → Variables** declares workflow values; **Set variables** updates them during execution.

Data parameters have Fixed and Expression modes. Fixed objects and arrays are edited as nested fields, with independent modes on each child. Expressions reference `$input`, `$vars`, static upstream `$nodes["node-id"]`, `$item` and `$state`; a constrained parser supports arithmetic, conditions and documented pure helpers. The left pane explores input/variable/upstream data and copies expression paths. Invalid fields and tabs show red error markers. **Done** applies a draft; **Save** persists it. Cancel discards modal edits.

The **Code** node supports JavaScript and TypeScript, once for all input or per array item. Code runs in QuickJS WASM inside a disposable worker, with bounded guest memory, wall-clock time, input/output, logs and concurrency. **Test code** performs an authorized standalone test; **Preview inputs** only resolves parameters. Neither creates a workflow checkpoint. Within a workflow, DBOS checkpoints code results and retains the pinned source/runtime revision. Code defaults to one attempt; recovery reuses completed checkpoints. External I/O, Node APIs, credentials and package imports are not exposed by this initial runner. Provider I/O stays in registered integration adapters.

The persisted authoring model and execution boundary are documented in [the authoring contract](docs/specs/workflow-authoring.md).

## Private remote browser testing

Run Studio on the development machine and use Tailscale Serve to proxy `http://127.0.0.1:3100` privately. Both laptops must be connected to the same authorized tailnet. Set `STUDIO_ALLOWED_ORIGINS` in `apps/studio/.env.local` to the exact HTTPS origin, then restart `npm run dev`. This configures both the API browser-write origin checks and Next.js development-asset origins. Comma-separated origins are supported; wildcard origins are not. API authentication and workspace authorization remain required, and the backend/Postgres stay on loopback. Use `tailscale serve --bg http://127.0.0.1:3100` to enable the proxy, and `tailscale serve --https=443 off` to stop it. Keep the development machine awake while testing.

Ontology records open in the fullscreen Microsoft Ontology Playground designer/explorer, adapted with Stack Proc controls and icons. See [upstream provenance and adaptations](vendor/ontology-playground/README.md). `npm run dev` and `npm run build` generate the scoped upstream stylesheet automatically.

### Workspace agent and RDF import

Open **Workspace intelligence → Agent settings**. Observe mode can index workspace metadata without a model connection. To use reasoning and ontology proposals, choose Assist, select a configured MiniMax connection and explicitly allow content to be sent to MiniMax. Ambient triggers are opt-in. Conversations, questions and tool activity persist across restarts; proposed changes require review before they create an ontology draft revision.

The ontology designer now has **Import RDF** for RDF/XML files or pasted XML. Preview first, then Replace draft; Undo reverses replacement and Save creates a revision. Imported entities use Stack Proc icon glyphs and Material colors. External OWL imports are not fetched.

The first harness slice and remaining stages are documented in [implementation notes](docs/specs/workspace-intelligence-implementation-notes.md#ambient-harness-implementation--2026-10-19). Document ingestion remains available through Sources; the intelligence header provides New conversation and Agent settings.

The ambient **Workspace agent** launcher is available in the shell and fullscreen editors. Requests capture saved screen context and enter a durable workspace inbox; a DBOS harness queue performs inference independently of the UI. Follow-ups may be queued while earlier work runs. Feature code should submit through `useWorkspaceAgent().request(...)`; the intelligence page is for inspection and review.

### Owned workspace harness

The ambient workspace agent now executes through the standalone Stack Proc lifecycle port in `server/workspace-harness`, with DBOS model/tool checkpoints and the configured workspace MiniMax connection. The complete supplied source is retained under `vendor/claude-src` (`.grepai` ignored), alongside the earlier dependency audit under `vendor/claude-source-reference`; they are reference material, not a runnable upstream dependency. This is not the Claude Agent SDK. See [the port contract](docs/specs/workspace-harness-port.md) for provenance, replay behavior and scope. Revision 2 adds context compaction, encrypted rolling history, token streaming, read concurrency, skills, hooks, trusted extensions/MCP, read-only subagents, plans, reviewed memory, structured output, steering, forks and scheduled ambient work. Configure these through Agent settings. Harness2/OpenCode is not a production fallback.

Local semantic memory uses an explicitly provisioned, offline EmbeddingGemma 2 worker. See [setup, model pin and verification](scripts/memory-embeddings/README.md); MiniMax remains the reasoning provider.
