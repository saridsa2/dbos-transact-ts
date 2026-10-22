# Stack Proc workspace intelligence and domain ontology

Status: proposed specification for review, 2026-10-19. The product direction is agreed; the contracts, screens and delivery boundaries below are recommendations. This document does not claim that ontology authoring, document ingestion or workflow generation is implemented. No application behavior changes are part of this specification.

Implementation planning: [code-grounded technical design](workspace-intelligence-technical.md).

## 1. Product intent

Stack Proc adapts to a customer's domain through a workspace-owned ontology and process knowledge. The workspace agent helps users develop that knowledge from documents and conversation, then turns reviewed intent into workflows and agents using registered capabilities.

A user can begin with a process document rather than a blank canvas or a completed ontology. The agent proposes concepts and process steps, identifies ambiguities, helps select connections, and creates an editable workflow draft. Users can also author the knowledge and workflows directly.

The central journey is:

**Import process documents → review domain and process understanding → resolve gaps → generate a workflow or agent draft → configure, test and publish for execution.**

The existing hybrid model remains authoritative:

- Stack Proc owns the authoring model: atomic operation definitions, typed inputs and outputs, Fixed/Expression fields, explicit graph control structures and scoped variables.
- DBOS provides durable execution, retries, schedules, queues, messages and recovery through trusted adapters.
- An ontology concept is a business concept, not automatically a workflow node. A business process is a composition, not an atomic operation.
- A reasoning/tool loop is an inspectable agent workflow, not a research operation hidden inside a durable step.

This specification extends [atomic node abstraction](atomic-node-abstraction.md), [workflow authoring](workflow-authoring.md), [integration nodes](integration-nodes.md), [framework offerings](framework-nodes.md) and the [customer control plane](customer-control-plane.md). It does not replace their execution or authorization contracts.

## 2. Separate the knowledge layers

| Layer                     | Answers                                                                         | Example                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Domain ontology           | What concepts exist, what properties do they have, and how are they related?    | An Invoice has an amount and currency; it references a Supplier and may reference a Purchase Order. |
| Process definition        | What should happen, in what order, under which conditions and responsibilities? | Validate an invoice; request approval when a policy requires it; handle a missing purchase order.   |
| Capability bindings       | Which executable operations and systems can perform the required work?          | Find the purchase order using a registered query operation and a workspace connection.              |
| Workflow/agent definition | How is this specific automation implemented?                                    | Typed nodes, expressions, routes, durable waits, approved agent tools and resource references.      |
| Execution evidence        | What happened in a particular invocation?                                       | Input, selected route, approval response, adapter version and node results.                         |

The ontology supplies reusable meaning and structural constraints. Operational policies, thresholds, routing, escalation and timeouts belong to versioned process definitions. Bindings map domain properties to provider data without changing the meaning of the ontology.

An ontology is initially a model of entity types and relationships. It does not imply storing all customer business records in a new graph database. Authoritative records may remain in customer systems; record retrieval occurs through authorized bindings.

## 3. Intended user experience

The workspace agent is the entry point for assisted building. It maintains a resumable task tied to specific documents, knowledge revisions and draft artifacts. Chat supports the work; structured artifacts remain inspectable and editable outside the transcript.

Example conversation:

1. User imports an invoice-handling procedure and asks to automate it.
2. Agent proposes Invoice, Supplier and Purchase Order concepts, with source references.
3. Agent presents the process separately: receive, validate, look up an order, evaluate a condition, request approval, record the outcome.
4. Agent asks only unresolved questions: which system owns purchase orders, which currency the threshold uses, and how approvers are chosen.
5. User reviews the proposed knowledge and chooses an authorized connection.
6. Agent generates a workflow draft with explicit bindings and marks unsupported operations as unresolved requirements.
7. User inspects Input / Process / Output, tests with chosen data and reviews the execution trace.

The agent must explain generated behavior in business language and link it to nodes. It must be possible to answer “Where is this value set?” by tracing the input, variable initialization and subsequent writes. A value of 9 replaced by 3 must be explainable as an explicit assignment, not concealed by the generated graph.

