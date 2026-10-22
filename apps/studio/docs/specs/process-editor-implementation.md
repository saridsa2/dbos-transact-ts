# Visual process editor implementation

Delivered 2026-10-20: first visual editing slice from [the technical specification](process-editor-technical.md).

## Shared editor foundations

The workflow and process editors now import the same `GraphSurface`, `BoardNode`, `EdgeLayer`, anchored viewport hook and rank-layout helper. These were extracted from the existing custom workflow canvas; no new canvas dependency was added. Both node configuration surfaces use the extracted `ConfigurationDialog` frame and official Untitled UI controls. Workflow-specific persistence, model resources, execution streams and escalations remain in FlowBuilder. Process mode never mounts those workflow execution effects.

The process host saves knowledge artifacts rather than AgentFlow projections. Its fullscreen route is `/processes?id=...`; Knowledge process links open that route, and old knowledge-detail/revision links redirect after authorized lookup. Source and ontology views remain unchanged.

## Delivered behavior

- Existing v1 processes project into a typed v2 graph without changing saved content on read. Start is synthesized deterministically; activity/end IDs, expressions, default input, ontology refs, questions and evidence are preserved. Graph position is separate from sequence.
- Start, data-construction activity and End support the existing linear executable semantics. Human, system and agent intent can be represented and saved, with an explicit Binding required state; they cannot be reviewed/compiled as executable activities yet.
- The canvas supports selection, node dragging, connecting, endpoint reconnection, rerouting, deletion, arrangement, zoom/pan, process command undo/redo and keyboard deletion. Selecting a connection or adjacent activity allows insertion on that sequence.
- Settings own name/purpose, typed input/default values, pinned ontology references and existing clarification questions. Node dialogs own activity intent and existing Fixed/Expression output configuration.
- Apply changes the local draft; Save revision persists with the existing edit-version conflict check and immutable history. Reloading retains saved geometry and content. Historical revision URLs and viewers are read-only.
- Ordinary navigation uses the shared discard dialog. Process mode exposes review/publication and compilation through existing authorized backend services, with unresolved work blocked.
- The v2 linear lowering traverses graph connections, preserves `$input.variables` and existing node references, and delegates to the existing compiler. Its generation manifest records `visual-linear-process@2` plus entry and stable step mappings. Legacy v1 generation remains unchanged.

## Verification

The unit suite passes 197 tests including migration/compiled-output equivalence across existing domain fixtures, geometry, ordering independent of layout, immutable command updates, deletion, malformed topology and unresolved bindings. The two isolated backend suites pass 90 integration tests including v2 save/reopen, retained v1 revisions, stale writes, generation lineage and non-execution of unresolved agent intent.

Browser verification uses a separate Process canvas verification artifact in the QA workspace. It exercises insertion, process configuration, undo/redo, dragging, endpoint reconnection, anchored wheel zoom, arrangement, save/reload and read-only revision controls. Narrow viewport checks confirm bounded page dimensions and reachable settings/dialog actions. The user's original myprcs revision is retained. The existing Explicit document iteration workflow and its node configuration dialog were inspected after extraction without saving or running them.

## Remaining technical specification work

The delivered v2 schema is the linear subset, not the complete proposed graph vocabulary. Responsibility lanes, gateways, paired parallel controls, nested process scopes, durable human tasks and process-to-harness agent invocation are not implemented. No runtime adapter is implied by the human/agent design cards.

Compile preview/commit digests, binding variants, expanded one-to-many runtime manifests, process run overlays, diagram proposal application and independent implementation forks remain future increments. This slice retains existing review rules and manual-generation transaction/idempotency rather than introducing the proposed review-scope distinction or new compilation endpoints. Workflow command history has not been migrated into the process command controller; workflow interactions otherwise retain existing behavior.

## Structured execution and inspection increment (2026-10-20)

