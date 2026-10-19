# Stack Proc workflow authoring — agreed direction and contract proposal

> Design update, 2026-10-18: [Atomic node abstraction over DBOS](atomic-node-abstraction.md) takes precedence for node taxonomy and dialog layout. The earlier permanent three-pane layout below is superseded by fixed vertical Input / Process / Output navigation with node-defined horizontal tabs. Other behavior remains subject to that specification; this is not an implementation status claim.

Status: architectural direction agreed by the user on 2026-10-18. The accepted decisions are explicit values/collections with visible iteration, scoped variable updates with explicit merges, and separate code capability profiles. Detailed contracts and interaction designs remain proposed below; this agreement does not imply every earlier implementation choice or syntax has been approved. Existing code is a candidate implementation assessed in [the gap report](workflow-authoring-gap-assessment.md); it does not define the specification. See [existing implementation notes](workflow-authoring-implementation-notes.md) for the current state.

## 1. Product goal

A domain-independent visual workflow builder where users configure meaningful operations, map typed data between nodes, construct objects and arrays, and write custom code when a configured operation is insufficient. The experience should have the field-level Fixed/Expression behavior and data-mapping clarity requested from n8n.

Stack Proc owns the authoring language, node definitions, editor and data semantics. DBOS provides durable orchestration, checkpoints, recovery, queues and messaging underneath. The editor must not expose DBOS operation JSON as its primary model, and DBOS's ability to run registered functions does not itself provide a customer code-execution service.

This proposal covers the node editor, data model, variables, expressions, code nodes and compilation boundary. Customer onboarding, identity federation, credentials and connection management retain their separate control-plane specifications. Integration/framework nodes consume those services.

## 2. User journey that the design must support

A user builds a document pipeline:

1. A trigger supplies documents and processing options. Input has a named schema and editable sample data.
2. A Construct data node builds a processing request: a fixed collection name, an expression-derived document title, a nested metadata object and a tags array whose individual entries can be fixed or computed.
3. An explicit iteration node processes the document collection. The inner graph has an item and index scope.
4. A provider node selects an authorized Azure connection and a document-processing operation. Its form uses the operation's fields and compatible data mappings.
5. A Code node normalizes the returned content and returns a defined output shape.
6. A decision branches on confidence. A low-confidence branch waits for a human review; the other continues automatically. Their outputs converge through an explicit merge contract.
7. A final node returns structured results. Inspection shows which inputs, expressions, connection revision, code revision and outputs belong to the selected run.

The same authoring mechanics must support an order, research agent or support workflow without document-specific logic in the editor.

## 3. Shared node definition, saved node instance and execution snapshot

These are three distinct artifacts:

| Artifact                  | Responsibility                                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Versioned node definition | Offering identity, operations, ports, parameter schemas, editor metadata, capabilities, outcomes and execution boundary            |
| Saved node instance       | User-selected operation, parameter modes, mappings, connection references, code/configuration and presentation                     |
| Execution snapshot        | Validated and resolved plan with pinned definitions, code/runtime/dependency revisions, connection references and compiler version |

A definition must support core nodes, external integrations and framework offerings. Provider, framework, resource and operation are separate dimensions: Azure is a connection/provider family; Vercel AI is an execution framework; a generation operation may use a compatible model provider.

Each parameter definition declares a stable ID, name, description, value schema, requirement/default rules, sensitivity, supported modes, visibility dependencies, control type, validation and optional server-side option resolver. JSON Schema defines value validity; editor metadata defines presentation. A generic JSON Schema renderer alone is insufficient for credentials, dynamic choices, code, field mapping and resource selection.

Operation schemas must remain the shared contract for canvas execution and agent-tool dispatch. Saved versions remain interpretable; a changed meaning requires a version change or explicit migration.

## 4. Data flow and cardinality — agreed direction

Agreed direction: named typed ports carry either one JSON value or a collection. Iteration is explicit. A collection is not silently expanded into many provider calls. This preserves a visible execution and cost model while supporting nested arrays as ordinary data.

The editor takes inspiration from n8n's mapping experience. Execution uses explicit values and collections, without automatic per-item invocation or implicit item pairing. One normal node invocation consumes its configured input once. A For each scope makes repeated calls and their concurrency visible in the graph.

Under the agreed explicit contract:

- An edge connects an output port to an input port and may select an outcome.
- An array can remain one array value or be consumed by an explicit iteration operation.
- Iteration creates a scope with current item, index and parent input.
- A join explicitly defines which branches it waits for and how it combines results.
- Skipped, failed, waiting and completed-with-null are different states.
- A downstream expression cannot resolve a missing/skipped branch output by guessing another item or branch.
- Files and large binary results use authorized artifact references with metadata, rather than embedded base64 in ordinary JSON.

