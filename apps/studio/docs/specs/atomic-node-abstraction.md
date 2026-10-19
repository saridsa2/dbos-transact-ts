# Stack Proc atomic node abstraction over DBOS

Status: specification for review, 2026-10-18. Records the agreed direction: Stack Proc owns the authoring abstraction; atomicity defines operation nodes; the node dialog uses fixed vertical Input / Process / Output tabs with node-defined horizontal tabs. Detailed contracts, catalog entries and delivery phases below are proposed. This document does not claim implementation or authorize changing the UI.

## 1. Purpose and authority

Users build workflows from understandable operations and explicit graph structures. They configure what an operation receives, what it does, and what it produces. They do not configure DBOS operation JSON.

Stack Proc owns node definitions, typed data, expressions, graph semantics, forms, validation and execution policy. A compiler and trusted execution adapters translate those definitions into DBOS steps, datasource transactions, durable waits, messages and child workflow calls. DBOS owns the underlying durable execution and checkpoint mechanisms.

This specification takes precedence over conflicting node taxonomy and layout proposals in [workflow authoring](workflow-authoring.md), [node editor interactions](node-editor-interactions.md) and the earlier [DBOS node model](../dbos-node-model.md). Existing implementation details remain compatibility constraints, not product design authority. Scoped values, explicit iteration and separate code capability profiles remain applicable.

Customer identity, federation, onboarding, connection lifecycle, credential exchange and run auditing remain control-plane responsibilities. Connections are referenced by nodes; credentials are never node fields.

## 2. What counts as an atomic node

An operation node has one responsibility, a declared input contract, a defined behavior and a declared output/outcome contract. It represents one invocation of that operation, without concealing an independently configurable workflow.

Atomicity is judged at the public operation boundary. A provider may implement one API operation internally with many instructions. A database transaction may execute several statements as one transactional operation. Neither requires exposing those instructions as separate canvas nodes.

An offering fails the atomicity test if it packages multiple independently configurable business operations, hides model/tool reasoning cycles, or embeds graph-level repetition, branching or compensation. Research, document ingestion, checkout and human approval are workflow compositions. An AI model response is an operation; an agent repeatedly choosing and invoking tools is a workflow.

A generic code node is an explicit escape hatch. It has one input/output invocation and an execution profile. Local computation over arrays is permitted, but code must not become an undocumented orchestration engine: durable child starts, waits, provider calls and workflow-state mutation require explicit supported capabilities and boundaries.

Atomic operation does not mean instantaneous execution, one attempt, or exactly-once external effect. A receive operation can durably wait. An operation may retry according to policy. Only a compatible datasource transaction gives the database transaction/checkpoint guarantee described by DBOS.

## 3. Separate the authoring elements

| Element             | Responsibility                                                     | Examples                                                                          |
| ------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Operation node      | Perform one operation                                              | Generate response, query records, construct data, receive message                 |
| Control structure   | Organize graph execution                                           | Conditional routes, For each, Repeat until, parallel branches, error paths, joins |
| Workflow definition | Compose nodes and control structures with an input/output contract | Research, document ingestion, approval, checkout                                  |
| Invocation          | Start a workflow with policy                                       | Manual/API/webhook/scheduled start, queued or debounced submission                |
| Resource            | Supply reusable execution configuration                            | Connections, queues, code profiles, artifact stores                               |

Control structures may have canvas handles and configuration dialogs. That presentation does not make them atomic operations or expose them as agent tools. They declare nested graphs, scope boundaries and completion behavior separately from operation definitions.

A condition evaluator is atomic: it produces a decision. Conditional routing is graph behavior that consumes that decision. A data merge combines selected values; a join coordinates completion. They must not be conflated.

Starting a named workflow is one invocation operation; the target remains an explicit, inspectable workflow definition. It is never relabelled as an atomic Research operation.

## 4. DBOS-backed operation catalog

Names are product proposals. DBOS mappings describe the execution foundation, not UI field names.

