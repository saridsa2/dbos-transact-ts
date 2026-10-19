# External integration nodes

## Scope

Build service and data-source nodes inspired by n8n's configurable integration experience. The same operation definition should run as a standalone canvas node or as a tool exposed to an agent. Connections and credentials belong to the customer control plane.

## Node experience

A user chooses an integration, resource and operation, selects a compatible workspace connection, then fills validated parameters and binds upstream data. The inspector presents service-specific fields and dynamic choices where supported. It shows configured, unverified, missing-adapter, revoked and unavailable-connection states accurately.

Initial service families can include HTTP, MCP, model services, Microsoft Foundry capabilities and database/data-source operations. A saved connection alone does not imply the corresponding operation adapter exists or that live access has been verified.

## Operation definition

An operation declares ID/version, integration, resource, action/trigger mode, input/output/configuration JSON Schemas, compatible connection types, named outcomes, runtime boundary, idempotency behavior and supported retry/timeout policies. Dynamic option discovery runs server-side through the selected authorized connection. Forms and agent tool schemas derive from the same definition.

Action adapters execute external requests as durable steps. Transaction adapters preserve datasource boundaries. Workflow and long-running service operations use explicit workflow/remote execution contracts. Provider-specific triggers verify incoming requests and map external event IDs to deduplicated invocations before acknowledging durable dispatch.

## Credential and audit behavior

Workers resolve credentials through the control plane broker using workspace/connection/revision context. Credentials remain outside graph JSON, DBOS step outputs, tool results and browser streams. AWS STS credentials retain expiry and are renewed through the resolver rather than stored as permanent keys.

Record operation/adapter version, connection reference/revision, actor or parent execution, status, duration and redacted error information. User-facing run traces correlate integration calls with their parent graph and agent tool call. Access revocation and missing revisions must produce explicit errors.

## Delivery sequence

Start with one live vertical slice after the control plane and offering registry are ready: create a connection, select an operation, bind inputs, execute and recover, and inspect an audited result. Expand to dynamic discovery, additional services and provider triggers after this contract is proven. Avoid disconnected palette cards or simulated provider success in the shipped application.

Acceptance covers form/schema validation, standalone/tool parity, workspace isolation, credential resolution/expiry, retry/idempotency behavior, redacted failures, recovery and truthful connection/adapter status.

## First definitions

The [v1 catalog and node contract](integration-catalog-v1.md) now specifies eight operations across HTTP, MCP, Postgres, Azure Blob and S3. Typed schemas, connection compatibility, bindings, policies, agent-tool schema derivation and adapter availability checks are implemented in `lib/integrations/`. Provider execution adapters follow next, starting with HTTP.