## 5. Fixed/Expression field model

Fixed/Expression is a property of a data parameter, independent of its value type. Supported value types include string, number, boolean, null, object and array, plus schema-backed enums, dates and artifact references where an operation requires them.

For an object or array, users choose one of two construction approaches:

- Structured Fixed value: edit named properties or ordered entries; each child independently supports Fixed/Expression.
- Expression value: compute the whole object or array; validate the resulting shape against the same schema.

A root Expression value does not simultaneously maintain competing child expressions. Switching modes preserves the previous draft in the editor and explicitly identifies which version will execute. Reordering array entries preserves their draft identity; renaming a property checks duplicates and required-schema rules.

Absent, null, empty string and empty collection retain different meanings. Optional fields can be omitted deliberately. Defaults, coercion and omission behavior are declared; numeric strings must not silently become numbers unless the operation's contract permits it.

Credentials, operation identity and execution-plan settings are not arbitrary data expressions. Dynamic resources and model selections need definition-specific rules: a resource may be selected by an expression when its adapter supports that capability, while the operation/version remains pinned.

## 6. Expression language and mapping

One expression contract must serve preview, validation and execution. Evaluation returns typed JSON values, not strings that happen to contain JSON.

Proposed scopes are workflow input, current node input, explicit upstream outputs, declared variables, iteration item/index and execution metadata. Their final names/syntax are a reviewed public contract. Node references use stable IDs underneath a readable label; renaming a node does not break mappings.

The editor offers field completion from schemas and recorded data, a path picker/copy action, inferred result type, and sample evaluation. It distinguishes a syntax error, type mismatch, unavailable runtime value and a redacted secret. A preview is tied to a particular input sample/run and does not imply the value will exist in every branch.

Whole-value expressions and text interpolation are separate modes of interpretation. A numeric field can receive an expression returning a number. A text template may combine fixed text and computed fragments; it must not turn object values into accidental strings. The initial release may omit interpolation if whole-value expressions are sufficient, but must say so in the UI.

Expressions are pure, bounded and side-effect-free. Arbitrary scripts, network access and provider calls belong to execution nodes. Required helper functions, optional access, missing-value handling and collection transforms must be specified and tested before selecting a parser. A constrained parser chosen during implementation is not automatically the product language.

## 7. Data construction and workflow variables

Construct data and workflow state solve different tasks. A Construct data node produces a typed output object/array for downstream mapping. It does not implicitly mutate global workflow state.

Agreed variable direction: declared workflow values with name, type/schema, initial value, scope and visibility. Initial values may reference workflow input. Updates occur through an explicit operation and become visible after that operation succeeds.

Scope rules must be deterministic:

- Workflow declarations are visible to descendant scopes unless deliberately shadowed.
- Iteration-local values belong to that iteration; concurrent iterations cannot overwrite each other's state.
- Child workflows receive explicit input and return explicit output; shared mutable variables are not implicit.
- Parallel branches receive a snapshot of inherited variables. Conflicting changes cannot resolve by wall-clock completion order. A merge node explicitly selects/combines branch results or rejects a conflict.
- Replay reconstructs the same state from the pinned plan and completed results.

Begin with Construct data plus scoped, explicit updates; unrestricted shared mutation is excluded. The current merge-into-one-object implementation must be replaced for the new authoring semantics, while preserving old captured executions.

## 8. Node configuration dialog

Open a dedicated large dialog from the canvas, retaining the selected node's context. Use official Untitled UI controls, the Stack Proc theme and existing icon system.

| Region               | Job                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| Header               | Node name/type, operation identity, dirty/read-only state and close action                                |
| Left input pane      | Selected node input, workflow/iteration scope, compatible upstream schema/data and mapping tools          |
| Center configuration | Node-specific parameter and configuration tabs                                                            |
| Right output pane    | Output schema, selected execution result, expression preview or explicit node-test result with provenance |
| Footer               | Validation summary/status and clearly scoped actions                                                      |

The left pane is a data-mapping workbench, not a dump of every prior result. Users choose sample or recorded data and see its run/time, node and item scope, schema, type and cardinality. Empty/unavailable data explains how to obtain a sample. Large objects/arrays are expandable and paged; useful actions insert a mapping into the active field, copy a path or inspect a value. Drag-to-map is optional convenience over the same mapping operation.