| Offering                     | Responsibility                              | Essential configuration                         | Result/outcomes                    | DBOS mapping                           |
| ---------------------------- | ------------------------------------------- | ----------------------------------------------- | ---------------------------------- | -------------------------------------- |
| Execute registered operation | Invoke one installed operation              | Versioned operation and permitted policy        | Declared result or error           | Registered step / runStep              |
| Database transaction         | Perform one defined transactional operation | Datasource reference and registered transaction | Declared committed result or error | Datasource transaction                 |
| Delay                        | Pause this execution for a duration         | Duration                                        | Completed or cancelled             | sleep                                  |
| Send message                 | Send one message to a workflow/topic        | Destination, topic, message, idempotency policy | Sent acknowledgement or error      | send                                   |
| Receive message              | Consume the next message on a topic         | Topic and timeout/deadline                      | Received message or timeout        | recv                                   |
| Publish event                | Set/update a named event on this workflow   | Event name and value                            | Published acknowledgement          | setEvent                               |
| Read event                   | Read/wait for a named workflow event        | Workflow reference, event name, timeout         | Value or timeout                   | getEvent                               |
| Start workflow               | Start one referenced workflow execution     | Workflow revision, input, invocation policy     | Execution reference                | startWorkflow / compatible enqueue API |
| Get workflow result          | Await one execution and retrieve its result | Execution reference                             | Result or execution failure        | WorkflowHandle.getResult               |
| Wait for executions          | Await completion of selected executions     | References and all/first policy                 | Completed reference(s)             | waitAll / waitFirst                    |
| Append stream value          | Append one value to a named stream          | Stream name and value                           | Acknowledgement                    | writeStream                            |
| Read stream value            | Read one value at a specified offset        | Workflow reference, stream, offset, timeout     | Value or typed failure             | readStreamOffset, when supported       |
| Close stream                 | Finish a named stream                       | Stream name                                     | Acknowledgement                    | closeStream                            |
| Current time                 | Produce a replay-stable timestamp           | Output representation                           | Timestamp                          | now                                    |
| Generate ID                  | Produce a replay-stable identifier          | Supported identifier format                     | Identifier                         | randomUUID                             |

Availability is checked against the installed SDK and adapters. Current online documentation is not proof a local version supports a capability. Unsupported offerings remain unavailable with a reason.

DBOS waitAll returns completed handles, not result values, and does not itself throw because a child failed. Result retrieval is a separate operation. UI labels and adapter tests must preserve this distinction.

Messages and events are distinct: messages are consumed from per-topic queues; events expose an updatable named value. Stream append/read/close are also distinct operations. Iterating an entire stream is a graph structure around reads.

The adapter must translate DBOS timeout/null behavior into an unambiguous Stack Proc outcome. It must not confuse a valid nullable payload with a timeout; the serialization/envelope contract must establish that distinction before making the offering executable.

## 5. Stack Proc data and terminal operations

| Offering           | Responsibility                                    | Boundary                                                                     |
| ------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------- |
| Construct data     | Build one value from configured fields/references | Deterministic evaluation; no variable mutation                               |
| Transform data     | Apply one named transformation                    | Explicit schema and transform version; no hidden iteration of workflow nodes |
| Execute code       | Execute one program invocation                    | Pinned runner/profile/source revision and limits                             |
| Evaluate condition | Evaluate a predicate                              | Decision result consumed by graph routing                                    |
| Validate data      | Validate one value against a contract             | Valid result or structured validation issues                                 |
| Set variable       | Assign a declared writable variable               | Atomic validated update within the current scope                             |
| Combine data       | Construct one result from named sources           | No implicit waiting or branch-state merging                                  |
| Return result      | Complete the current workflow with a value        | Explicit terminal graph behavior                                             |
| Raise error        | Fail the current scope with a defined error       | Explicit error routing/propagation                                           |

