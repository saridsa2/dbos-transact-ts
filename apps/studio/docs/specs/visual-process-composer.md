# Visual process composer with agent activities

Status: proposed product and technical design for review, 2026-10-20. This specifies a new process representation; it does not claim that gateways, lanes, agent activities or their compiler adapters are implemented. It supersedes the process form and Overview / Inputs / Steps tabs as the intended primary authoring surface.

Implementation plan: [Shared workflow editor for visual process authoring](process-editor-technical.md). The existing workflow canvas and card renderer are authoritative for the first delivery; that technical specification refines the shape proposals below without changing their process semantics.

## 1. Product model

A process is a visual description of how work moves between people, agents and systems to achieve a business outcome. Users must be able to see what starts the work, who owns each activity, which information it needs, how decisions change the route, and what completes or interrupts it.

The process graph is the business contract. A generated workflow is its executable implementation. One business activity may map to several workflow nodes, a durable human wait, or an inspectable agent workflow. The process and implementation share navigation and visual-editor foundations without becoming the same abstraction.

Use familiar BPMN concepts: events, activities, gateways, subprocesses and responsibility lanes. Extend the activity model with an explicit agent activity. The initial notation is BPMN-inspired, not a claim of BPMN 2.0 conformance or XML interoperability. Square task cards follow Stack Proc styling; standard BPMN tasks have rounded corners. Full standards import/export requires a separate compatibility specification and loss report.

The ontology describes the business concepts flowing through the process. The process describes their treatment and permitted transitions. Connections and tool bindings supply implementation; they do not define business meaning.

## 2. Visible vocabulary

| Element                 | Canvas representation                                                    | Meaning and required configuration                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Start                   | Small circle with start marker                                           | One process input contract. Invocation profiles select manual/API/webhook/schedule entry; credentials and schedule policy remain resources. First release has one start per process. |
| Task                    | Square card, action name and performer badge                             | One business activity, required inputs, expected outputs, owner and outcomes. Execution may be unresolved, registered operation, referenced workflow, human task, or agent activity. |
| Human task              | Task card with person marker                                             | Assigned role, instructions, trusted form, response schema and deadline. An approval declares allowed decisions and authorization separately from generic data collection.           |
| System task             | Task card with system marker                                             | A versioned registered operation or referenced workflow with authorized connection bindings.                                                                                         |
| Agent activity          | Task-shaped collapsed subprocess with agent marker and expand affordance | Bounded goal, context, typed result, permitted tools, execution identity, budget and escalation. Its reasoning/tool loop is workflow composition, not an atomic operation.           |
| Decision                | Diamond marked X                                                         | Deterministic selection of exactly one outgoing route from typed facts, including a default route. Agent judgment happens in an upstream activity and produces validated facts.      |
| Parallel split and join | Paired diamonds marked +                                                 | Start all branches and wait for all required completions. Pairing, cancellation and output merge rules are explicit.                                                                 |
| Wait                    | Event circle with message or timer marker                                | Wait for a correlated response/event or deadline, with a declared timeout route.                                                                                                     |
| Subprocess              | Activity card with expand affordance                                     | Reusable or nested business procedure with an explicit input/output boundary.                                                                                                        |
| End                     | Circle with completion marker                                            | Named business outcome and output mapping; examples include completed, declined or cancelled.                                                                                        |
| Exception boundary      | Attached error/timer marker                                              | An explicit failure or timeout exit attached to an activity. Initial implementation supports interrupting boundaries only.                                                           |
| Lane                    | Horizontal labeled responsibility band                                   | Business owner/team, with optional default performer metadata. Lanes are not execution scopes or authorization grants.                                                               |
| Evidence annotation     | Small source badge linked to a node or route                             | A pinned source revision and locator, or a user-authored rationale. It is not executable work.                                                                                       |

Use labels and markers as the primary distinction; color is secondary. White surfaces, thin neutral borders and charcoal text/actions match the existing editors. Avoid a different colored rectangle for every node type. Selection actions sit above the selected node. No gray configured bar.

Business task identity is stable when its implementation changes. Replacing a human executor with an agent must preserve the business task ID, while changing its execution configuration, review status and compiled revision.