Tabs depend on node capabilities. Proposed common sections are Parameters, Settings and optional Credentials/Code/Schema sections. An HTTP request and a human review must not share irrelevant fields. DBOS retry/timeout settings belong in a consistent execution settings section. Raw JSON is an advanced import/inspection tool with validation and one-way synchronization rules, not a second conflicting source of truth.

Header/footer remain fixed; each data/configuration region scrolls internally. Compact viewports select one pane at a time without hiding actions.

## 9. Validation and editing lifecycle

Validation has three stages: authoring validity, resolved-input validity and runtime/provider validity. A field can be valid syntactically but unresolvable without upstream sample data; this is not the same error as invalid syntax.

Invalid fields show a red exclamation, highlighted control/group, associated message and tab marker. Error summaries identify the node/field and focus it. Nested errors identify the property/index. Errors clear as the relevant issue is corrected. Accessibility uses labels and associated error descriptions, not color alone.

Cancel discards all dialog edits. Apply updates the graph draft atomically. Proposed lifecycle: Workflow Save persists a structurally valid draft, including incomplete configuration with diagnostics. Run eligibility requires full semantic validation and runtime capability checks. Existing implementation's Done/Save behavior must be checked against this distinction.

Run inspection is immutable and clearly versioned. Editing a saved workflow must not modify the selected run's snapshot.

## 10. Testing semantics

Three actions have different effects:

| Action            | Effect                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| Preview parameter | Pure expression resolution against selected sample/context; no node execution                   |
| Test node         | Execute the selected node with a captured input/configuration and record a separate test result |
| Run workflow      | Execute a pinned workflow version through durable orchestration                                 |

If dependencies are missing, show them and offer a separate explicit Execute preceding nodes action where supported. Never silently run a chain of external mutations to populate a preview. Side-effecting node tests use the operation's declared capability and normal workspace authorization; a test label does not make a real write a dry run.

Test results identify configuration revision, source of input, start time, output, logs and errors. Changed configuration makes old results stale. Runtime provider errors map to field errors only when the adapter can identify the field reliably.

## 11. Code node — first-class execution offering

Support code now as a first-class definition, rather than embedding script strings inside unrelated operations. The initial proposed language set is JavaScript/TypeScript. The execution backend is behind an adapter and remains a design choice pending capability and deployment requirements.

The code editor needs syntax highlighting, completion for the input/context API, line diagnostics, output/schema inspection, logs and test execution. A plain textarea can be a temporary implementation, not the target experience.

Define the public API before selecting a runner: typed input, allowed read-only context, output shape, execution mode, error format, cancellation and supported dependencies. Whole-collection and per-item modes must follow the agreed data/cardinality contract. Returning a value must not silently mutate workflow variables.

Agreed direction: separate execution profiles. Proposed delivery order is pure transform first, followed by governed integration code:

1. Pure transform: local computation with bounded CPU/time/memory/output and no external capabilities.
2. Governed integration code: optional later profile with explicitly declared network destinations, supported dependencies and brokered connection capabilities. No ambient tenant credentials or host filesystem/process access.

Supporting arbitrary user code means running user-defined programs within an explicit capability profile. It does not mean unrestricted host execution. The current no-network runner is a candidate backend for the pure-transform profile only. Governed integration code needs a separate capability and deployment design; its availability must not be advertised until implemented. Approval of separate profiles does not authorize unrestricted network or credential access.

Saved execution snapshots pin source, language/runtime version, dependency lock, capability profile and policy. Tenant isolation, capacity admission, queueing, cancellation, logs/redaction, artifacts and runner availability are platform concerns. Numeric limits and a particular sandbox are implementation decisions to validate against this contract, not product requirements inferred from an existing library.

## 12. Compilation and durability boundary

The compiler validates the complete authored graph and produces an execution plan. The plan preserves node/port identity, schemas, expressions, state scopes and source locations for errors. It pins the compiler and offering versions. Authoring JSON remains available independently for editing and migrations.

At execution: construct scope, resolve parameters, validate their resolved shape, authorize connections/capabilities, dispatch the appropriate adapter, checkpoint the appropriate result, and emit redacted trace events.

Use DBOS boundaries according to semantics: pure/external operations as durable steps, datasource transactions through transaction adapters, and agents/child graphs through workflow boundaries. A whole agent run must not be hidden inside one step if its model/tool checkpoints require separate recovery.

Completed code/adapter results are reused on recovery. Incomplete operations can execute again. External effects need provider-backed idempotency or explicit reconciliation; DBOS does not make arbitrary side effects exactly once. A new executable definition must not change replay behavior of an existing captured version.

## 13. Acceptance scenarios

