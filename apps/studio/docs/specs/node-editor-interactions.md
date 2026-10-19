# Node editor interaction specification

> Design update, 2026-10-18: [Atomic node abstraction over DBOS](atomic-node-abstraction.md) takes precedence for node taxonomy and dialog layout. The earlier permanent three-pane layout below is superseded by fixed vertical Input / Process / Output navigation with node-defined horizontal tabs. Other behavior remains subject to that specification; this is not an implementation status claim.

Status: proposed interaction design, 2026-10-18. Implements the agreed architectural direction in [workflow authoring](workflow-authoring.md); does not claim that these interactions already exist. Companion [review fixtures](examples/node-editor-review.json) use a design-only format and must not be imported into the current runtime.

## 1. The user's task

The dialog answers three questions: what data can this node receive, what should it do with that data, and what happened when it ran? Opening it does not execute anything or change the saved workflow.

The canvas remains the place to see repetition, branching and dependencies. The dialog configures one node. For each and Parallel provide an explicit Open inner graph action; their child editors show a scope breadcrumb and Back to parent. Code does not hide repeated workflow execution behind a per-item option.

## 2. Shared layout

Desktop spatial wireframe (labels describe interaction, not final pixel dimensions):

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Normalize document   Code · Pure transform       Draft changed        ×   │
├─────────────────────┬───────────────────────────────┬──────────────────────┤
│ INPUT               │ Parameters · Code · Settings │ OUTPUT               │
│ Schema / Sample /   ├───────────────────────────────┤ Schema / Result /    │
│ Recorded run        │                               │ Logs                 │
│ Scope: document [2] │ Node-specific configuration   │                      │
│ Input ports        │                               │ Test / Workflow run  │
│ Accessible outputs │ Fixed / Expression per field  │ Revision and status  │
│ Visible variables  │                               │                      │
│ Type + presence    │ Inline previews and errors    │ Value / typed error  │
├─────────────────────┴───────────────────────────────┴──────────────────────┤
│ 2 configuration issues                     Preview   Test   Cancel Apply │
└────────────────────────────────────────────────────────────────────────────┘
```

Header, configuration tabs and footer are fixed. Each pane's body scrolls independently. The dialog frame never scrolls. Pane widths prioritize readable configuration rather than three equally sized columns. Long labels wrap without pushing close/actions out of view.

When three panes no longer fit, a pane selector shows Input, Configure and Output, preserving each pane's state. Errors select Configure and the relevant tab. Test completion selects Output only when the user initiated the test; unrelated live events never move focus. A small viewport must retain an explicit route back to configuration and visible actions.

Use official Untitled UI Dialog, Tabs, controls, menus, tooltips and buttons; existing Font Awesome Pro icons and Stack Proc typography/colors. This is not a new component library. JSON textareas are not substitutes for node forms or the source-code editor.

## 3. Opening and context selection

Opening from the editable graph creates a staged node draft and selects Parameters, or Code for an already configured Code node. The header shows the offering/operation and configuration status. The node display name is editable in Settings without changing its stable ID.

Opening a recorded run selects its immutable configuration. Header shows Workflow run, timestamp and version. Fields are read-only and the primary action is Close. An Edit workflow link opens the saved graph separately; it never turns the selected run into an editable object. A historic run with a missing/revoked connection can still show authorized retained metadata but cannot acquire fresh provider access.

Input context is explicitly selected:

| Mode         | What the left pane shows                                         | What preview/test may use                                             |
| ------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| Schema       | Declared port types, optionality and accessible references       | Completion and static validation; unresolved values remain unresolved |
| Sample       | Selected named sample and its revision                           | That sample only, with visible scope and overrides                    |
| Recorded run | Run, node invocation, iteration/branch selector, time and status | That captured invocation's authorized inputs/scope                    |

Switching context invalidates previews and marks existing test results stale. The dialog never combines input from one iteration with variables from another. Choosing recorded data as a test input copies a local test context with its provenance; it does not modify the recorded run.

## 4. The input pane is a mapping tool

Group the tree by input port, accessible upstream outputs and visible variables. Show only in-scope references by default. Each entry has a display label, type, presence and, when available, a sample value. Schema and observed value remain distinguishable. Collections show item schema and count; selecting an iteration changes scope, not the underlying data type.

Tree expansion, search and pagination are local actions. A property can be mapped without loading every member of a large array. Artifact entries show metadata plus an authorized inspect action; secret values remain unavailable to expressions and the tree.

Clicking a configuration field makes it the mapping target. The pane header then reads, for example, Mapping to Metadata → Document ID. Each eligible tree entry offers an icon action labelled Insert mapping. Copy path remains a secondary action. Keyboard users can choose the target and insert a mapping without dragging.

Insertion behavior:

1. Check scope, destination type and cardinality.
2. If incompatible, disable insertion and state the reason. Do not silently convert an object to text or run a collection many times.
3. For an empty Fixed field, insert a reference expression and switch the active mode to Expression while retaining its Fixed draft.
4. For a nonempty Fixed field or an existing expression, ask locally whether to replace the active value. Cancel leaves both drafts untouched. V1 does not guess where a property belongs inside arbitrary expression text.
5. Show a readable token/path referencing stable node/port/variable IDs. Renaming the source changes its label, not the reference.

An unavailable sample is a neutral Unresolved preview state if the declared reference is valid. A deleted or inaccessible reference is a configuration error. A skipped branch is Absent, not Null. Mapping across branches must use an explicit exported result/Merge.

## 5. A field is one typed value

Every data field has a visible label, required/optional marker, declared type and Fixed/Expression switch. Settings such as operation/version, credentials and retry policy use capability-specific controls. Their lack of an expression switch is deliberate.

Fixed mode uses the schema's control: text, number, boolean, enum, date, artifact selection or structured object/array. A schema-constrained number cannot become an object through a generic type picker. Freeform Construct data fields can choose a value type because their output schema is being authored.

Expression mode offers reference completion, documented helpers, syntax diagnostics and a compact inline result/type preview. Whole-value expressions return typed values. Initial text interpolation is unavailable; text can be explicitly assembled with a whole-value expression. Required types are checked after resolution without silent coercion.

Switching modes retains separate Fixed and Expression drafts, including nested edits, across tab changes. Only the active mode executes. Apply retains the inactive editor draft as authoring state, separated from executable configuration; reopening restores it. Referenced source values and credentials are not duplicated into that state.

Optional fields have an Include/Omit control. Omitted, null, empty text and empty array have separate presentations. Null is selectable only when the schema allows it. Omitted parameters are not transmitted as null.

## 6. Nested object and array editing

A structured object displays rows with property name, type, mode, value and issue status. Required schema properties cannot be removed; optional properties can be omitted. Additional fields are offered only when allowed by the schema. Freeform names are checked for empty/duplicate values before commit.

A structured array displays stable entry identities and ordered positions, an item-type label, Add item, accessible move controls and an icon remove action. Reordering updates positions without transferring a child's expression draft or error to another entry. Schema constraints determine minimum/maximum entries.

A composite Fixed object can mix fixed and expression children. Switching the root to Expression replaces executable construction with one whole-object expression; it does not evaluate both. Its previous structured draft remains recoverable. Collapsed groups carry descendant issue counts and expand when an error is targeted.

Raw JSON import is an explicit advanced action. Show a parsed/validated diff and apply atomically; failed parsing leaves the structured form untouched. Export is derived from the active configuration. There is no continuously editable second JSON source of truth.

## 7. Node-specific configuration

| Offering              | Main configuration                                                     | Data/scope behavior visible to the user                                                       |
| --------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Construct data        | Output schema; structured fields or whole-value expression             | Produces one value; no variable mutation                                                      |
| Set variables         | Rows selecting declared writable variables and replacement values      | Current scope shown; unknown/read-only targets disabled; updates validate and commit together |
| For each              | Collection mapping, inner graph, concurrency and item limit            | Item/index scope, visible collection count and input-ordered results; Open inner graph        |
| Parallel              | Named branches, input mappings and declared exports                    | Each branch gets an isolated scope; stable branch identities; Open branch                     |
| Merge                 | Named source results, output mapping, optional parent-variable updates | Explicit wait/error behavior; no implicit deep merge or last-writer-wins                      |
| Integration operation | Connection, resource/operation-specific fields and dynamic options     | One resolved input per invocation; availability and compatible connection status              |
| Code: pure transform  | Input mapping, JavaScript/TypeScript source, output schema and limits  | One invocation; read-only context; no connections/network/import capabilities                 |
| Call workflow         | Referenced version and input mappings                                  | Explicit child input/output; no write-through to parent variables                             |

Tabs appear only when useful. Parameters and Settings are shared concepts; Code and Output schema are dedicated sections when relevant. Credentials/Connection selection is a node-specific section or Parameters group, not a misleading universal tab. Retry/timeout controls live under Settings → Execution and respect the offering's policy.

Changing an integration operation stages a new schema and summarizes compatible retained fields and fields requiring review. Existing mappings are never discarded silently. Connection controls reference workspace connections; key values are configured through the control plane and never pasted into node parameters.

Code uses a real source editor with syntax highlighting, context completion and line diagnostics. Its header identifies the capability profile. Only installed profiles can be selected; governed external I/O is unavailable until implemented. Returning data does not update variables. Local array processing is allowed, while independently durable repetition belongs in For each.

## 8. Validation, Apply and workflow Save

| Condition                                                   | Presentation                                                                   | Apply draft                 | Test / Run eligibility                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------- | ---------------------------------------------------------------------- |
| Malformed parameter structure or duplicate stable identity  | Blocking structural issue                                                      | Blocked                     | Blocked                                                                |
| Missing required value, invalid expression or type mismatch | Red field marker, tab count, navigable summary                                 | Allowed as incomplete draft | Blocked for affected execution                                         |
| Valid reference without a sample                            | Neutral Unresolved preview with explanation                                    | Allowed                     | Test needs concrete input; full Run may resolve it at runtime          |
| Revoked connection or unavailable adapter/profile           | Availability issue with corrective link                                        | Allowed as incomplete draft | Blocked                                                                |
| Provider/code failure during test                           | Result error and source location; field marker only when reliably attributable | Allowed                     | Retry depends on corrected input/policy, not a fabricated schema error |

Apply commits the staged node draft atomically to the graph draft and closes. The canvas shows incomplete status. Workflow Save persists a structurally valid graph draft with diagnostics; Run validates complete semantics and current execution capabilities. Apply is not called Done because it must be clear what changes and where.

Cancel, close icon, Escape and backdrop dismissal use the same dirty-state rule: close immediately when unchanged; when changed, offer Keep editing / Discard changes. Do not save implicitly. After Apply, workflow-level unsaved state remains visible. Navigating into an inner graph requires Apply draft or Discard rather than losing edits silently.

On validation attempt, red exclamation markers appear at the precise field/control, owning group and tab. The summary names fields rather than presenting parser messages alone. Selecting an issue opens the tab, expands ancestors, scrolls its inner pane and focuses the field. Associated descriptions announce the message; focus is never moved by background validation or SSE updates.

## 9. Preview, Test and recorded results

Preview resolves the selected node's effective inputs against the chosen context without execution. The right pane presents resolved values and per-field failures, including unresolved optional/required data. It never silently executes ancestors. Background inline previews are debounced and do not write audit events as executions.

Test captures current staged configuration and input revisions without requiring Apply or Save. Its label is Test node or Test code. Before an effectful operation, the review shows connection, operation, effect classification and resolved target; a real write is labelled as such. No provider mutation occurs just to populate sample data. Pure code needs no external-effect confirmation.

V1 tests are enabled for offerings with an implemented standalone test contract. For each/Parallel/Merge without a captured scope cannot masquerade as ordinary action tests; show Preview inputs and explain that they are validated by a scoped workflow run until explicit scope-testing support exists.

Output has Schema and Result views plus Logs when supported. Result selects Test or Workflow run and shows invocation ID, context provenance, configuration revision, timestamps, status and stale state. Never replace a recorded workflow result with a test response. A stale test remains inspectable but cannot imply current configuration has passed.

Test actions follow Idle → Validating → Queued/Running → Succeeded/Failed/Cancelled. Cancel test cancels that invocation only. Stop is pending until the server acknowledges it. Editing during a test is allowed; the eventual result is automatically stale if configuration/input changed. Closing offers to cancel an active standalone test and must not silently cancel a durable workflow run.

SSE updates are correlated by workspace, test/run, node invocation and attempt. Older events cannot overwrite newer tests. Reconnect reloads authoritative status and then resumes the cursor. Expired samples, permission changes and deleted resources produce explicit states rather than empty success. Auto-arriving events do not change selected context or overwrite staged edits.

## 10. Reference walkthroughs

### Structured order

Use review case `order-request`. Select Total in Construct data, choose Expression and insert the pricing total reference. Expand Delivery and edit city without affecting the total draft. Output is one request. Preview shows currency USD, total 42 and delivery city Pune. A hypothetical request operation would receive one object; no live provider call is part of this fixture.

### Document iteration

Use `document-collection`. Select For each to see three documents and concurrency 2. Open inner graph; breadcrumb shows the iteration scope. Schema mode offers item title/text and index before execution. Recorded mode selects document 2 and shows only that invocation. Collected output stays in source order. The Code dialog has no hidden per-item execution switch.

### Parallel enrichment

Use `parallel-enrichment`. Branch editors show inherited read-only order input and local branch results. Merge maps customer.accountId and inventory.available into one result. Parent variable updates are optional explicit mappings. Neither branch can write the parent's account ID while it runs.

### Conditional human review

Use `handled-review`. For the low-confidence sample, the automatic branch is Skipped/Absent. The downstream mapping explicitly selects the available review result. Absence is visible separately from the customer's optional null comment. A human decision is not simulated by Preview.

### Recovery and provenance

Use `code-recovery`. Recorded code result and its source/profile revision remain visible while the workflow waits. Following restart, inspection identifies the reused checkpoint. Editing the saved Code source opens a new graph draft; it does not change that result or mark the resumed run as testing the new source.

## 11. Review completion and implementation boundary

The design is ready to implement when the five walkthroughs can be explained without hidden iteration, shared branch mutation, ambiguous field modes or mixed test/run provenance. The semantic core must satisfy the same fixtures before broad form changes. Fixtures are design contracts with expected results, not tests of the existing runtime.

Next implementation slice: versioned port/presence/scope contracts, Construct data, isolated branch/iteration state, explicit Merge and pure-code profile identity; then connect the dialog to those contracts. Preserve old saved graphs and captured execution semantics through a compatibility path.
