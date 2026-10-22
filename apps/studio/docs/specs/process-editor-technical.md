# Shared workflow editor for visual process authoring

Status: target technical specification, 2026-10-20. Delivered increments and remaining boundaries are recorded in [implementation notes](process-editor-implementation.md). Implements the direction in [Visual process composer with agent activities](visual-process-composer.md).

## 1. Decision and boundaries

Use the existing Stack Proc workflow editor to author process representations. Extract its canvas and configuration frame once, then supply workflow and process document adapters. Do not copy `FlowBuilder`, add another canvas library, introduce a BPMN renderer, or save processes as disguised runnable workflows.

Both modes use the existing grid, task-card styling, selected-node toolbar, handles, edge paths, connection editing, pan/zoom and fullscreen interactions. Process mode supplies business activity labels, performer markers, responsibility lanes and process validation. Events and gateways initially use the same card family with recognizable event/decision markers; exact BPMN geometric shapes are a future renderer option, not a prerequisite. This refines the shape proposals in the product spec while preserving their meaning.

Keep canonical semantics distinct:

- `AgentFlow` is a workflow authoring/execution document stored through the flow API.
- `ProcessDocumentV2` is a versioned knowledge artifact stored through the knowledge API.
- `CanvasDocument` is an in-memory presentation projection. It is neither persisted as a domain document nor sent to the execution endpoint.
- Only an explicit process compilation translates business intent and bindings into an executable `AgentFlow`.

## 2. Existing code and coupling

`components/flows/flow-builder.tsx` contains the custom canvas. It does not use React Flow. It currently owns `BoardNode`, `EdgeLayer`, `NodePalette`, coordinate transforms, viewport and selection state, node/edge mutations, layout helpers, nested definition navigation, persistence and execution streaming in one module.

Reusable code includes `handleNodePointerDown`, board pointer handlers, `startEdge` / `finishEdge`, endpoint reconnection, `zoomAtPoint`, `fit`, `screenToWorld`, `handlePoint`, node sizing and the visual portions of `BoardNode` and `EdgeLayer`. `lib/flows/geometry.ts` supplies `ropePath` and its existing geometry tests.

Workflow-specific responsibilities stay in a host: `loadSavedFlow`, `saveFlow`, `runFlow`, `followRun`, `applyRunEvent`, resource provisioning, escalation resolution and `/api/flows` / `/api/runs` calls. Process mode must not mount these effects, even when execution controls are hidden.

`NodeConfigDialog` already composes official Untitled UI controls and the Input / Process / Output layout, but its fields and inspection logic depend on `FlowNodeData`, `AgentFlow`, workflow expressions and native operation definitions. Extract its frame; retain typed mode-specific bodies. Reusing it does not mean converting process activities into native operations.

The current process implementation is `lib/knowledge/process.ts`, `components/knowledge/editors.tsx` and `lib/intelligence/generation.ts`. The linear generator and its tests remain the compatibility path for schemaVersion 1.

## 3. Proposed modules