- An object containing fixed values, nested computed fields and an array survives Apply, Save, reload and execution without changing modes/types.
- Mapping a recorded property inserts a stable node/port/field reference; renaming the source node preserves the mapping.
- Missing data, null, empty values and omitted optional fields remain distinguishable.
- Collection execution count is predictable from the graph and node mode; there is no unexpected multiplication of provider calls.
- Parallel branches and iterations cannot produce timing-dependent variable updates.
- Invalid nested fields expose exact locations, visible markers and keyboard-accessible error navigation.
- Preview causes no external calls. A node test and a full workflow run show separate provenance and permissions.
- Code executes under its declared profile, reports useful diagnostics, obeys cancellation/limits and cannot obtain another workspace's capabilities.
- Recovery reuses completed results and preserves node/item identity. Old workflow versions remain runnable or receive an explicit migration requirement.
- HTTP, a model/framework operation and a document-processing operation use the same authoring contract with their own relevant forms.

## 14. Decision record and delivery order

| Decision  | Agreed direction                                        | Consequence                                                                 |
| --------- | ------------------------------------------------------- | --------------------------------------------------------------------------- |
| Data flow | Explicit typed values/collections and visible iteration | Normal nodes execute once; For each owns fan-out and collection             |
| State     | Construct data and scoped updates, explicit merges      | No shared mutable state across concurrent branches or iterations            |
| Code      | Separate capability profiles                            | Pure computation and governed external I/O are distinct execution offerings |

The exact expression/context API, node-test dependency behavior and draft/run validation lifecycle are specified as proposed v1 contracts in section 15. Editor interactions must be reviewed against those contracts before broad UI changes.

Delivery sequence: settle the detailed contracts with representative examples; review node-editor interaction designs; implement scope-aware authoring/runtime contracts; wire the editor and one complete local workflow; then extend provider/framework offerings. The [gap assessment](workflow-authoring-gap-assessment.md) identifies reusable code and changes. Passing existing tests does not establish conformance to the new semantics.

## 15. Proposed v1 contracts that make the direction executable

These details implement the agreed direction but are not claimed as separately approved syntax or UI designs.

### 15.1 Values, ports and presence

A port declares a stable ID, display name, direction, value schema, required/optional presence, and single-value or collection cardinality. A collection port's schema describes the array and item type. An array nested inside a single object remains ordinary data.

An outcome (success, error, true, false, timeout) controls eligibility; it is not a data port. Geometric canvas handles are presentation, independent of semantic port IDs. Edges retain both port identity and outcome routing where applicable.

A resolved value records present/absent separately from its JSON payload; null is present. Missing required input fails resolved-input validation. Missing optional input is omitted. Skipped nodes do not produce an invented null result. Unknown sample values remain unresolved and never silently satisfy validation.

### 15.2 Explicit node set

| Offering             | Contract                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Construct data       | Builds one typed value; nested children support Fixed/Expression; produces output without mutating variables                                    |
| Set variables        | Updates declared writable values in the current scope after success; rejects unknown names and schema mismatches                                |
| For each             | Explicit collection input, child graph, concurrency/max-items policy and ordered collected output; empty collection returns an empty collection |
| Parallel             | Named branches with explicit inputs and isolated scopes; returns named branch results                                                           |
| Merge                | Explicit source selection/mapping; produces one downstream result and optionally explicit parent-scope variable updates                         |
| Code: pure transform | One invocation with one JSON input; may transform an entire array locally; repeated workflow invocations use For each                           |
| Call workflow        | Explicit input/output boundary; child cannot update parent variables directly                                                                   |

The current Code-node each-item switch is not the target public execution model. Existing saved behavior needs a compatibility path or explicit conversion; newly authored repetition uses For each. A loop in user code is local computation and does not create separate per-item durable checkpoints.

### 15.3 Scope, variables and merge

A scope has a stable execution identity, a parent reference, read-only captured values and locally writable declarations. A variable has a stable ID, label, schema and initializer. Node/property labels can change without rebinding references. Shadowing requires an explicit local declaration; accidental same-name declarations are errors.

A normal sequential successor sees the successful update in its scope. A parallel fork snapshots visible values before branches start. Branches write only local declarations/overrides; they export named results. Parent state remains unchanged until an explicit Merge mapping commits an update. Iterations follow the same isolation rule.

For v1, Merge waits for the named branches selected at the fork; an unexpected failed branch fails the join unless an explicit handled-error outcome is configured. A skipped branch is marked absent, not failed or null. Collected iteration output preserves input order regardless of completion order. Branch results are keyed by stable branch ID, not completion index. Partial-results and first-completed policies are later explicit capabilities.