These are authoring semantics supplied by Stack Proc, not claims of corresponding DBOS APIs. Pure deterministic operations may be replayed by the interpreter. Nondeterministic or effectful work needs an appropriate durable boundary. The execution plan declares which applies.

Existing multi-variable assignments can remain compatible as a versioned atomic assignment group; all updates validate before any commit. New catalog naming must make the group behavior explicit.

## 6. Integration offerings

A provider publishes versioned atomic operations, not a single opaque provider node with arbitrary operation JSON. Examples include HTTP Send request, model Generate response, embeddings Create embeddings, storage Get object, storage Put object and database Query records.

Each offering defines its own fields, connection compatibility, effect classification and result. Provider identity can group offerings in the palette without determining their execution semantics.

Vercel AI, CrewAI and other frameworks require per-offering classification. A single generation call can be a step-backed operation. An agent with internal model/tool loops, delegation or checkpoints is a workflow adapter with visible execution structure or explicitly inspectable child workflow semantics. Framework branding does not establish atomicity.

Pagination must be explicit. Get one page is atomic. Fetch every page is a composition unless the provider itself exposes a bounded single-operation result. Likewise Copy one object is atomic; Mirror a bucket is a workflow.

## 7. Versioned definition contract

The following is a logical contract, not a proposed persistence format or direct replacement for current TypeScript interfaces.

| Definition facet | Required content                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| Identity         | Stable offering ID, immutable version, display name, category and description                                      |
| Classification   | Operation/control/workflow invocation; durable boundary; effect classification                                     |
| Input            | Named typed ports/fields, requiredness, cardinality, constraints and supported value sources                       |
| Process          | Behavior-specific configuration schema, defaults and immutable operation identity                                  |
| Output           | Named typed results, presence/cardinality and declared success/timeout/error outcomes                              |
| Editor           | Input/Process/Output sections, optional horizontal tab descriptors, field/control definitions and visibility rules |
| Execution        | Trusted adapter ID/version, retry/timeout/cancellation capabilities and idempotency semantics                      |
| Resources        | Required connection/provider/profile capabilities and authorization requirements                                   |
| Testing          | Preview/test support, required concrete inputs and whether testing performs an external effect                     |

A configured node instance stores its stable node ID, display name, offering/version reference, authored bindings, process configuration, resource references and permitted output mappings. It stores no resolved credentials, captured execution data or executable adapter implementation.

A compiled execution snapshot pins the workflow revision, offering/adapter versions, expression semantics, code revision, resource revisions and effective execution policy. Authority comes from the authenticated server context and trusted registry, never from graph-supplied tenant or installation flags.

## 8. Dialog contract: Input / Process / Output

The dialog configures one operation. The fixed configuration tabs are Input, Process and Output, in that order, followed by Help and Test & results in the same vertical navigation. Only the selected section occupies the main workspace. There is no permanent three-pane data browser.

The node definition supplies horizontal tabs within each section where needed. The shell owns navigation, header, validation indicators, spacing, bounded scrolling and footer actions. Providers supply schema-driven content and approved custom controls, not replacement dialog shells. A section with one content group needs no horizontal tab bar.

| Section | Question                                 | Contains                                                                                             | Excludes                                               |
| ------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Input   | What data does this operation receive?   | Input fields, fixed values, workflow-data references, expressions and input validation               | A permanent browser of every accessible workflow value |
| Process | What single operation should it perform? | Operation-specific behavior, code, predicates, connection selection and supported execution settings | Embedded business workflows or generic DBOS JSON       |
| Output  | What does this operation make available? | Declared results/outcomes, permitted result shaping and explicit variable assignments                | An unlabeled previous execution result                 |

Not every setting is a data input. A message payload belongs to Input; topic and receive timeout configure behavior under Process. A model prompt/messages are Input; model choice, connection and generation settings are Process. Each offering must document field ownership so fields are not duplicated across sections.