Users may pause at any stage. A partial ontology or process is valid as a draft. Missing knowledge blocks only the affected generation or execution requirement; a workspace-wide complete ontology is not a prerequisite.

## 4. Domain ontology contract

A workspace may contain multiple domain modules. References use stable IDs and pinned versions; names and descriptions can change without silently retargeting references.

| Element               | Minimum proposed content                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| Module                | Workspace ID, stable ID, name, description, revision, lifecycle and provenance                     |
| Entity type           | Stable ID, business name, description, aliases, properties and optional parent type                |
| Property              | Stable ID, name, type, requiredness, constraints and semantic annotations such as currency or unit |
| Relationship          | Stable ID, name, source/target entity types, direction and cardinality                             |
| Structural constraint | Versioned, machine-checkable constraint with a supported evaluator                                 |
| Provenance            | Source revision and locator, user declaration, imported standard or inference                      |

Initial property types map to the existing JSON-schema-compatible authoring types: string, number, integer, boolean, object and array; absence/nullability is explicit. Dates, identifiers, money and units need semantic annotations and validation rather than display labels alone.

Inheritance and cardinality need defined validation semantics. The first slice may expose only the supported subset; it must not claim complete OWL reasoning. Imported constructs that cannot be represented are reported and their original source retained.

Lifecycle: draft → reviewed → published → superseded or archived. “Reviewed” records a human decision and its scope; publication creates an immutable usable revision. Edits produce a new draft. Existing workflows remain pinned to the revision they used.

A module can be proposed by an agent, imported, or authored manually. The agent should reuse existing concepts when meanings match and propose a merge when uncertain. Similar names alone do not justify merging concepts.

## 5. Process knowledge contract

A process definition is a business-level model that can exist before an executable graph is available.

Required elements:

- Purpose, expected outcome, business owner and applicability.
- Invocation requirements: what initiates the process and what data it receives.
- Typed inputs and outputs linked to domain concepts where applicable.
- Atomic business actions, ordering and dependencies.
- Decisions with explicit predicates, branches and default behavior.
- Repetition and concurrency as explicit process structures.
- Human responsibilities, required decisions, escalation and timeout behavior.
- Exceptional outcomes, recovery/compensation requirements and completion criteria.
- Policy parameters, source evidence, unresolved questions and assumptions.

A business action is a request for a capability. It is not executable until mapped to a supported operation or explicit workflow composition. “Research a supplier” may become a sub-process or agent definition; it does not become a new atomic research node.

Responsibilities such as “finance manager” remain business roles until bound to an authorized identity/group or resolution mechanism. The agent must not invent a user or treat a role label as an access grant.

Where a document contains conflicting procedures or omits a threshold, the model retains the conflict or gap. The agent must not turn a plausible guess into a published policy.

## 6. Source documents and evidence

Each import creates an immutable source revision with workspace ownership, original name, media type, content hash, ingestion status and extracted content references. Re-importing a changed document creates a new revision; previous evidence remains resolvable.

Extraction should preserve headings, paragraph/table structure and page locators when available. A citation points to a source revision and a stable content block; page/section labels are presentation aids. Unavailable page coordinates must not be fabricated.

Every proposed assertion or process element records one or more of:

- Source-backed evidence with a resolvable locator.
- A user-authored statement or explicit confirmation.
- An agent inference, visibly labelled and awaiting review where it affects behavior.

Evidence status and approval status are separate. User confirmation is not rewritten as a document quotation. A confidence score cannot substitute for evidence or resolve contradictions.

Initial format proposal: plain text, Markdown, DOCX and text-based PDF. Scanned PDFs, images and unreadable content report that OCR is required; they must not produce an empty successful import. Embedded diagrams and complex tables that cannot be interpreted reliably become review items. OCR and visual process-diagram interpretation are later adapters.

