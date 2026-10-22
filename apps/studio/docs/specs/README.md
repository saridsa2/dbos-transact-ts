> **AI frontend status — 2026-10-20:** Existing AI surfaces have been retired for a fresh design; the backend remains intact. See [AI surface reset](ai-surface-reset.md). Earlier AI UI specifications below are historical.

# Product specifications

[Long history with Mem0](long-history-mem0-technical.md) maps reviewed Mastra observation/reflection algorithms onto the owned harness and DBOS, with Mem0 OSS for approved recall. It specifies bounded history ingestion, hierarchical checkpoints, encryption and authorization, replay safety, adapter compatibility gates and delivery slices. Status: opt-in implementation delivered; includes the Mem0 adapter patch, verification and deployment boundaries.

[Workspace agent setup and specialist coordination](workspace-agent-lifecycle.md) defines the agreed setup-agent → reviewed workspace-agent → suggested-work → specialist-assignment lifecycle, reusable agent revisions, library component composition, policy boundaries and delivery slices. Status: proposed implementation specification; no application implementation or agent activation in this pass.

[Workspace agent lifecycle technical specification](workspace-agent-lifecycle-technical.md) defines the implementation contracts: versioned definitions and snapshots, additive storage, atomic publication/setup activation/assignment commands, actor and resource authorization, harness integration, channel routing, aggregate budgets, library adapters and rollout/test gates. Status: technical specification; documentation only.

Build the customer control plane first, then framework execution and external integration nodes. Connections and customer/workspace authorization form the shared contracts. Keep the existing StackProc canvas and DBOS execution model.

| Specification                                                      | Scope                                                                               | Current stage                                                                         |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [Customer control plane](customer-control-plane.md)                | Customer/user onboarding, workspaces, people, connections, credentials and auditing | First local slice implemented                                                         |
| [Identity federation and credential exchange](identity-and-sts.md) | Replaceable sign-in adapters and AWS STS credential resolvers                       | Adapter contracts implemented; enterprise/provider deployments supply implementations |
| [Framework nodes](framework-nodes.md)                              | Vercel AI, CrewAI and related agent execution offerings                             | Specified; adapters follow the control plane                                          |
| [Integration nodes](integration-nodes.md)                          | External service operations and data sources, inspired by n8n                       | Specified; adapters follow the control plane                                          |

[Workspace intelligence and domain ontology](workspace-intelligence.md) specifies the next proposed product layer: document-backed ontology and process knowledge, workspace-agent proposals, capability bindings and generation of ordinary Stack Proc workflows and agents. Status: product direction specified; a first MiniMax-backed foundation is implemented (see implementation notes). The first delivery slice proves one document-to-workflow journey while keeping the contracts independent of domain.

The initial control plane remains bound to loopback and uses a clearly labelled development identity adapter. Existing local workflows/history remain in their original workspace until explicitly adopted during customer onboarding. No customer data is deleted or automatically assigned to a test identity.

The next milestones are a selected enterprise identity adapter and temporary credential resolver, then a first live provider integration using the connection contract. Billing, global platform administration and provider-specific node execution are separate increments.

The first [integration catalog](integration-catalog-v1.md) contains eight versioned definitions and shared canvas/tool schemas. Live adapters are the next implementation slice.

[Workflow authoring](workflow-authoring.md) records the agreed direction: explicit iteration, scoped state with explicit merges, and separate code capability profiles. The [implementation gap assessment](workflow-authoring-gap-assessment.md) distinguishes reusable foundations from changes needed before the target experience is complete.

The [node-editor interaction design](node-editor-interactions.md) and [review fixtures](examples/node-editor-review.json) make the authoring proposal concrete before application changes.

[Workspace intelligence technical design](workspace-intelligence-technical.md) maps the current code to the proposed knowledge/task services, revision and evidence storage, model/extraction adapters, DBOS task protocol, APIs, UI integration and staged verification. Status: proposed target architecture, based on a source review; implementation notes distinguish delivered foundations from deferred capabilities.

[Workspace intelligence implementation notes](workspace-intelligence-implementation-notes.md) records the delivered MiniMax-backed foundation, its supported document/process path and explicit deferred capabilities.

[Ambient workspace agent harness](workspace-agent-harness.md) defines the revised intelligence architecture: persistent sessions and work items, event-driven coordination, scoped memory and tools, MiniMax reasoning, DBOS recovery, reviewed change sets, RDF import, and Harness²-inspired evaluation. Status: proposed implementation specification; this supersedes task-centric orchestration as the target while retaining existing knowledge and compiler contracts.

[Workspace agent harness technical specification](workspace-agent-harness-technical.md) translates the ambient architecture into migration/table contracts, TypeScript interfaces, transaction-aware service refactors, DBOS activation/fencing, MiniMax tool continuation, RDF parser/import identity services, API/UI contracts and implementation test gates. Status: implementation specification; no runtime enablement implied.

[Workspace agent interactive interface](workspace-agent-interface.md) specifies the reusable agent surface: typed rich message parts, trusted dynamic controls, durable structured responses, reviewed changes, resumable presentation events and a staged migration from the current text-only dock. Status: proposed implementation contract; preserves MiniMax, DBOS and Untitled UI.

[Standalone workspace harness port](workspace-harness-port.md) is the active runtime implementation contract, superseding the Harness2 runtime requirement. It records the supplied-source audit, owned lifecycle port, MiniMax boundary, DBOS receipts, truthful provenance and deferred capabilities.

[Tool builder and developer CLI](tool-builder-and-cli.md) specifies code-first workspace tool authoring, portable packages, local and remote testing, developer-machine uploads, adapter-based authentication, publication and durable execution. Status: first pure-code browser/CLI release implemented; [implementation notes](tool-builder-implementation.md) record installation, verification and remaining capabilities.

[Visual process composer with agent activities](visual-process-composer.md) proposes a BPMN-inspired business canvas with human/system/agent work, responsibility lanes, typed outcomes, structured routing, inspectable agent subprocesses, Process v2 migration and compilation into the existing DBOS-backed workflow runtime. Status: specification for review; supersedes the process form as the primary authoring experience.

[Shared workflow editor for visual process authoring](process-editor-technical.md) specifies extraction of the current custom workflow canvas into a shared editor with typed workflow/process adapters, process v2 storage and migration, configuration reuse, compile preview/commit, manifest-based execution overlays and phased regression gates. Status: technical specification for review; no implementation changes implied.

[Visual process editor implementation](process-editor-implementation.md) records the delivered shared-canvas linear process slice, its verification, and the remaining structured-control, agent-runtime and compilation-lifecycle work.

[Diagram editor adapters](diagram-editor-adapters.md) records the implemented separate domain renderers and shared command boundary for workflow and process editing, including structured swimlane behavior.

[Multi-cloud identity and execution](multicloud-identity-and-execution.md) specifies the shared identity/session, customer trust, execution principal and credential broker layers for Azure and AWS. Status: proposed; provider adapters and cloud deployment are not activated. MiniMax enablement is a separate product defect (#3).