## 3. Connections and execution rules

A solid arrow means that work may proceed after the source completes. Route labels explain the condition or named outcome. Data dependencies are configured in Input / Output mapping and can be overlaid on demand; they are not extra execution arrows.

A task normally has one continuation. More than one normal continuation requires an explicit gateway. Exceptional exits use boundary markers and cannot masquerade as ordinary success. A failed or budget-exhausted agent never silently takes the success path.

An exclusive decision evaluates typed predicates without a model call. Predicates must select at most one branch; overlapping matches cause a visible configuration/runtime failure rather than relying on canvas order. A configured default handles no-match. Invalid or missing decision facts follow the declared error path. Tests exercise each route, default and invalid input.

A parallel split creates branch-local scopes; its paired join waits for the declared branch set for that activation. Outputs merge explicitly, with conflicts rejected unless a configured reducer resolves them. Failure policy states whether unfinished branches are cancelled or allowed to finish. There are no implicit shared-variable writes between branches.

A single end node completes its own path. Process success is emitted only when required branches and joins complete. Early global termination must be a separate, explicit policy. The compiler rejects ambiguous branch completion.

Repeat and For each are explicit bounded subprocess/control structures, with condition or collection, maximum iterations and timeout. Freehand back-edges do not create executable loops. Arbitrary cycles, inclusive/event-based gateways, non-interrupting boundary events and compensation are deferred until their semantics and adapters exist.

Lanes organize responsibility within the process. Do not draw a sequence arrow into another process to imply communication. A later collaboration view may use separate participant pools and message flows; until then, represent a cross-process handoff as an explicit send/wait or referenced subprocess.

## 4. Example process

A lending application demonstrates the representation without prescribing a lending policy:

1. Application received: validate the declared input.
2. Agent activity, Assemble application evidence: gather authorized records and produce an evidence-backed application summary.
3. Decision, Evidence complete?: evaluate a boolean produced by the activity.
4. Missing evidence: Human task, Request missing information, followed by a correlated response wait. Re-enter the evidence activity through a bounded revision subprocess. A deadline routes to escalation or a named end outcome.
5. Complete evidence: parallel System task, Obtain policy checks, and Agent activity, Prepare review recommendation.
6. Join: merge check results and the recommendation explicitly.
7. Human task, Review application: an authorized reviewer chooses an allowed outcome. The agent recommendation does not itself grant decision authority.
8. Decision, Reviewer outcome: route to System task, Record approved application, or Record declined application.
9. End with the recorded outcome.

Agent activities sit between ordinary business activities and remain part of the same process. A single agent may perform several activities with different goals and permissions. A role lane such as Operations may contain both human and agent work; agents do not all belong in a mandatory global AI lane.

## 5. Agent activity contract

The compact card shows the business action, agent identity/reference, result type and whether it needs configuration. Selecting it opens the existing Input / Process / Output configuration pattern, with Help last.

| Configuration area | Content                                                                                                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Input              | Explicit process fields, prior task outputs, pinned ontology/source references and authorized retrieval capabilities. Context references do not grant access by themselves.                                                                |
| Process            | Goal, completion criteria, pinned agent definition, MiniMax connection, permitted published tool revisions, tool effect policy, execution principal, maximum turns/tool calls, deadline and escalation rules. Secrets stay in Connections. |
| Output             | JSON-schema-compatible result, evidence references, declared business outcomes and validation rules. Reasoning prose cannot substitute for structured routing facts.                                                                       |
| Help               | Source provenance, capability explanation and example inputs/outputs.                                                                                                                                                                      |

Keep business outcomes separate from lifecycle states. An activity may complete successfully with an outcome such as needs_information. failed, cancelled, timed_out, budget_exhausted and uncertain describe execution failures/control states, not successful business answers. Each exposed state has a declared handling policy.

An agent can request a human response through the durable harness. Show the activity as Waiting for response and render the trusted generative form. If a handoff is known when designing the process, model a visible human task; reserve in-activity questions for bounded clarification. Questions must not become invisible approval bypasses.

