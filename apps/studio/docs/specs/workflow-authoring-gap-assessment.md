# Workflow authoring — implementation gap assessment

Assessed against the architectural direction agreed on 2026-10-18 and the proposed detailed v1 contracts in [workflow authoring](workflow-authoring.md). This is a source-based assessment, not a claim that target behavior is implemented. No application behavior was changed for this assessment.

## Main finding

The earlier implementation supplies useful editor and durability primitives, but it lacks the semantic model needed for a consistent builder. The largest correction is variable scope: one executor-local mutable dictionary makes successful updates visible to subsequently traversed nodes, including sibling paths. Traversal happens sequentially today, which hides rather than solves the branch-state problem. More field controls would build on the wrong contract.

## Retain, change and replace

| Area                        | Source evidence                                                      | Assessment and required work                                                                                                                                                                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original canvas and shell   | `components/flows/flow-builder.tsx`                                  | Retain fullscreen canvas, geometry, selection and existing shell separation; introduce semantic ports independently of geometric handles.                                                                                                                                                                |
| Parameter recursion         | `lib/authoring/model.ts`, `components/flows/parameter-fields.tsx`    | Retain nested Fixed/Expression foundations. Add destination schemas, required/optional presence, stable child identities and full mode-draft preservation. Current previous-value state is component-local and array entries use index keys.                                                             |
| Node contracts              | `lib/native/node-config.ts`, `lib/integrations/model.ts`             | Native editor descriptors and versioned integration schemas exist separately. Unify the authoring definition boundary with schemas, ports, capabilities and operation-specific presentation. Do not discard provider schema/connection checks.                                                           |
| Graph edges                 | `lib/flows/types.ts`                                                 | Edges carry source/target node IDs, geometry handles and outcomes, but no semantic data-port IDs/schema contracts. Add versioned ports and a compatibility interpretation for old graphs.                                                                                                                |
| Construct data              | Native `assign` in `lib/native/node-config.ts` and runtime           | Existing Map data/assign produces a value and can back a Construct data offering. Add its own authoring definition/output schema; do not conflate it with variable updates.                                                                                                                              |
| Variable declarations       | `AgentFlow.variables` and `lib/authoring/model.ts`                   | Currently a name-to-parameter map. Add stable declaration IDs, schemas, scope/writability and rename-safe references.                                                                                                                                                                                    |
| Variable updates            | `lib/native/executor.ts`, `lib/authoring/compiler.ts`                | Replace the new-authoring run-wide merge with scoped state propagation. Reject undeclared/type-invalid assignments and ambiguous writable fan-out. Preserve legacy execution semantics through versioned interpretation.                                                                                 |
| Iteration/parallel children | `server/native-runtime.ts`                                           | Retain explicit child workflows and stable child execution IDs. Current child input normalization and inherited input-variable spreading are not a lexical scope/capture contract. Add isolated captures, branch identity and explicit exports.                                                          |
| Merge                       | No dedicated authoring Merge contract in reviewed native definitions | Add a definition, graph/compiler rules and deterministic mappings. Ordinary join readiness and ordered awaiting of child results are not variable merge semantics.                                                                                                                                       |
| Expressions                 | `lib/authoring/expressions.ts`                                       | Reuse pure bounded evaluation where compatible. Current roots expose workflow input, outputs and one variable dictionary; there is no separate node-input or lexical scope model, typed completion or scope-aware reference analysis. Freeze supported language only after contract examples are agreed. |
| Presence and errors         | `lib/native/executor.ts`, `components/flows/field-validation.tsx`    | Retain visible field errors/tab markers. Current `result.value ?? null` collapses undefined and null; add presence-aware values and structured diagnostics with stage/path/source location. Verify error-summary focus behavior.                                                                         |
| Context dialog              | `components/flows/node-config-dialog.tsx`, `data-tree.tsx`           | Retain bounded panes, nested browsing and distinct recorded/test output. Add input-port context, sample selection/provenance, active-field mapping and schema-only browsing. A copied path is useful but does not complete the mapping workflow.                                                         |
| Preview/test freshness      | `components/flows/node-config-dialog.tsx`                            | Preview resolves the current compiled draft, and code testing uses a separate endpoint. Variable preview reconstructs updates from recorded outputs rather than a captured scope. Sample changes clear preview but do not consistently invalidate code tests. Add revision/provenance-based freshness.   |
| Code runner                 | `server/code/runner.ts`, `worker.mjs`                                | Retain as a candidate pure-transform backend and preserve verified limits/cancellation. Add explicit profile identity, output schema, structured errors and capability negotiation. Current Code schema directly pins one runtime and has no capability-profile abstraction.                             |
| Code repetition/editor      | `lib/authoring/model.ts`, `components/flows/code-fields.tsx`         | Replace each-item as a new-authoring execution mode with visible For each; preserve old saved behavior or explicitly migrate. Replace plain source textarea with a proper code editing experience after the context API is defined.                                                                      |
| Durable compilation         | `lib/authoring/compiler.ts`, `server/native-runtime.ts`              | Retain snapshot separation, code revisions and checkpoint reuse. Extend to a scope/port/type-aware plan with compiler/offering identities and source-mapped diagnostics. No silent reinterpretation of existing v2/v3 snapshots.                                                                         |
| Draft/run lifecycle         | `lib/flows/validation.ts`, `server/store.ts`, dialog                 | Existing parsing/validation and Done/Save behavior need separate structural-save, configuration-validity and run-eligibility stages. Persist diagnostics and show incomplete drafts honestly.                                                                                                            |