Documents supply untrusted source content. Instructions inside them do not grant the workspace agent tools, connection access or execution authority. Extraction and generation use bounded, authenticated server tasks. Source retention and deletion must account for citations and audit policy; the retention policy is an open deployment decision.

## 7. Capability bindings and compilation

A binding connects a reviewed business action to a versioned registered offering. It includes:

- Business action ID and relevant ontology/property references.
- Offering ID/version and supported execution adapter/version.
- Compatible workspace connection reference; no credential material.
- Input mappings, output mappings and explicit transformations.
- Named outcomes and their process routes.
- Retry, timeout, idempotency and effect semantics supported by the offering.
- Binding validation results and unresolved requirements.

The agent searches the trusted operation catalog and checks actual adapter availability. A catalog definition without an installed execution adapter is not executable. Missing capabilities produce a requirements list, not invented node IDs or simulated success.

Domain-to-provider mappings must validate type, cardinality, units, enums, missing values and conversion rules. For example, a numeric amount cannot be compared across currencies without an explicit currency policy or conversion operation.

Generation emits the existing Stack Proc authoring representation. The ordinary compiler and validation path remain authoritative. The agent does not bypass the compiler, inject raw DBOS operation JSON into forms or install arbitrary adapters.

The generated draft includes a traceability map:

`source revision/block → process element → ontology references → node/control IDs → offering and binding versions`

A publishable snapshot pins the workflow, ontology, process, binding, offering and execution-policy revisions. Runtime resource resolution still checks current authorization and revocation; pinning a reference never revives revoked access.

## 8. Workspace agent contract

The workspace agent is a workspace-scoped authoring agent. Customer-built operational agents are separate generated artifacts with their own instructions, tools and execution policy.

Proposed authoring tools:

| Tool family | Responsibility                                                                         |
| ----------- | -------------------------------------------------------------------------------------- |
| Discover    | Read authorized sources, published knowledge, workflows and available capabilities     |
| Extract     | Produce evidence-linked ontology and process proposals                                 |
| Clarify     | Record questions, user answers, assumptions and conflicts                              |
| Propose     | Create versioned changes to knowledge, bindings, workflow drafts and agent definitions |
| Validate    | Run structural, scope, type, binding and compilation checks                            |
| Preview     | Explain planned execution and evaluate supported pure previews                         |
| Test        | Invoke an explicitly selected test with concrete inputs and declared effects           |

The agent operates on structured changes with base revisions. Applying a proposal is atomic for its affected artifacts; stale revisions produce a conflict that requires rebase/review. A failed generation must not overwrite the last valid draft.

The conversation stores task context, decisions and artifact references. A document index supports retrieval; accepted, versioned records are the durable knowledge authority. Prompt text and embedding similarity alone are insufficient to define business semantics.

The agent uses the existing model connection and credential-adapter contracts. Model provider, model revision and agent-policy version are recorded for a generation task. No provider is hardcoded into the product specification.

Authority is bounded by the initiating user, workspace role, selected resources and task policy. An owner starting a task does not grant an operational agent permanent owner authority. Authorization is rechecked when tools execute and when a paused task resumes.

Proposed default interaction policy: extraction and draft proposals can run within the requested task; applying reviewed knowledge, publishing, starting effectful tests and enabling schedules have explicit user-facing actions. Existing product permissions remain the server authority. These are proposed product controls, not a claim that every chat message needs approval.

Generated agents declare purpose, typed input/output, domain/process references, permitted tools, model connection, limits, stopping conditions and escalation. Model calls and tool invocations retain distinct durable boundaries and traces. Generating an agent does not grant unrestricted code, network or workspace access.

## 9. Durable authoring task lifecycle

Proposed states:

`created → ingesting → analyzing → needs clarification → proposing → validating → ready for review → applied`

Failed, cancelled and superseded are explicit terminal states. Clarification and review can pause without keeping a model request open. Resuming uses the recorded task state and reviewed answers.