Expanding a designed agent activity shows its contract, available tools, constraints and checkpoints. It must not invent a fixed tool sequence for a dynamic agent. In a run, expansion shows the actual model/tool/request tree, public progress, tool inputs/outputs according to permission, budgets and validation results. Private chain-of-thought is not displayed.

A single model response is an atomic operation. The agent activity is a resumable child execution containing model calls, tools, questions and checkpoints. It reuses the owned Stack Proc lifecycle port, MiniMax boundary and DBOS receipts. No second agent runtime or whole-loop-in-one-step wrapper is introduced.

An invocation-specific activity context must be separate from the ambient workspace agent's design conversation. Work-item, process-run and activity-invocation IDs correlate the two without sharing mutable context or permissions implicitly. The workspace agent may propose process edits; it cannot rewrite a running instance's pinned definition.

## 6. Composer interaction

Open process records in a fullscreen composer using the same shared frame, canvas grid, zoom/pan, selection, keyboard commands and configuration dialog foundations as the workflow and ontology editors. This replaces the long form as the primary view.

The compact header contains process name/revision/status and Save, Review, Publish, Compile workflow and Back. Process settings contain purpose, typed input/output contracts, default input, ontology references and roles. Configuration forms live in dialogs, not a permanent form beside every node.

A small palette inserts events, tasks and supported control structures. Inserting on an edge splits the edge and preserves its route meaning where valid. Deleting connected work previews affected routes and mappings. Lane moves update visual placement only; changing owner or performer is an explicit configuration edit, not a side effect of dragging.

Design shows the business graph. Implementation inspection links each activity to generated workflow nodes or unresolved bindings. These are related views with distinct edits: an implementation inspection does not silently rewrite process intent. Runs overlays instance status and lets the user drill into a task or agent run tree. Layout positions remain stable when activity updates arrive.

The ambient workspace agent can propose nodes, routes and bindings from documents. Proposed additions/removals appear as a reviewable diagram diff with evidence. Applying requires an authorized user, expected revision and content hash. Manual and assisted edits use the same schema and validation.

## 7. Semantic model and persistence

Introduce Process schemaVersion 2 with separate semantic graph and presentation data:

- Process metadata: purpose, input/output contracts, defaults, pinned ontology refs and unresolved questions.
- Elements: stable ID, type, label, description, evidence, optional lane and nested scope ID.
- Activity definition: business intent, input/output schemas, named outcomes, owner policy and execution binding.
- Execution binding: unresolved requirement, registered operation revision, human task definition, agent definition revision, or subprocess revision.
- Flow: stable ID, source/target, kind, label, predicate or outcome reference, and default marker.
- Structured controls: paired fork/join IDs and bounded repetition/subprocess definitions.
- Roles: business ownership labels plus separate runtime identity/assignment policy references.
- Presentation: positions, dimensions, lane order, edge waypoints and viewport. Geometry does not determine execution order, permissions or scope.

Store versioned process content through the existing artifact/revision service. Keep immutable reviewed/published revisions, edit-version conflict checks, provenance and audit. Distinguish semantic changes from layout-only edits so moving a node does not silently invalidate execution bindings; preserve both in artifact history. Compilation manifests include a semantic hash and exact source revision, independently of layout.

Drafts may contain unresolved work, dangling proposal fragments and validation issues. A draft must not be made executable by dropping unsupported elements. Readiness is derived per element: Intent only, Binding required, Configuration required or Ready. Whole-process review/publication and compile readiness are separate checks.

## 8. Compilation and drift

Keep one trusted execution path: Process v2 -> validation and capability resolution -> authoring graph -> existing authoring compiler -> DBOS-backed runtime.

Compilation has two explicit deliverables: an implementation preview that preserves unresolved requirements with diagnostics, and an executable candidate that must pass complete capability, policy, schema and graph validation. An unresolved candidate cannot be published for execution. A failed compiler never substitutes a no-op for a task.

The manifest maps each process element and route to all generated node/edge/scope IDs; also records source revision, semantic hash, compiler version, ontology refs, operation/tool/agent revisions and policy bindings. These mappings support process-level run overlays and change impact reviews.

Generation does not mutate an already published workflow. New process changes produce a candidate revision and reviewable diff. Running instances remain pinned to their original process, implementation, agent/tool and policy versions.

