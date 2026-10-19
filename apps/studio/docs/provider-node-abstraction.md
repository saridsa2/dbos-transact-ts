# Provider node abstraction and offerings

The product has a customer control plane and a workflow builder backed by DBOS. The control plane owns customer onboarding, users, credentials, connections and run auditing. The builder exposes framework capabilities from Vercel AI, CrewAI and related integrations, plus integration nodes inspired by n8n. Workflow nodes reference connections managed by the control plane.

Account Management is a reference for the customer control plane. It does not supply workflow node offerings. Its existing billing and identity patterns can inform onboarding; connection/key management and run auditing are product capabilities we must add.

This overview records the product boundaries. Separate [product specifications](specs/README.md) now track delivery: the first local customer control plane slice is implemented, identity/STS adapter contracts are available, and framework/integration execution adapters follow.

## Source versions

The repositories are cloned beside `dbos-transact-ts`. These commits pin the reviewed contracts:

| Repository                                                                | Commit                                     | Source entry points                                                                                |
| ------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| [Account Management](https://github.com/dbos-inc/dbos-account-management) | `2335e53e256285c5e59fae04e10e21387007fb1d` | `src/subscription.ts`, `src/server.ts`, migrations                                                 |
| [Vercel AI integration](https://github.com/dbos-inc/dbos-vercel-ai)       | `607a2de41a6bd6d98fd6eebdf3f634eaa0eb6d7f` | `src/index.ts`, `middleware.ts`, `tools.ts`, `agent-tool.ts`, `mcp.ts`, `durable-stream.ts`, tests |
| [CrewAI integration](https://github.com/dbos-inc/dbos-crewai)             | `61acb373c0be8a437ff6deade3df1bc0c0186720` | `dbos_crewai/dbos_agent.py`, `dbos_agent_executor.py`, `dbos_llm.py`, tests                        |
| [Durable Swarm](https://github.com/dbos-inc/durable-swarm)                | `f04f6ffedb5a334fd0490e91df95798dc086ee6c` | `durable_swarm.py`, basic handoff/context examples, airline and refund examples                    |

## Customer control plane

Use `dbos-account-management` as an application reference for customer accounts, identity, onboarding and account lifecycle. Keep this application surface separate from the canvas and its node catalog.

| Area                 | Product responsibilities                                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Customers and users  | Customer/organization onboarding, workspaces, user invitations, membership, roles and account lifecycle                                                                                                            |
| Credentials          | Onboard OpenAI and Anthropic/Claude keys; store server-side secret references; validate, rotate and revoke credentials                                                                                             |
| Connections          | Manage customer-owned model-provider connections, Microsoft Foundry connections, external data sources and other services; track endpoint/project/deployment metadata, authentication method and connection status |
| Access               | Scope connections to the owning customer/workspace and authorize their use by users, workflows and workers                                                                                                         |
| Run auditing         | Record who started a run, graph/version, node and tool activity, connection/resource revisions, timestamps, outcomes, errors and available usage/cost data                                                         |
| Administration audit | Record account, membership, credential and connection changes with actor and time; exclude secret values from logs and audit records                                                                               |

A connection is a reusable control plane resource. A user configures it once and selects it from compatible nodes or model resources. Workers resolve secrets server-side after checking customer/workspace access. Graph exports, run snapshots and traces contain connection references and non-secret metadata.

An OpenAI, Anthropic or Microsoft Foundry connection describes access to a service. Vercel AI and CrewAI describe how agent/model/tool work executes. A framework can use compatible model connections without owning customer credential storage.

## Offerings from each integration

These are proposed palette offerings derived from the agent integration sources. Framework integration, model vendor and external service remain separate catalog dimensions. The Account Management application is outside this palette.

| Integration   | Offerings                                                                                                                                                     | Configuration and resources                                                                                              | Execution                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Vercel AI     | Generate text; stream text; run tool-loop agent; execute registered tool; discover/call MCP tools; delegate to subagent; generate embeddings; generate images | Model reference, prompt/messages, tool set, agent definition, MCP connection, output schema, stream reference and limits | Middleware owns inner model/tool steps; agent/subagent scopes run as workflows                                          |
| CrewAI        | Execute agent task; configure agent role/goal/backstory; bind task context and expected output; attach tools and a function-calling model                     | Versioned agent/task definitions, model references, explicitly durable tools, Python worker                              | Agent executor is a Python workflow; LLM calls are steps; each tool declares its own step/transaction/workflow boundary |
| Durable Swarm | Run agent conversation; expose function tool; hand off active agent; carry context and message history                                                        | Agent definitions, instructions, function tools, model, context, turn limit, Python worker                               | Conversation is a workflow; wrapper checkpoints completions and tool-call handling                                      |

Agent role, model selection, tool membership and task definitions should have resource editors. A workflow node binds those resources to an input and starts execution. This avoids turning every agent property into an executable node.

CrewAI's README labels the integration work in progress. Its executor retrieves instances from a process-local cache and explicitly notes recovery fails when the instance is absent. Worker startup must reconstruct versioned agent/task registrations before recovering runs. The repository demonstrates durable agent-task execution; durable crew kickoff, hierarchical process orchestration and persistent shared memory need separate verification. [Executor](https://github.com/dbos-inc/dbos-crewai/blob/61acb373c0be8a437ff6deade3df1bc0c0186720/dbos_crewai/dbos_agent_executor.py), [README](https://github.com/dbos-inc/dbos-crewai/blob/61acb373c0be8a437ff6deade3df1bc0c0186720/README.md).

Durable Swarm's README points production users to the DBOS OpenAI Agents integration and says streaming is unsupported. Keep its handoff/context semantics in the abstraction; mark the Swarm adapter as legacy. Its tool-call wrapper is a batch boundary, so the UI cannot assume independently checkpointed calls from that wrapper alone. [Wrapper](https://github.com/dbos-inc/durable-swarm/blob/f04f6ffedb5a334fd0490e91df95798dc086ee6c/durable_swarm.py), [status](https://github.com/dbos-inc/durable-swarm/blob/f04f6ffedb5a334fd0490e91df95798dc086ee6c/README.md).

## Integration nodes inspired by n8n

Integration nodes expose an external service through a discoverable service, resource and operation selection. Each operation defines typed inputs/outputs, a parameter form, supported authentication/connection types, error outcomes and runtime behavior. Connection-dependent choices such as models, deployments or source collections are resolved through the selected connection.

The initial node families are:

- **Framework execution:** Vercel AI agent/model/tool capabilities; CrewAI agent-task execution; compatible conversation/handoff abstractions.
- **Model capabilities:** generation, streaming, embeddings and other supported operations, using a compatible OpenAI, Anthropic or Microsoft Foundry model connection.
- **External service and source integrations:** service-specific actions and data retrieval, plus generic HTTP/MCP capabilities, backed by control plane connections.
- **DBOS orchestration:** the existing steps, transactions, child workflows, queues, decisions, waits, messages, loops and human review.

An integration operation should be reusable as a standalone canvas node or as an agent tool. Both use the same operation definition, connection permissions, input schema and execution adapter. Trigger offerings can invoke graphs through provider-specific ingress adapters; account onboarding itself remains a control plane user flow.

The inspector should offer a connection picker, resource/operation selectors, validated parameter fields, data bindings and connection status. The canvas can show the integration name and operation while DBOS continues to own durable execution.

## Capability and node contracts

Use stable, versioned offering IDs such as `vercel.agent.run@1`, `crewai.task.execute@1`, `swarm.conversation.run@1` and `http.request@1`. Keep the offering version separate from the installed package version and model vendor.

A capability definition should declare:

- **Identity:** offering ID/version, integration, label, category, source package/version and runtime support status.
- **Ports:** input/output JSON Schemas, named outcomes, optional stream/artifact outputs and supported binding sources.
- **Configuration:** a schema for provider-specific settings, field labels and references to models, agents, tools, connections and datasources.
- **Execution:** boundary `step`, `transaction`, `workflow` or `remoteWorkflow`; checkpoint owner; runtime language; registration/factory reference; concurrency restrictions and cancellation behavior.
- **Policies:** supported retries/timeouts, per-call policy ownership, iteration limits and operation idempotency requirements.

A graph node stores an offering reference, an operation reference, a customer/workspace connection reference, other resource references, validated configuration, typed input bindings and layout. Its connection reference resolves to credentials held by the control plane; code stays in trusted server adapters. A run snapshot pins the offering, adapter and agent/task versions and resolved resource revisions without copying secret values into graph JSON. Replay must resolve those exact definitions or report an unavailable version.

For an agent invocation, shared fields include `agentRef`, `messages` or `taskInput`, `context`, `toolSetRef`, `limits`, and optional `streamRef`. Provider-specific settings remain namespaced and schema-validated. Preserve native messages, tool results, usage and artifacts where conversion to the common envelope would lose information.

**Delegation and handoff need distinct contracts.** Delegation invokes a child and returns a result to the parent. Handoff changes the active agent for the continuing conversation, carrying message history and context. A Swarm transfer should not be lowered to a child call that returns automatically.

## Execution rules

1. **Checkpoint ownership is explicit.** Existing `registerStep` handlers execute inside `DBOS.runStep`. The Vercel integration checks that it is in workflow code before creating its inner steps. Wrapping a whole durable agent in our ordinary step would make those inner calls ordinary functions and lose granular recovery. Add workflow-capable adapter registration and dispatch before exposing agent offerings. [Vercel context detection](https://github.com/dbos-inc/dbos-vercel-ai/blob/607a2de41a6bd6d98fd6eebdf3f634eaa0eb6d7f/src/internal.ts).
2. **Parallel model work gets isolated workflows.** The reviewed Vercel middleware rejects overlapping durable language/embedding calls in one workflow. Independent branches should launch child workflows with stable IDs. Subagents already have their own workflow registration, queue and timeout. [Middleware](https://github.com/dbos-inc/dbos-vercel-ai/blob/607a2de41a6bd6d98fd6eebdf3f634eaa0eb6d7f/src/middleware.ts), [subagents](https://github.com/dbos-inc/dbos-vercel-ai/blob/607a2de41a6bd6d98fd6eebdf3f634eaa0eb6d7f/src/agent-tool.ts).
3. **Python execution needs a worker protocol.** CrewAI and Swarm cannot execute inside the TypeScript registry. Define enqueue/lookup/result/cancel operations using an explicit cross-runtime transport and serialization contract. Persist the remote execution ID, correlate child traces, and recover dispatch using a stable idempotency key. Sharing Postgres alone does not establish cross-language invocation compatibility.
4. **Tools declare their boundary.** Vercel `durableTools` wraps ordinary tools but preserves subagent tools as child workflows; CrewAI requires explicit tool decoration. Record those distinctions in tool definitions. A retry of an external mutation still needs provider-side idempotency when available.
5. **Streams are separate from node status.** Vercel exposes durable UI chunks and offsets, plus notifications that replace output from interrupted/re-executed calls. Studio's node-event NDJSON stream cannot stand in for this. Persist stream references/cursors and support replacement and cancellation in the reader. [Durable streams](https://github.com/dbos-inc/dbos-vercel-ai/blob/607a2de41a6bd6d98fd6eebdf3f634eaa0eb6d7f/src/durable-stream.ts).

## Changes in Studio

The customer control plane needs account/workspace/user persistence, connection and credential services, onboarding screens and audit views. The workflow builder consumes those services through scoped resource references.

| Area                                       | Next change                                                                                                     |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `lib/native/catalog.ts`                    | Add offering metadata and schemas alongside the existing primitive catalog; group by capability and integration |
| `server/registry.ts`                       | Register versioned capabilities with explicit execution boundaries, resource requirements and availability      |
| `server/native-runtime.ts`                 | Dispatch adapter workflows outside ordinary steps; snapshot definition versions; preserve remote child IDs      |
| `lib/native/model.ts` and graph validation | Add offering/resource references and validate schema compatibility, policy support and runtime availability     |
| `components/flows/native-node-fields.tsx`  | Render offering-specific fields and resource selectors from schemas; retain advanced JSON editing               |
| Run persistence and progress UI            | Correlate agent turns, tool calls, delegation/handoffs, usage, remote runs, streams and artifacts               |
| Invocation service                         | Add provider-specific trigger ingress and deduplicated invocation when required by an integration               |

The palette should distinguish configured, missing connection, missing worker, experimental and legacy offerings. Imported definitions can be inspectable even when their adapter is unavailable; dispatch must reject unavailable execution with a concrete reason.

## Implementation order and acceptance

First establish customer/workspace identity, credential and connection resources, audit contracts, and the capability registry with workflow-capable adapter registration. Then expose Vercel AI and CrewAI offerings and build external integration nodes against those connection contracts. Vercel can execute in the TypeScript runtime; CrewAI needs a tested Python worker protocol. Preserve Swarm handoff semantics while evaluating its replacement for new agent execution.

Acceptance requires customer/workspace isolation for connections and runs; keys excluded from graph exports and audits; authorized credential resolution; run and connection-change audit records; recovery without repeating completed inner model/tool calls; stable parallel child identities; stream replacement/cursor behavior; provider trigger deduplication where needed; delegation returning to its parent; handoff preserving conversation ownership; and Python worker restart reconstructing registrations. Live provider validation requires configured test accounts and credentials.