Output contracts are normally supplied by the offering. Ordinary users do not repeatedly author schemas or choose string/object/array types for known fields. Construct data and custom Code are explicit exceptions where defining a result shape may be part of the task. Output assignment must not silently mutate variables; it is an explicit configured assignment with validated scope semantics, equivalent to a visible Set variable operation in the execution plan.

Fixed/Expression behavior is available at data fields. Choosing Use workflow data opens a contextual selector for that destination, showing compatible workflow inputs, variables and upstream results. Source names use user-facing labels. Technical IDs, raw paths and schema internals are secondary details. No example data is required to configure a valid reference; declared contracts support authoring before a run.

Objects and arrays use compact, task-specific controls. A known list of text tags is edited as text rows with add/reorder/remove actions, not nested generic type selectors and repeated full paths. Freeform object/schema authoring is a deliberate task, not the default experience for every node.

Execution inspection lives in the Test & results tab, with separately labelled Test results and Run results. It shows actual resolved inputs, output, logs, provenance and invocation identity. The permanent Output navigation label always means the configured output contract. Optional examples belong to deliberate testing, not a prerequisite Sample input selector on the configuration screen.

Empty sections remain understandable: for example Delay can say No data input required. Do not invent fields or horizontal tabs merely to fill the layout. Initial selection opens the first required incomplete section, or Process when already configured; navigation order stays fixed.

## 9. Representative dialog mappings

| Offering            | Input                                            | Process                                      | Output                                            |
| ------------------- | ------------------------------------------------ | -------------------------------------------- | ------------------------------------------------- |
| Construct data      | Values/references used in construction           | Structured construction rules                | Produced shape; optional named assignment         |
| Execute code        | Mapped program input                             | Editor, execution profile, limits            | Return contract                                   |
| Generate response   | Messages and contextual data                     | Connection, model, generation options        | Response contract and optional extraction/mapping |
| Query records       | Query parameters                                 | Connection and supported query definition    | Rows/result contract                              |
| Receive message     | None unless the offering declares data arguments | Topic, deadline/timeout                      | Received message and timeout outcome              |
| Start workflow      | Child input fields                               | Target workflow/revision and dispatch policy | Execution reference                               |
| Get workflow result | Execution reference                              | Supported waiting policy                     | Child result or failure                           |

These are operation examples, not universal horizontal tab names. Walkthrough review must settle exact field ownership before UI implementation. Control structures use a related shell with graph/scope-specific configuration; they do not have to pretend to satisfy the atomic operation contract.

## 10. Compilation and execution

1. Load the immutable offering definition from the trusted registry and check availability.
2. Validate graph structure, references, scopes, versions and authored configuration. Preserve incomplete drafts with precise diagnostics; prevent invalid execution.
3. Compile fixed values and references without requiring example values. Preserve the authored representation separately from the execution plan.
4. Pin the workflow plan and effective policies for an execution. Resolve caller/workspace authority on the server.
5. At each invocation, resolve bindings in its actual branch/iteration scope and validate concrete input. Absence, null and empty values remain distinct.
6. Resolve authorized connection capabilities at the worker boundary. Temporary credentials and secrets never enter durable input/output or browser configuration.
7. Dispatch through the declared boundary. Do not wrap DBOS waits or child orchestration inside an ordinary step; preserve their native durable semantics.
8. Validate and bound the result, record the outcome and expose it to downstream references. Publish redacted execution updates through the existing server event path.

Retries are policy, not repeated canvas nodes. Provider operations need a stable invocation identity across attempts/recovery and documented idempotency or reconciliation behavior. DBOS checkpoints do not establish exactly-once effects at an arbitrary remote API. Cancellation is cooperative where required; adapters must report cancellation/uncertain outcomes truthfully.

Control compilation preserves deterministic durable-call ordering. For parallel sequences, child workflows provide separate durable histories; an arbitrary interleaving of multiple step sequences in one history is not acceptable. Errors, timeouts and skipped paths must have explicit downstream presence semantics.

## 11. Composition checks against our reference examples