The editor now supports typed Decisions with True/False routes, explicit Merge elements, responsibility lane assignments/bands, and activities backed by the existing native operation contract. The executable palette adds registered system operations, durable timers, message/event waits, human approval, awaited subprocesses, bounded foreach/loop and parallel child workflows. Native activity configuration is the existing workflow `NodeConfigDialog`, including input parameters, execution settings and port contracts. Start/construct/End compatibility lowering is unchanged; richer documents use `visual-structured-process@3`.

A Decision must have one route for each boolean outcome. Review, receive and waitEvent require separate Success and Timeout routes. Multiple incoming routes require Merge. Validation traverses every branch for cycles/reachability. Repetition is explicit and bounded; detached subprocess/foreach dispatch is rejected in process mode. Parallel execution is represented as a collapsed activity with separately captured child workflows, using the existing DBOS parallel operator rather than a second graph interpreter.

Process settings capture workflow implementation snapshots and their nested dependencies. Compilation rejects missing dependencies rather than resolving mutable workflow references from another workspace. Lanes record business responsibility and optional workspace-role labels; they do not grant access or alter existing approval authorization.

### Harness activity adapter

An agent activity captures a workspace configuration revision, read-only built-in tool allowlist, goal/input, result schema, turn budget and deadline. It lowers to the reserved `stackproc.process-agent.v1` host boundary. `server/agent/process-activity.ts` creates an idempotent linked work item in the existing workspace harness outbox, under the recorded workflow actor. The native runtime calls this durable host boundary outside an enclosing `DBOS.runStep`. Model/tool checkpoints, authorization checks, uncertain outcomes, provenance and Activity remain owned by the existing query lifecycle.

The parent durably observes completion with DBOS checkpoints and sleeps. Results are schema-validated and include actual agent work/session IDs. Deadlines cancel linked work; reconciliation cancels unfinished linked work after the parent run fails or is cancelled. Policy revisions are checked during compilation and execution, and existing per-turn authorization applies. Linked sessions retain execution history and can be archived rather than deleted. This increment deliberately exposes read-only research activities; it does not grant process agents autonomous workspace writes.

### Compilation and runs

`POST /api/knowledge/artifacts/:id/compile-preview` returns an immutable-source digest, generated node list and captured subprocess summary. The UI presents this before workflow creation. Generate accepts the preview digest and rejects stale previews, while preserving the existing transactional generation receipt and duplicate-request behavior. Runtime validation checks installed operations and child contracts; workspace tool releases are checked under the current workspace principal. The manifest records the digest, lane metadata, stable element/node IDs and bound agent/native definitions.

`GET /api/knowledge/artifacts/:id/implementations` lists generated implementations across process revisions and marks workflow edits after compilation. The process run inspector opens the exact source revision, polls persisted run events while active, and projects node status onto stable process IDs. Recorded node details reuse workflow result inspection. Completed agent activities link to their actual workspace Activity session. Historical run inspection is read-only; saved process input is not substituted for the recorded run input.

### Reviewed process proposals

`process_propose_v1` stages a complete validated visual process against its expected head version in existing change sets. Applying uses the same content-hash approval, current authorization, optimistic version check, transaction, audit and duplicate receipt as ontology proposals. It saves a process draft only. The intelligence UI composes the licensed ArtifactPanel and AgentGate for review; it does not auto-review, compile or execute proposed processes.

### Boundaries still outside this increment

This is not complete BPMN conformance. Human activities currently use the existing durable approval decision contract; custom task-form schemas, role-specific task assignment and a separate task inbox are not delivered. Child workflows are captured snapshots configured in the existing workflow editor; inline process-scope canvas editing and explicit paired split/join canvas gateways are not delivered. There is one generated implementation receipt per process revision; separately named binding variants, independent fork-management commands and expanded per-iteration one-to-many process manifests remain future work. Process proposal review shows typed document versions and element summaries; an interactive before/after graph diff is not implemented. Responsibility lanes use the shared pool layout described below.

### Verification of this increment

206 unit tests and 93 tests across the isolated runtime/harness integration suites pass. A focused compilation integration pass also verifies digest rejection, duplicate compilation and implementation drift after the final drift-normalization fix. The production build and TypeScript checks pass. Revision counters, timestamps and diagnostic refreshes are excluded from drift detection; actual definition changes are retained.