Use DBOS workflows for long-running authoring tasks: checkpoint extraction and model-call results at supported boundaries, wait durably for user answers, and resume without reapplying completed artifact changes. External calls can still have an uncertain outcome after interruption; retries require adapter-specific semantics rather than an exactly-once promise.

Artifact application uses an idempotency key and database transaction. Cancelling a task stops future work and preserves evidence/drafts already created; it does not silently undo accepted knowledge. A retry records a new attempt and preserves the previous failure.

Reuse workspace SSE for ingestion progress, clarification requests, draft readiness and errors, with task IDs and replay cursors. Stream bounded, redacted status rather than secrets, complete document bodies or private model reasoning. Expose concise explanations and tool evidence, not hidden chain-of-thought.

## 10. Persistence and service boundaries

Use the existing workspace-scoped Postgres foundation first. Introduce a graph database only if validated query or reasoning requirements justify it.

Logical records, not final SQL table names:

- Source documents, immutable source revisions and extracted blocks.
- Ontology modules, immutable published revisions and editable drafts.
- Process definitions/revisions and policy parameters.
- Evidence links, unresolved issues, review decisions and supersession links.
- Capability-binding revisions and validation reports.
- Workspace-agent tasks, messages, attempts, proposals and idempotent applications.
- Generation manifests linking knowledge revisions to workflow/agent drafts.

All record references and reads must be checked within the authenticated workspace. Source retrieval, search indexes, embeddings and background tasks inherit the same ownership. Any future sharing between workspaces is explicit and versioned; it is not implicit tenant-wide visibility.

API families should cover source intake/status, knowledge draft/review/publish, process authoring, bindings, agent-task continuation and proposal application. Exact endpoints and SQL migrations are a follow-up implementation design. Add no public runtime API solely to make the prototype easier.

## 11. UI surfaces

Follow the Stack Proc work-area skill, official Untitled UI components, Font Awesome Pro, Geist typography and square controls. Admin pages have one task header, aligned actions/search, tabs immediately below it and one bounded content viewport. Table actions are icons. Preserve the fullscreen workflow builder and its established node dialog.

Proposed information architecture:

| Surface               | Task and primary content                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Knowledge             | Manage ontology modules and process definitions through related tabs; view revision and review status             |
| Sources               | Import documents, inspect extraction status and follow citations to source content                                |
| Workspace agent       | Continue an authoring task, answer questions and review structured proposals alongside conversation               |
| Ontology editor       | Inspect entities, properties, relationships and validation; graph and accessible structured views share one model |
| Process editor/review | Review steps, decisions, roles, policies, evidence and unresolved gaps                                            |
| Workflow editor       | Refine the generated executable draft, map fields, test and inspect results                                       |

Conversation must not be the only way to inspect or correct an artifact. A user can edit a property or process step directly and see the agent's next proposal account for that revision.

Selecting a source citation opens the relevant source content. Selecting a generated step opens its corresponding node/control. Errors name the affected business element and provide a path to its editable field, rather than displaying only internal JSON paths.

Do not introduce competing workflow editors or a mandatory ontology wizard before users can use the existing builder. Ontology editing may use a dedicated graph workspace; ontology relationships and workflow edges retain distinct meanings and visual labeling.

## 12. First delivery slice

Use one invoice-handling document as an illustrative acceptance fixture. The implementation must not contain invoice-specific branches in its generic extraction, ontology, binding or generation contracts.

Deliver in dependency order:

1. **Contracts and fixtures:** source/evidence, ontology, process, binding, proposal and generation-manifest schemas; lifecycle/validation; one invoice fixture and one unrelated-domain fixture.
2. **Knowledge authoring:** workspace-scoped persistence, manual ontology/process editing, revision review and source references. Manual authoring must work before AI connectivity is configured.
3. **Document-assisted understanding:** bounded ingestion, model-adapter extraction, source-backed proposals and resumable clarification/review.
4. **Workflow generation:** map one reviewed process to the real catalog, validate bindings, create an ordinary editable workflow draft and retain traceability. Unsupported operations remain explicit blockers.
5. **Execution proof:** test a fully bound workflow through DBOS, restart during a durable wait, and explain resulting data and decisions using the recorded evidence.
6. **Agent generation:** add one bounded, inspectable operational-agent composition after model/tool adapters support the required durable boundaries.