| Proposed module                                    | Responsibility                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `components/graph-editor/graph-editor.tsx`         | Shared canvas composition, toolbar slots and projected node/edge rendering            |
| `components/graph-editor/use-graph-editor.ts`      | Selection, connection previews, drag/pan, viewport and command dispatch               |
| `components/graph-editor/board-node.tsx`           | Existing node chrome, handles, status marker and selected-node actions                |
| `components/graph-editor/edge-layer.tsx`           | Existing edge rendering, labels and endpoint editing                                  |
| `components/graph-editor/configuration-dialog.tsx` | Shared Untitled UI dialog frame, navigation, dirty dialog state and footer            |
| `lib/graph-editor/contracts.ts`                    | Presentation graph, adapter, commands and diagnostics contracts                       |
| `lib/graph-editor/geometry.ts`                     | Extracted generic bounds, coordinate and handle helpers; reuse existing rope geometry |
| `components/flows/flow-builder.tsx`                | Workflow host preserving its public props and routes                                  |
| `components/flows/workflow-editor-adapter.ts`      | Workflow projection, commands, palette and validation adapters                        |
| `components/processes/process-workspace.tsx`       | Artifact loading, draft, revisions, save/review/publish and compile actions           |
| `components/processes/process-editor-adapter.ts`   | Process projection, process commands, allowed connections and palette                 |
| `components/processes/process-node-dialog.tsx`     | Process-specific configuration composed inside the shared frame                       |
| `components/processes/process-settings.tsx`        | Purpose, input/output contracts, defaults and pinned ontology references              |
| `lib/processes/model.ts`                           | Strict Zod Process v2 model and TypeScript types                                      |
| `lib/processes/migrate.ts`                         | Lossless v1-to-v2 preview migration with explicit compatibility metadata              |
| `lib/processes/validation.ts`                      | Draft integrity, review readiness and execution-readiness validation                  |
| `lib/processes/compiler.ts`                        | Process lowering, capability checks and compilation manifest                          |
| `lib/processes/run-projection.ts`                  | Compiled run/agent events projected onto process elements                             |

Paths describe the target organization. Extract by behavior and preserve existing component APIs during migration; do not move unrelated workflow dialogs, tool builders or ontology components.

## 4. Shared editor contract

Use a generic adapter so document editing remains typed. Illustrative interfaces:

```ts
type CanvasDocument = {
  nodes: CanvasNode[]; // id, title, subtitle, visual kind, bounds, handles, badges
  edges: CanvasEdge[]; // id, source/target handle refs, label, visual route kind
  lanes: CanvasLane[]; // optional background bands; no execution permissions
};

type EditorCommand =
  | { type: 'moveNodes'; positions: Record<string, { x: number; y: number }> }
  | { type: 'addNode'; paletteId: string; position: { x: number; y: number } }
  | { type: 'connect'; source: HandleRef; target: HandleRef }
  | { type: 'reconnect'; edgeId: string; endpoint: 'source' | 'target'; handle: HandleRef }
  | { type: 'deleteSelection'; nodeIds: string[]; edgeIds: string[] }
  | { type: 'arrange' };

type EditorAdapter<TDocument> = {
  project(document: TDocument): CanvasDocument;
  apply(document: TDocument, command: EditorCommand): CommandResult<TDocument>;
  canConnect(document: TDocument, source: HandleRef, target: HandleRef): ConnectionCheck;
  palette(document: TDocument): PaletteEntry[];
  validate(document: TDocument): EditorDiagnostic[];
};
```

The host owns the canonical draft and applies commands atomically. Projection is one-way; never reconstruct process semantics by reading labels or converting projected cards back into `AgentFlow`. Node dialogs apply typed domain patches through the host rather than an untyped catch-all `config` object.

Separate transient state from saved content: hover, selection, drag preview, inspector state and open dialogs are transient. Positions, lane geometry and manual edge waypoints are presentation data in the process revision. Viewport preferences may persist per user and document without creating a semantic revision.

Capture one history command for an entire drag/reconnect, not one per pointer move. History includes node edits, edge edits, insertion/deletion, arrangement and process settings. Selection and live execution updates do not enter undo history. Read-only mode blocks every mutation path, including keyboard commands and inspector Apply.

Use existing geometry with renderer-supplied bounds instead of `FlowNodeKind` switches. Retain compatibility exports while migrating helpers. Existing `MAX_FLOW_NODES = 50` is a workflow editor constraint, not an implicit limit for every graph; introduce explicit per-mode limits enforced on both server and client. Initial process v2 limits are 200 elements, 400 flows, 20 lanes, nested depth 8 and a 1 MiB serialized-content bound; existing request-body limits must accommodate or explicitly reject that bound. Exceeding generated workflow limits is a compile diagnostic, never truncation.

## 5. Process document contract