Generated implementations remain linked to their source. Workflow-specific customization must be represented as a versioned binding override or an explicit independent fork. There is no automatic arbitrary workflow-to-process reverse compiler. Regeneration reports conflicts and preserves existing independent workflows.

DBOS provides durable workflow execution and messaging/waits. Stack Proc still owns task authorization, response correlation, tool-effect safety, idempotency policy and uncertain-outcome handling. DBOS durability must not be described as exactly-once external side effects.

## 9. Current implementation and required changes

Current code grounds the migration:

- `lib/knowledge/process.ts`: schemaVersion 1 has an ordered steps array with construct, return and unresolved requirement variants. It cannot represent the proposed process graph.
- `lib/intelligence/generation.ts`: linear-process@1 emits a trigger, sequential constructs/return and a one-to-one step mapping. It rejects unresolved requirements. It is not a BPMN or agent-process compiler.
- `components/knowledge/editors.tsx`: current ProcessEditor is a form; the recent work-area section tabs are an interim presentation.
- `components/flows/flow-builder.tsx` and the authoring compiler supply reusable canvas/editing and typed graph foundations. Separate these foundations from workflow-only bindings instead of cloning another editor.
- `server/workspace-harness/query.ts` and `server/agent/workspace-runtime.ts` supply the owned agent lifecycle and durable host. A pinned process-activity invocation adapter, cancellation propagation and run correlation are required; source presence is not evidence that this adapter exists.

Migrate v1 records in memory for preview: synthesize Start, preserve step IDs/order and parameter expressions, represent construct as a system/data task, return as an End with its output mapping, and requirement as an unresolved task. Preserve existing `$input.variables` paths through an explicit compatibility input adapter. Do not rename data roots silently. Persist v2 only on an explicit save; retain the prior revision and generator for pinned legacy workflows. Output mappings and defaults must pass fixture equivalence tests before migration is enabled.

## 10. Delivery and acceptance

1. Visual semantic foundation: v2 schema, v1 preview migration, shared canvas, Start/Task/End, settings and node dialogs, evidence, lanes as ownership metadata, undo/redo and save/review lifecycle. This first slice retains existing linear execution and displays unsupported bindings honestly.
2. Structured process execution: exclusive decisions, paired parallel controls, explicit joins/merges, bounded subprocesses, human tasks and message/timer waits. Enable each element for execution only after its compiler and recovery fixtures pass.
3. Agent activities: versioned definition binding, durable child invocation through the existing harness, typed outcome routing, tool policies, trusted questions, budgets, deadlines, cancellation, uncertain outcomes and run-tree drilldown.
4. Assisted design and implementation lifecycle: document proposals, diagram diffs, compile impact review, linked generation/fork behavior and process-run overlays. Full BPMN import/export remains a separate decision.

Acceptance requires that a user can draw a process with a human task, system task and agent activity; explain every outgoing route; configure typed inputs/outputs; inspect source evidence; and trace an instance across its compiled workflow and agent work. Agent support is complete only when that round trip executes and recovers, not when a card can be drawn.

Required fixtures cover v1 equivalence, rename-stable references, invalid branches, default selection, parallel activation/join rules, explicit merges, nested scope validation, loop bounds, duplicate/late/unauthorized human responses, timeout races, model/tool resume, uncertain side effects, agent budget exhaustion, parent cancellation and cross-workspace denial. Visual checks cover square controls, thin borders, readable labels, lane navigation, collapsed/expanded activity views, reachable dialog actions and unsaved navigation.

## Sources

The notation is informed by the [OMG BPMN 2.0.2 specification](https://www.omg.org/spec/BPMN/2.0.2/PDF), particularly activities/subprocesses, sequence/message flows, gateways and lanes. Agent activity contracts and the restricted execution subset above are Stack Proc proposals, not BPMN-defined agent semantics.

Durable execution mappings are informed by [DBOS workflows](https://docs.dbos.dev/typescript/tutorials/workflow-tutorial) and [workflow communication](https://docs.dbos.dev/typescript/tutorials/workflow-communication). Exact adapters must target the installed repository runtime and its tested contracts.