Browser QA saved responsibility lanes, configured a timer through the workflow dialog, reviewed/compiled the process, ran the generated workflow to completion, then opened the exact source revision in the read-only process run inspector. All three process nodes show their persisted completed status. QA uses Process canvas verification revision 6; the user's original myprcs artifact remains unchanged. Screenshots are `.studio/process-compilation-review.png` and `.studio/process-run-inspection.png`.

## Swimlane layout

The process canvas now renders one common pool with ordered, full-width responsibility lanes, including empty lanes. A lane can be named, associated with a descriptive workspace role, reordered, resized by pointer or keyboard, and removed while preserving its activities. Activities without an assignment appear in an Unassigned row. Lane assignment describes process responsibility; it does not grant permissions or dispatch tasks.

Dragging an activity across a lane boundary changes its assignment by the card center. Explicit assignment, lane reordering, resizing and arrangement preserve sequence flows and executable bindings. Arrange aligns execution ranks across lanes and separates sibling activities. Pool geometry and lane heights persist in the process presentation schema; legacy documents receive a deterministic layout without a write on read. Layout edits participate in undo/redo, and run inspection remains read-only.

Validation includes 10 layout regression tests and a service integration test that saves/reopens lane geometry, generates the workflow with matching positions, and executes it successfully. Multiple participant pools, message flows and BPMN interchange are outside this slice.

## Process connectors and activity configuration

Process sequence flows use orthogonal elbow routing with port-direction stubs and activity-card obstacle avoidance. Connection previews and branch labels use the same route; reconnect and reroute commands retain their existing semantics. The workflow canvas keeps its existing connector style. Overlapping cards can obstruct a port, so that case retains an editable orthogonal fallback rather than claiming obstacle-free routing.

Native process operations and decisions continue to compose the workflow NodeConfigDialog, now with process-specific header metadata and icons. Other process activities use the same configuration frame, section headings, vertical Input/Process/Output/Help navigation, bounded scrolling and footer. Bound agents separate General, Execution and Allowed tools; result schemas live under Output. Icons distinguish start/end, decision/merge, system, timer, human approval, message/event waits, subprocess, repetition, parallel work, agent and data construction. All added symbols use the existing licensed Font Awesome Pro Regular icon source.

## BPMN import preview (issues #1/#2 follow-up, 2026-10-20)

The fullscreen process header exposes **Import BPMN**, composed from the installed Untitled UI modal, inputs, select, textarea and buttons. `/api/knowledge/bpmn/preview` requires the current workspace's execute permission and accepts self-contained BPMN 2.0 XML up to 1 MiB. DTD/entity declarations and malformed XML are rejected; external documents and vendor scripts are never loaded or executed.

Multi-process definitions require an explicit selection. Supported drafts contain one plain start/end, ordinary tasks and flat responsibility lanes connected by an acyclic sequence. Task intent is retained as a human/system requirement; no service implementation or approval policy is inferred. Review and compilation remain blocked until native bindings are configured. The original XML, selected process ID and remapped-ID table persist in optional `bpmnSource` metadata. Native cards are arranged by graph rank and lane, with BPMN diagram horizontal order used to stabilize ordering; exact BPMN dimensions and edge waypoints are not reproduced.

Gateways, event definitions, collaboration message flows, nested lanes/subprocesses, loop/compensation semantics, conditional flows and invalid graph structure produce element-level blocking diagnostics. The entire draft replacement is disabled in those cases. Original pizza and invoice BPMN fixtures exercise these limitations. This is a bounded draft importer, not a general BPMN execution engine. Applying replaces only the local draft, participates in Undo, and requires Save revision to persist.

The RDF preview fix recognizes RDFS classes as well as OWL classes. Unresolved relationships are omitted with term-specific warnings rather than invalid local-name endpoint guesses. English/untagged labels are preferred. Additional parent assertions are disclosed when projecting to the native single-parent model; complete RDF remains in `rdfSource`. Original W3C ORG and SKOS fixtures now preview successfully without pre-normalizing source files.