Use an independent `schemaVersion: 2` discriminator in process content. It is unrelated to workflow `schemaVersion` or `authoringVersion`. Store the process name on the artifact as today.

```ts
type ProcessDocumentV2 = {
  schemaVersion: 2;
  purpose: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  defaultInput: Record<string, JsonValue>;
  ontologyRefs: ArtifactRef[];
  roles: ProcessRole[];
  graph: ProcessGraph;
  definitions: Record<string, ProcessGraph>;
  questions: ProcessQuestion[];
  presentation: ProcessPresentation;
  compatibility?: { sourceVersion: 1; inputEnvelope: 'variables' };
};
```

`ProcessGraph` contains stable-ID elements, typed flows and structured region metadata. Types include start, activity, exclusive decision, paired parallel split/join, wait, subprocess, bounded repetition and end. Each nested definition is an explicit input/output scope. Presentation geometry cannot create membership or execution order.

An activity has independent business fields and an execution binding:

- Business fields: stable ID, name, description, role reference, evidence, input parameters, input/output schemas and named outcomes.
- Binding union: unresolved capability; registered operation/version; referenced workflow revision; human task definition; pinned agent activity definition; or a data-construction binding for migrated constructs.
- Policies: declared failure/timeout routes, approval requirements, identity reference and deadlines.

Use existing `Parameter`, schema fields and fixed/expression controls where their semantics match. Define process expression roots explicitly: `$input`, `$activities[stableId]`, and explicit subprocess captures. Keep existing v1 `$input.variables` and node references through a compatibility resolver; changes to roots require visible mapping edits. Expressions cannot access future activities or another branch's unmerged values.

Flow kinds are sequence, named outcome, default and attached exception. An outcome edge references a declared outcome ID, not a free-form label. Exclusive conditions are typed boolean predicates. Guard edges against missing endpoints, incompatible handles, duplicate IDs, illegal scope crossings and unsupported cycles. Structured parallel/repetition metadata is mandatory for executable controls.

Keep design readiness separate from run status. `intent-only`, `binding-required`, `configuration-required`, `ready` are derived diagnostics. `queued`, `running`, `waiting`, `succeeded`, `failed`, `cancelled`, `uncertain` belong to a selected execution overlay only.

## 6. Routes and shell integration

Introduce `/processes?id=<artifactId>&revision=<optional>&element=<optional>&run=<optional>` as the fullscreen process route. Add it to the same shell-exclusion policy used for workflow/ontology composers. The Knowledge Processes table remains the entry list; its Open action targets the process route.

Legacy `/knowledge?id=<process>&view=process` links redirect after authorized artifact lookup. Preserve revision, evidence and deep-link parameters. Validate artifact kind and return a visible type/not-found error instead of loading a starter document. Never select the first saved process as a fallback. Key the host by workspace/artifact/revision so drafts cannot bleed across navigation.

Use `FullscreenWorkbench` for the frame and shared editor slots for canvas actions. Header actions are Save revision, Review, Publish, Compile workflow and Back. Workflow Run, Send message and All runs controls are supplied only by workflow mode. Process mode can inspect pinned runs and offer Test implementation only after selecting a compiled implementation; it cannot run the presentation graph.

Process settings use the shared dialog. Activity configuration uses Input / Process / Output, followed by supported Test/results and Help last. Process validation issues navigate to the relevant node, route and field. Agent activities expose contract/tool/limit tabs; a model profile is not relabeled as an agent.

Retire the process form as the primary editor when the canvas slice is complete. Keep Knowledge source viewing and ontology routes intact. Unsaved navigation uses the shared guard; hard reload/close retains browser-owned beforeunload protection.

## 7. Persistence and API changes

Extend KnowledgeStore parsing to a discriminated process v1/v2 union. Preserve generic artifact GET/PUT and review/publish endpoints; validate workspace ownership for all referenced process/ontology revisions and execution resources. Save has the existing `{name,kind:'process',content,expectedVersion}` contract and returns server-normalized artifact, revision and diagnostics.

