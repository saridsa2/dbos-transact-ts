# Product specifications

Build the customer control plane first, then framework execution and external integration nodes. Connections and customer/workspace authorization form the shared contracts. Keep the existing StackProc canvas and DBOS execution model.

| Specification                                                      | Scope                                                                               | Current stage                                                                         |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [Customer control plane](customer-control-plane.md)                | Customer/user onboarding, workspaces, people, connections, credentials and auditing | First local slice implemented                                                         |
| [Identity federation and credential exchange](identity-and-sts.md) | Replaceable sign-in adapters and AWS STS credential resolvers                       | Adapter contracts implemented; enterprise/provider deployments supply implementations |
| [Framework nodes](framework-nodes.md)                              | Vercel AI, CrewAI and related agent execution offerings                             | Specified; adapters follow the control plane                                          |
| [Integration nodes](integration-nodes.md)                          | External service operations and data sources, inspired by n8n                       | Specified; adapters follow the control plane                                          |

The initial control plane remains bound to loopback and uses a clearly labelled development identity adapter. Existing local workflows/history remain in their original workspace until explicitly adopted during customer onboarding. No customer data is deleted or automatically assigned to a test identity.

The next milestones are a selected enterprise identity adapter and temporary credential resolver, then a first live provider integration using the connection contract. Billing, global platform administration and provider-specific node execution are separate increments.

The first [integration catalog](integration-catalog-v1.md) contains eight versioned definitions and shared canvas/tool schemas. Live adapters are the next implementation slice.

[Workflow authoring](workflow-authoring.md) records the agreed direction: explicit iteration, scoped state with explicit merges, and separate code capability profiles. The [implementation gap assessment](workflow-authoring-gap-assessment.md) distinguishes reusable foundations from changes needed before the target experience is complete.

The [node-editor interaction design](node-editor-interactions.md) and [review fixtures](examples/node-editor-review.json) make the authoring proposal concrete before application changes.