## Delivery slices and exit criteria

### A. Contract fixtures and editor interaction review

Review artifacts are now available: [node-editor interactions](node-editor-interactions.md) and [five serialized cases](examples/node-editor-review.json). These make the proposed behavior concrete; they do not mark design review or runtime conformance complete.

Finalize the proposed v1 contracts with serialized examples for the five reference scenarios. Define port/value presence, declarations/scopes, merges, code profiles, expression context and diagnostics together. Review dialog states for empty samples, mapped expressions, nested fields, incomplete configuration, code testing and recorded-run inspection. Exit: the same fixture can explain UI authoring and execution semantics without DBOS operation JSON.

### B. Semantic core and compatibility

Implement versioned definitions and authoring instances, scope-aware validation/compilation, typed presence-aware values, Construct data/Set variables/For each/Parallel/Merge and pure Code profile dispatch. Preserve old snapshots; migrations must be explicit and reviewable. Exit: tests prove isolated concurrent iterations/branches, deterministic merging, typed failures and checkpoint reuse. Existing happy-path tests remain useful but are not sufficient.

### C. Editor bound to the contract

Wire official Untitled UI controls to definition-driven fields and the scoped data explorer. Add expression completion/mapping, stable nested field drafts, useful code editing and diagnostics/provenance. Exit: create, save, reopen, test and run the local reference workflows through visible controls; inspect invalid and compact-layout states.

### D. Representative adapter adoption

Apply the shared contract to an HTTP operation, a document-processing offering and a model/framework offering. Distinguish installed adapters and usable connections from catalog definitions. Use deterministic local fixtures where live access is unavailable; report that distinction. Exit: each offering has meaningful parameter/schema UI and an authorized durable execution path with correct effects/recovery semantics.

### E. Governed code capability design

Specify and implement allowed dependencies, egress, brokered connection calls, tenant worker isolation and deployment policy separately from pure transforms. Exit: capabilities are pinned and enforced, revocation is honored and effects have retry/idempotency semantics. Until then, advertise the pure profile only.

## Changes to remove from new authoring

- Run-wide variable updates that leak across branch traversal.
- Implicit per-item repetition hidden in a Code settings switch.
- Raw DBOS operation objects as the primary form model.
- Treating a recorded sample as the declared output schema.
- Treating current implementation limits/parser syntax as already-approved product requirements.

Removal from new authoring does not mean deleting old saved graphs or changing their recovery behavior. Compatibility behavior stays versioned.
