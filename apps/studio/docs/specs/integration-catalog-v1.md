# Integration catalog v1

## Status and boundary

The first eight operation definitions live in `lib/integrations/catalog.ts`, with the shared node, validation and compilation contract in `lib/integrations/model.ts`. The authenticated discovery endpoint is `GET /api/integrations/catalog`. Every descriptor is marked `implementation: defined`; none is advertised as a live adapter or added as an executable palette card yet.

Integrations connect workflows and agents to services and data. Vercel AI, CrewAI and other agent/framework runners remain in the separate framework specification. Account/customer management remains in the control plane.

## Initial operations

| Offering            | Connection              | Parameters                                                                    | Result                                                         | DBOS boundary                    |
| ------------------- | ----------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------- |
| `http.request@1`    | HTTP service            | Method, relative path, query, approved non-secret headers, optional JSON body | Status, response headers, JSON/text body                       | Step                             |
| `mcp.tools.list@1`  | MCP server              | Optional cursor                                                               | Tool names, descriptions and input/output schemas, next cursor | Step                             |
| `mcp.tool.call@1`   | MCP server              | Tool name, pinned schema fingerprint, arguments                               | Normalized MCP content, structured content and error flag      | Step                             |
| `postgres.query@1`  | Postgres                | Parameterized SQL, values, maximum rows                                       | Rows and row count                                             | Read-only datasource transaction |
| `azure.blob.list@1` | Azure service principal | Account, container, prefix, cursor, limit                                     | Object metadata and next cursor                                | Step                             |
| `azure.blob.read@1` | Azure service principal | Account, container, key, optional ETag, byte limit                            | Private immutable artifact reference and ETag                  | Step                             |
| `aws.s3.list@1`     | AWS STS                 | Bucket, prefix, cursor, limit                                                 | Object metadata and next cursor                                | Step                             |
| `aws.s3.read@1`     | AWS STS                 | Bucket, key, optional version, byte limit                                     | Private immutable artifact reference, ETag/version             | Step                             |

A read returns an artifact identifier, media type and size rather than checkpointing file bytes or credential-bearing download URLs. Lists return one bounded page; a graph can explicitly loop over the continuation cursor. Azure and S3 adapters normalize their provider-specific listing responses to this common envelope. Provider behavior references: [Azure List Blobs](https://learn.microsoft.com/en-us/rest/api/storageservices/list-blobs) and [S3 ListObjectsV2](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html).

## Node abstraction

A graph stores an operation ID/version, connection ID/revision, parameter bindings and bounded policy. It stores no credential, tenant override, adapter implementation or model-provider key.

```json
{
  "operation": { "id": "http.request", "version": 1 },
  "connection": { "id": "customer-api", "revision": 2 },
  "parameters": {
    "source": "object",
    "fields": {
      "method": { "source": "literal", "value": "GET" },
      "path": { "source": "literal", "value": "/documents" }
    }
  },
  "policy": { "timeoutMS": 30000, "maxAttempts": 1 }
}
```

The operation definition supplies integration/resource/action labels, input/output schemas, connection compatibility, execution boundary, side-effect classification, pagination and adapter dependencies. Forms and agent tool schemas derive from it. Tool definitions expose parameters; connection and policy bindings remain in the authorized agent configuration, outside model-generated tool arguments.

An installed adapter permits compilation into the existing native `step` or `transaction` representation using the versioned `integration.dispatch.v1` handler. The compilation gate rejects missing adapters. The future dispatcher must validate connection membership, status, revision and provider type; resolve parameter bindings; validate parameters; obtain credentials through the broker; enforce policy; and validate/redact output. Canvas and agent-tool calls share that same dispatcher. The current code defines and tests this contract; it does not register or implement the dispatcher.

## Policy and provider requirements

Defaults are a 30-second timeout and one attempt, capped at five minutes and five attempts. JSON results are bounded to 4 MiB. Artifact reads have separate byte limits. Connections provide authorization; the HTTP parameter schema rejects origin overrides and authentication headers. The transport must enforce endpoint/redirect/network policy and redact response credentials before checkpointing.

Read retries are permitted. A mutation retry requires both a stable idempotency key and trusted, invocation-specific adapter confirmation that the target honors it. Supplying an arbitrary key alone never enables mutation retries. MCP tool calls are conservatively treated as potentially side-effecting; discovered schemas must match the pinned fingerprint before execution. [MCP tool discovery and calls](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) inform that adapter contract.

Postgres queries must use an external datasource and database-enforced read-only transactions, bounded time/rows and parameter binding. Do not infer read-only behavior from a SQL text prefix or reuse the control plane database connection. See [Postgres transaction modes](https://www.postgresql.org/docs/current/sql-set-transaction.html).

Azure Blob requires token exchange and appropriate storage permissions; S3 requires a working temporary-credential resolver. Artifact operations require a private artifact store with workspace-scoped reads. These dependencies are explicit in each descriptor and must be satisfied before the adapter becomes available.

## Delivery order

1. Implement the HTTP dispatcher as the first end-to-end slice: connection picker, schema-driven inspector, input bindings, bounded transport, durable execution, audited result and recovery. Verify against a local fixture server before a real customer endpoint.
2. Add MCP discovery, pinned tool schemas and shared canvas/agent invocation.
3. Add the external read-only Postgres datasource.
4. Add Azure Blob and S3 after credential exchange and private artifacts are ready.
5. Define provider event/webhook ingress, service-specific writes and model-service operations separately. A trigger must authenticate the source, deduplicate its external event ID and durably enqueue before acknowledging receipt. Framework runners continue under their own specification.

Acceptance includes schema validation, cross-workspace denial, revoked/stale connection rejection, missing-adapter rejection, canvas/tool schema parity, bounded pagination/results, mutation retry controls, redacted errors and restart recovery. Definition/contract tests are present now; live adapter and recovery tests belong to each implementation slice.