| Example              | Atomic operations                                                                   | Explicit composition/control                                     |
| -------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Document ingestion   | Parse one document, index one page, aggregate totals, publish event                 | Iterate documents/pages, queue work, wait for results            |
| Research             | Search, call model, transform findings, evaluate condition                          | Repetition, accumulated state, termination, final synthesis      |
| Checkout             | Reserve inventory transaction, create order, send request/message, receive response | Paid/failed/timeout routes and compensation                      |
| Human approval       | Deliver review request, receive response, evaluate decision                         | Approve/reject/timeout routes                                    |
| S3 mirror            | List one page, check one object, copy one object                                    | Pagination, filtering, bounded concurrency and result collection |
| Transaction Director | Check one client, decommission, start machine, run startup action, register client  | Filtering, iteration and replacement child workflow              |

No Research loop, Document processor, Human approval or Mirror bucket offering is classified as an atomic operation merely because it can be packaged behind one function. These can be workflow templates with inspectable definitions.

## 12. Compatibility and delivery

Do not rename persisted node kinds or change registered workflow semantics in place. Inventory existing offerings and classify each as operation, control structure, invocation or composition. Define migrations/version adapters for existing graphs and retain read-only interpretation of historic runs. Existing fixtures are evidence to evaluate, not proof that a former classification is correct.

Proposed sequence:

1. Review taxonomy and field ownership against Construct data, Code, Receive message, Start workflow and one provider action.
2. Specify shared definition/adapter contracts and classify the current palette; document compatibility requirements.
3. Review static interaction walkthroughs of the vertical layout, including a simple nested value, without executing anything.
4. Implement a complete local slice with meaningful configuration and execution/recovery verification.
5. Add provider operations and workflow templates using the same definitions, retaining the distinction between operations and compositions.

No UI/runtime changes are part of this documentation task.

## 13. Acceptance criteria

- Every operation offering passes the one-responsibility test and declares input, behavior, output/outcomes and execution boundary.
- Research and other compositions remain inspectable graphs; control structures preserve explicit scope and iteration.
- A user can configure a node before any workflow run or example-data entry.
- Known schema fields render useful controls without requiring repeated type/schema editing.
- Input / Process / Output navigation is stable; node-defined horizontal tabs preserve the shared shell.
- Every configuration field has one documented home, with no duplicated competing value.
- Error markers identify the actual field and owning horizontal/vertical tabs; navigating an issue reveals and focuses it.
- Draft editing, Apply, workflow Save and actual execution remain distinguishable. Opening configuration performs no operation.
- Recorded results and standalone tests are identifiable and never become configuration implicitly.
- Adapter tests prove resolved-input validation, actual policy enforcement, declared outcomes, tenant authorization and replay/recovery behavior.
- Compatibility checks cover existing saved graphs and historic execution snapshots before replacing current behavior.

## 14. Research references

DBOS facts above are grounded in official TypeScript documentation reviewed on 2026-10-18. Node names, classification and editor contracts are Stack Proc design decisions.