The first usable increment is a user importing a document, correcting proposed concepts/process logic, and obtaining a valid editable workflow draft. It does not require a universal reasoner, a domain marketplace or support for every provider.

Use deterministic extraction/model fixtures for repeatable tests, clearly distinguished from a live connected model. A live demonstration must use a configured workspace model connection and executable adapters. Credentials are deployment prerequisites, not part of documents or specifications.

## 13. Acceptance criteria

- The same contracts support invoice handling and a second domain without domain-specific editor/runtime branches.
- A user can begin from a document, from an existing ontology, or through manual authoring.
- Every proposed behavior is traceable to source evidence, a user decision or a visible unconfirmed assumption.
- Contradictory or missing policies are surfaced; the agent cannot silently invent a threshold, approver or integration.
- Renaming a concept preserves stable references. Changing its type creates an impact report for affected bindings and workflow drafts.
- Generated graphs use supported atomic offerings and explicit control structures; agent loops remain inspectable.
- Missing adapters/connections prevent executable status while allowing an incomplete draft to be saved.
- Published knowledge changes do not silently change existing saved workflows or run snapshots. Upgrades are proposed as reviewed diffs.
- Applying a stale proposal cannot overwrite newer user edits; applying the same proposal twice creates no duplicate artifact.
- Authorization is enforced for source retrieval, agent tools, publication, testing and resumed tasks; cross-workspace identifiers do not expose data.
- No credentials appear in knowledge records, prompts assembled from connection metadata, graph JSON, SSE payloads or audit details.
- Interrupted ingestion/generation resumes from recorded progress; a completed draft application is not repeated after restart.
- A user can trace an output value back to its input and explicit variable writes, including the factor-9-overwritten-by-3 example.
- All admin screens preserve header/actions, tabs and bounded scrolling; the existing canvas remains fullscreen.

## 14. Decisions to settle before implementation

| Decision                      | Recommendation for the first slice                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First customer domain/process | Choose one real, representative document; invoice handling remains an example until selected.                                                                       |
| Ontology representation       | Versioned internal model compatible with typed authoring contracts; preserve stable semantic IDs and provenance. Specify RDF/OWL import/export profiles separately. |
| Ontology reuse                | Reuse reviewed workspace concepts; propose additions and merges. Offer templates later without making a template mandatory.                                         |
| Storage/reasoning             | Postgres plus bounded typed graph validation first; advanced OWL inference and instance graph queries are later requirements.                                       |
| Document support              | Text/Markdown, DOCX and searchable PDF; explicit unsupported/OCR-required states.                                                                                   |
| Model/provider                | Existing workspace model connection through an adapter; choose the first executable provider during implementation planning.                                        |
| User review                   | Structured proposals and explicit publish/apply/test actions; avoid requiring review for every individual extracted sentence.                                       |
| Source retention              | Define workspace retention and citation behavior before handling production customer documents.                                                                     |
| Capability gap                | Record a missing integration requirement; never represent it as an installed executable node.                                                                       |

## 15. Reference and boundaries

[Microsoft Ontology Playground](https://github.com/microsoft/Ontology-Playground) is a reference for ontology visualization, typed entities/properties, relationships, validation, reusable domain examples and import/export. Its supported visual ontology model should not be mistaken for a complete reasoning engine or for Stack Proc's executable process model.

Inspect its exact source/model and license before reusing code. No dependency, framework adoption or code reuse is selected by this specification. Stack Proc retains its own UI system, workspace authorization, knowledge lifecycle and DBOS-backed execution.

Out of the first slice: automatic deployment from arbitrary documents, unrestricted agent tool access, a complete enterprise ontology, universal OCR, full OWL reasoning, storing all business records in a graph database, autonomous production schedule activation, and new provider execution engines solely for this feature.