Draft saving validates document structure and size but permits unresolved bindings and incomplete business routes. Review requires complete business topology, typed contracts and resolved blocking questions; execution bindings may still be unresolved and are identified in review scope. Process publication freezes an approved business definition, not an execution permission. Executable workflow publication requires complete executable bindings and current policy checks. Extend the existing review service explicitly to express this distinction rather than weakening workflow validation.

GET revision responses include `sourceSchemaVersion` and diagnostics; migrate v1 only for editor preview. PUT explicitly writes v2 and a new immutable revision. Viewing or compiling a pinned legacy revision never overwrites it. Use the current optimistic edit version and transactional audit behavior.

Add process endpoints under `/api/knowledge/artifacts/:id`:

| Endpoint                | Behavior                                                                                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST `/compile-preview` | Resolve an authorized saved revision and binding overrides; return diagnostics, manifest preview and implementation projection. No flow is created or published.       |
| POST `/compile`         | Commit a validated candidate with expected head version, source revision, preview digest and idempotency key; return flow ID, manifest ID and implementation revision. |
| GET `/implementations`  | List compiled source revisions and binding variants for this process; authorize workspace on every result.                                                             |

Preview input is bounded to revision IDs and validated binding overrides; it never supplies arbitrary executable code outside existing tool/code contracts. A preview digest covers source revision/semantic hash, binding hash, compiler version and resolved dependency revisions. Commit rechecks these dependencies and permissions, then verifies the digest. Return 409 for stale preview/head; return structured 422 diagnostics for unsupported/unresolved execution. Preserve the user's draft.

Retain existing `/generate` for v1 callers and linear-process@1. V2 generation delegates to the new explicit compiler service. New outputs use a distinct versioned manifest; old saved workflows and generation records stay readable.

Extend generation persistence with a new checksummed migration, never edits to applied SQL. Add a versioned process-compilation record containing workspace, process/revision, semantic and binding hashes, compiler version, manifest, flow/revision and creator. Enforce idempotency using workspace/actor/client key plus request digest; a reused key with different intent returns 409. The existing one-flow-per-process-revision manual-generation constraint remains for legacy records only. Transactionally commit the candidate flow, its revision, manifest and audit receipt.

## 8. Compiler and execution integration

The v2 compiler first validates graph shape and scopes, resolves versioned bindings, type-checks inputs/outcomes, checks registered runtime capability support, then lowers to authoring v2 `AgentFlow` and calls `compileAuthoringGraph`. Do not infer implementability from `FlowNodeKind` alone; some kinds are legacy compositions and are not interchangeable with atomic operations.

Lowering rules:

| Process element                | Executable lowering                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Start                          | Workflow entry/input validation; invocation profiles remain separate                                 |
| Data-construction activity     | Existing construct operation and parameter adapter                                                   |
| Registered operation           | Installed operation/adapter with pinned definition and authorized connection                         |
| Referenced workflow/subprocess | Explicit child workflow or scoped definition with typed captures/output mapping                      |
| Decision                       | Condition evaluation and explicit route lowering with checked default/overlap semantics              |
| Parallel region                | Supported scoped branches plus paired completion and explicit merge                                  |
| Human task                     | Versioned task/response record and authorized durable wait; not a legacy approval node by assumption |
| Agent activity                 | Durable child invocation of the owned Stack Proc harness; model/tools/questions remain checkpointed  |
| Wait                           | Correlated durable receive or timer with declared timeout/error routes                               |
| End                            | Process outcome/output mapping after required branch completion                                      |

Unsupported lowering returns a diagnostic. Never drop a process node, substitute null, or serialize the whole graph into an opaque tool call.

The v2 manifest is one-to-many: `processElementId -> workflow node/scope IDs`, `processFlowId -> executable edge IDs`, agent definition/tool revisions, ontology refs, policy versions, input adapter version and dependency hashes. Generated executable IDs are deterministic for unchanged source elements, bindings and compiler version; repeated invocations carry separate runtime IDs.