- [Steps](https://docs.dbos.dev/typescript/tutorials/step-tutorial): checkpointed function calls and external/nondeterministic operations.
- [Workflows and steps reference](https://docs.dbos.dev/typescript/reference/workflows-steps): registration and retry/timeout configuration.
- [Transactions and datasources](https://docs.dbos.dev/typescript/tutorials/transaction-tutorial): database changes and checkpoint committed together.
- [DBOS methods and workflow handles](https://docs.dbos.dev/typescript/reference/methods): waits, messaging, events, streams, time, identifiers and result retrieval.
- [Workflow execution](https://docs.dbos.dev/typescript/tutorials/workflow-tutorial): durable sleep, deterministic execution, child workflows and debouncing.
- [Queues and concurrency](https://docs.dbos.dev/typescript/tutorials/queue-tutorial): dispatch and flow-control configuration.
- [Scheduling](https://docs.dbos.dev/typescript/tutorials/scheduled-workflows): workflow invocation schedules.
- [Local example reference catalog](../example-reference-catalog.md): source-reviewed examples and the limits of our local fixtures.

## 15. Contextual assistance requirement

Each node must expose Help as a permanent tab and support a contextual AI guide. Test & results is also a permanent vertical tab; the header contains the node identity and close action. Help explains that offering’s purpose, Input / Process / Output configuration, common mistakes and relevant documentation. Reading Help must preserve the staged draft and must not execute the node.

The AI guide is a separate assistance capability, not a workflow operation or automatic configuration mutation. Its provider connection is an explicit workspace choice. It must not be represented as available model assistance when no executable provider is configured. The detailed guide interaction and execution contract remain to be completed with that connection decision.

## 16. Initial implementation coverage

The current implementation introduces `lib/authoring/editor-contract.ts` as a presentation adapter over existing saved node definitions. It gives the shell fixed Input / Process / Output sections, node-specific horizontal pages and field/diagnostic ownership. The canvas palette separates operation nodes, control structures, workflow invocation and entry points; legacy Human review is retained for existing graphs and omitted from new scoped palettes. The existing Merge remains classified as a control because it coordinates incoming paths as well as mapping data.

The dialog now uses contextual workflow-data selection instead of a permanent left pane. Code input/output contracts are explicit pages. Ordinary operation configuration does not expose the former general-purpose schema editor. Constructed result shapes can be browsed without running the workflow. Run inspection and standalone tests live in the permanent Test & results tab. Contextual Help is a permanent tab for each existing node kind, with a fallback for installed legacy definitions. The Add node catalogue is a searchable grouped list. The bottom canvas bar, valid-node Configured badges and empty/repeated node previews are removed; Auto-arrange and Workflow help are in Workflow actions. Debounced submission is not exposed in the canvas toolbar. Workflow settings replaces the ambiguous Resources label; All runs opens workspace run history in a separate tab beside Run, preserving the editor draft. Selection/deletion have keyboard support, and zoom/recenter remain on the right. A selected node exposes Settings (gear) and Delete in one toolbar above its card. The canvas uses the application Geist font; source and expression editors retain monospace.

This slice preserves saved operation kinds and DBOS execution semantics. It does not implement every proposed catalog entry: additional stream/time/identifier operations, split Start/Get-result offerings, provider-specific operation forms, an authorable workflow-input contract, and complete versioned offering/adapter unification remain subsequent work. Existing receive/event timeout-null semantics are described truthfully rather than silently changed. Workflow-input shape hints currently come from configured defaults; unknown upstream shapes remain whole-value references. The AI guide awaits the workspace provider/credential decision and is not claimed as implemented.

Verification for this slice: 81 unit tests and 34 isolated integration tests passed, including existing crash/recovery scenarios. Browser checks exercised vertical navigation, Code contract ownership, contextual mapping/replacement, a real pure-Code test returning `[1, 2, 3]`, validation routing, Help and palette classification. Temporary verification edits were discarded; the original user draft was preserved in its existing tab. Production build and final TypeScript checks passed.

## 17. Test and execution inspection

The permanent vertical navigation is Input, Process, Output, Test & results, Help. Help is always last. Recorded executions open on Test & results, with Result selected. Its horizontal tabs are Result, Input, Logs and Details. Input shows captured resolved input only; missing historical captures are reported as unavailable rather than reconstructed. Start time and elapsed time are shown only when the invocation events support them. Internal run/scope IDs and revision hashes belong in Details.

Editable workflows use Test setup, Result and Logs. Setup owns test data and preview/test actions. A standalone code test selects Result when complete; configuration or test-data changes mark the result stale. Recorded workflow output is not presented as the result of a standalone test.

Primitive outputs and primitive arrays are compact. Structured values offer Tree and JSON; arrays of objects with at most 20 columns also offer Table. Copy value copies the actual JSON value, never a workflow expression. Logs preserve the recorded line order without invented timestamps. Empty, absent, null and uncaptured outputs remain distinguishable.