Merge has no implicit deep merge or last-writer-wins behavior. Mapping the same parent variable twice is a validation error. Append/concatenate or field selection is an explicit expression producing the replacement value. A parent update commits atomically only after all mapped values resolve and validate.

Generic multi-success fan-out with writable state must be normalized into explicit scopes or rejected at compilation. Runtime traversal order cannot define variable visibility. Conditional paths keep current-scope semantics only where a single active path is established.

### 15.4 Expression scope proposal

| Scope            | Proposed meaning                                                              |
| ---------------- | ----------------------------------------------------------------------------- |
| Workflow input   | Immutable input to this workflow invocation                                   |
| Node input       | Typed value resolved at the selected input port; distinct from workflow input |
| Upstream outputs | Explicit accessible node/port outputs from the current invocation/iteration   |
| Variables        | Visible declarations in the current scope                                     |
| Item/index       | Current For each scope only; unavailable outside it                           |
| Execution        | Read-only execution identifiers and approved metadata; no credentials         |

The final textual names are not frozen by existing `$input`/`$nodes` strings. Internally, a mapping retains node/port/variable IDs and a property path. Display names are labels. References cannot cross sibling branch/iteration boundaries; crossing a scope requires an exported result or explicit capture. Optional lookup can yield absent only where the destination or an explicit fallback permits it; syntax/type errors still fail.

Proposed v1 expressions support literals, typed references, arithmetic/comparison/boolean operations, conditions and a documented pure helper set. They produce a whole value. Text interpolation is deferred initially; text fields can use a whole-value expression that explicitly constructs a string. The renderer must state this clearly. Schema-only completion remains useful without recorded data; a recorded value does not redefine the declared type.

### 15.5 Code capability and result proposal

A saved Code instance chooses a versioned profile plus source/language, typed input/output contract and policy. A backend advertises the profiles it implements. Pure transform denies network, imports, host filesystem/process and credentials. A future governed profile declares permitted dependencies, destinations and brokered connection operations in a pinned capability manifest.

Code receives read-only context and returns a value; editing a local object in the guest cannot change workflow state. Output validation occurs before checkpointing success. Logs carry invocation/attempt identity and bounded redacted records. Errors distinguish compilation, user-code, output-schema, limit, cancellation and unavailable-runner failures and include source locations where available.

Tests capture the exact profile/source/config/input revisions. Full workflow execution additionally pins scope and compiler identities. No dependency or capability change can silently alter an existing run snapshot.

### 15.6 Drafts, preview and tests

Proposed lifecycle: Save draft accepts structurally valid, potentially incomplete configuration and persists diagnostics. Run eligibility requires full graph/type/scope validation plus runtime capability/connection checks. Invalid graph serialization, duplicate identities and malformed parameter structures are rejected even for drafts. Apply retains incomplete but structurally valid node edits with visible diagnostics; applying does not declare a node executable.

Preview never executes nodes. Missing sample dependencies are shown as unresolved. Initial node testing uses supplied sample or explicitly selected recorded input. Execute preceding nodes is deferred until its execution scope and effect confirmation UI is designed; it cannot happen implicitly.

A test result carries sample/run provenance, config/source/profile revisions, start/end time and status. Any change to its effective input or configuration makes it stale. Changing a sample must invalidate both expression previews and code-test results. Runtime checks enforce current authorization even when a selected sample came from an earlier run.

## 16. Reference scenarios for contract and interaction review

1. **Structured order request:** Construct data mixes fixed currency, computed total and nested delivery fields; output validates as one request and causes one provider invocation.
2. **Document collection:** For each receives three documents; each child constructs metadata and runs pure code. Results are collected in original order. Two concurrent iterations cannot overwrite a shared current-document variable.
3. **Parallel enrichment:** Customer and inventory branches capture the same order; each returns its own result. Merge selects the customer account and inventory availability into one output. No parent mutation occurs before Merge.
4. **Handled review branch:** One path waits for review and the other is skipped. The downstream mapping explicitly chooses the available result without fabricating a null output for the skipped path.
5. **Recovery:** Kill execution after a completed code step and before Merge. Resume reuses the code checkpoint, reconstructs the same scope and applies the parent update once in logical execution.

## 17. Node-editor review artifacts

The [interaction specification](node-editor-interactions.md) defines the shared layout, mapping behaviors, field modes, scope-aware node forms, validation/draft lifecycle and test/result provenance. The [five serialized review cases](examples/node-editor-review.json) cover structured orders, document iteration, parallel merging, conditional review and recovery. They are design-only fixtures, not current runtime imports or evidence of implemented behavior.