Agent child execution identity includes workspace, parent run, process revision, activity ID and activation/iteration ID. Duplicate delivery resumes the same activation; a later loop iteration creates a different child. Propagate cancellation/deadline durably, record output validation and correlate tool effects. Parent completion requires the child's accepted terminal result. Uncertain tool effects route to explicit intervention, not blind re-execution. This adapter is new work; existing workspace-agent source is a foundation, not proof that process invocation is supported.

Run projection consumes the manifest and pinned runtime events. A process activity succeeds only when its required generated work completes. Preserve branch/iteration activation identity so a later success cannot overwrite an earlier failure or waiting instance. Open agent Activity using the correlated work-item ID; do not create a fake transcript. Runtime updates never edit the saved process document.

## 9. Migration and implementation sequence

1. Extract the canvas and node/dialog chrome with the workflow adapter as the only consumer. Keep FlowBuilder props, current rendering, saved graph JSON, node bounds and execution APIs compatible. Test workflow save/settings, connector drag/reconnect, nested definitions, run snapshots and escalation actions before adding process mode.
2. Add Process v2 schemas, validation, compatibility migration and process artifact host. Render legacy constructs/return/requirements on the shared canvas. Save/reopen a v2 draft and compile the existing linear subset with fixture-equivalent output. This is the first deliverable replacing the form.
3. Add process activity/route configuration, evidence, role metadata and lanes. Add lane geometry to the shared projection; workflow adapter supplies an empty lane list. Owner changes are explicit and independent of drag position. Add command history to both modes through the same command controller if existing workflow history is absent.
4. Enable structured controls, human tasks and waits only alongside compiler/runtime adapters and recovery tests. They may be authored as unresolved design elements before they are executable.
5. Add bounded agent activity invocation and run-tree drilldown through the existing harness. Complete multi-activity recovery, questions, budgets, typed outcomes and cancellation tests.
6. Add assisted diagram proposals, compile-preview/commit diffs and source-to-implementation drift inspection. All proposals use the same typed domain commands and existing reviewed change-set authorization.

Use explicit availability metadata: `design`, `compile-supported` and `runtime-supported`. A capability is enabled for running only when all required layers pass. Full BPMN interoperability, arbitrary cycles and a replacement canvas engine are outside this implementation.

## 10. Verification and release gates

Unit tests cover projection preserving IDs, commands preserving domain fields, valid/invalid connection checks, single-command drag history, schema/version parsing, bounded payloads, v1 migration and expression equivalence, hashing and deterministic compiler mappings. Reuse geometry tests after extraction.

Integration tests cover process artifact save/reopen/conflict; source/dependency tenant isolation; review scope; compile preview without side effects; atomic/idempotent commit; stale preview rejection; legacy generator compatibility; and retention of existing flow revisions. Runtime fixtures cover branching, parallel joins, human authorization/duplicate/late responses, wait-timeout races and agent activation recovery/cancellation/uncertain effects. Unsupported features must produce visible diagnostics and zero execution side effects.

Browser checks run both workflow and process modes against the same extracted renderer. Exercise add/move/delete/reconnect, selected-node toolbar, settings Apply then Save, undo/redo, read-only revision, nested scope breadcrumbs, compile navigation and unsaved dialogs. At narrow widths/zoom, canvas controls and dialogs remain reachable with no body scrolling. Save screenshots of both modes and compare workflow rendering before/after extraction.

Release is complete when a process can be authored and persisted through the existing workflow-editor interactions, a supported process compiles with traceable mappings, and existing workflow editing/execution has no regression. No runtime behavior is inferred from a visually successful process diagram.

Implementation status: the [first shared-canvas delivery](process-editor-implementation.md) is implemented. That note distinguishes delivered linear behavior from the remaining target contracts above.
