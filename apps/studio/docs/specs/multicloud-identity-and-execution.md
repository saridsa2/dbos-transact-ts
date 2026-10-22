# Azure and AWS identity and execution adapters

Status: proposed technical design, 2026-10-20. No cloud adapter, tenant registration, permissions, migration or live-provider configuration has been activated. The MiniMax enablement defect is tracked separately as GitHub issue #3 and is not part of this implementation.

## Scope and architecture

Support Entra sign-in and Azure execution credentials, and the equivalent AWS execution path, on the existing Stack Proc control plane and DBOS runtime. Stack Proc remains local for the first delivery. Deployment to Azure/AWS, provisioning external users through Graph/Cognito, SCIM, and automatic cloud resource provisioning are separate scopes.

Authentication provider and execution provider are independent. An Entra-authenticated user can execute an authorized AWS operation; an OIDC-authenticated user can execute an Azure operation. A workspace can own both cloud connections. Neither deployment location nor the user's current browser login selects a worker identity.

```
Browser → trusted identity provider → Stack Proc session
                                      ↓
                           customer / workspace membership
                                      ↓
                 process compilation → pinned DBOS execution
                                      ↓
                         current principal authorization
                                      ↓
                workspace credential broker → provider adapter
                     ↙                          ↘
          Azure access token             AWS STS session
                     ↘                          ↙
                       bounded operation result
```

## Codebase findings and reuse

| Existing code                                    | Present behavior                                                                                        | Required extension                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `server/control/auth.ts`                         | Replaceable AuthAdapter; validated Identity; optional login URL and `/api/auth/*` handler               | OIDC lifecycle, durable one-use callbacks, logout and provider trust configuration                |
| `server/control/service.ts`                      | Users keyed by issuer/subject; DB memberships authorize roles; local sessions; onboard/invite/accept    | Shared enterprise sessions, identity linkage, tenant-to-customer bindings and invitation proof    |
| `server/control/schema.sql`                      | Users, sessions, customers, workspaces, memberships, invitations, connections, audit                    | Additive identity/transaction/session-policy and trust records                                    |
| `lib/control/contracts.ts`                       | Azure client-secret metadata and AWS STS role metadata                                                  | Versioned credential modes, resource restrictions and connection readiness                        |
| `ControlPlane.resolveCredential()`               | Workspace/status/revision checks; encrypted static credentials; AWS-shaped temporary resolver interface | Provider-neutral broker facade with separate Azure and AWS credential types                       |
| `server/control/secrets.ts`                      | AES-GCM secrets bound to workspace/connection/version                                                   | Reuse; no separate plaintext token/key store                                                      |
| `server/http.ts`                                 | User-scoped run start, authenticated run APIs, adapter-owned auth routes                                | Callback/origin review; authenticated cloud connection verification; no token-returning route     |
| `server/store.ts`                                | Run workspace and actor attribution; child run inheritance and audit                                    | Explicit service principals for background runs and broker authorization from stored run identity |
| `server/native-runtime.ts`, `server/registry.ts` | Registered native steps/transactions and durable DBOS checkpoints                                       | Validated integration dispatcher, effective policy and checkpoint-safe cloud clients              |
| `lib/integrations/catalog.ts`, `model.ts`        | Versioned definitions, schemas, compile/authorization contracts                                         | Actual adapter installation, dispatch, credential exchange and bounded results                    |
| `server/agent/process-activity.ts`               | Process agent boundary already checks pinned workspace policy                                           | Reuse; cloud tools use the same dispatcher rather than a second execution path                    |

The Azure/Blob and AWS/S3 catalog entries are definitions, not installed provider clients. The shared `integration.dispatch.v1` target is specified but is not registered as a production dispatcher. Resolving that prerequisite is part of delivery, not evidence of an existing executable cloud integration.

The current auth adapter contract is one deployment-level adapter. Multi-customer provider selection therefore needs a trusted resolver/router, not one mutable global tenant setting. Existing custom auth modules must remain supported during transition.

## Upstream reuse assessment (official sources checked 2026-10-20)

DBOS already supplies the durability engine used by Stack Proc. It has also published AWS-specific libraries; the design must evaluate these before adding provider orchestration. Existence on npm is not evidence of current SDK support.

| Upstream asset                                                             | Verified scope/status                                                                                                                                                                      | Reuse decision                                                                                                                                                                                             |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@dbos-inc/aws-s3-workflows`                                               | Published 4.27.6; durable S3 upload/delete and database-record coordination through application callbacks                                                                                  | Review workflow patterns/source and license; require SDK compatibility and workspace credential boundaries before direct dependency reuse. Not a replacement for STS or customer authorization.            |
| `@dbos-inc/sqs-receive`                                                    | Published 4.27.6; receives messages and starts DBOS workflows; uses supplied SQS clients                                                                                                   | Reference for future ingress/deduplication. It does not implement the initial Blob/S3 list/read actions or sign-in.                                                                                        |
| `@dbos-inc/component-aws-s3`, `@dbos-inc/dbos-sqs`, `@dbos-inc/aws-config` | Older 2.10.24 packages remain published                                                                                                                                                    | Historical reference; do not install as if they were current integrations.                                                                                                                                 |
| Current DBOS Python S3Mirror example                                       | Uses boto3 inside DBOS steps/queues for resumable transfers                                                                                                                                | Reuse the demonstrated orchestration principles; do not introduce a Python worker merely to call S3 from this TypeScript application.                                                                      |
| DBOS Conductor OIDC tooling                                                | Operator/control-plane authentication is supported in the DBOS CLI ecosystem                                                                                                               | Evaluate only for Conductor operations; this does not provision Stack Proc customer sessions/memberships.                                                                                                  |
| Azure/Entra integration                                                    | No maintained first-party Azure Blob, Entra customer-login or Azure token-exchange adapter found in the official current package tree, docs tree and published package inventory inspected | Use official Azure/OIDC libraries behind Stack Proc boundaries unless a compatible upstream adapter is subsequently verified. This is a bounded search result, not a claim that no such code ever existed. |

Upstream removed `aws-s3-workflows` and `sqs-receive` from the main TypeScript repository on 2026-09-09 as part of its DBOS 5.0 cleanup of deprecated/undocumented auxiliary packages ([PR #1352](https://github.com/dbos-inc/dbos-transact-ts/pull/1352), [removal commit](https://github.com/dbos-inc/dbos-transact-ts/commit/be82b1f4ace6210ab02473e92c0add1464495b84)). The published 4.27.6 manifests use a broad SDK peer range, which is not a compatibility guarantee. The active local package tree likewise does not contain those auxiliary packages. Do not downgrade DBOS or restore removed runtime APIs just to reuse an old helper.

Reviewed pre-removal source: [S3 workflows README](https://github.com/dbos-inc/dbos-transact-ts/blob/17582dc9b2c905596eebbf25391042c39d0e0b71/packages/aws-s3-workflows/README.md), [SQS receiver README](https://github.com/dbos-inc/dbos-transact-ts/blob/17582dc9b2c905596eebbf25391042c39d0e0b71/packages/sqs-receive/README.md). Registry manifests: [S3](https://registry.npmjs.org/@dbos-inc%2faws-s3-workflows), [SQS](https://registry.npmjs.org/@dbos-inc%2fsqs-receive). Current official [S3Mirror example](https://docs.dbos.dev/python/examples/s3mirror).

Implementation rule: retain the existing DBOS engine and provider SDKs; reuse compatible upstream code/patterns with attribution, and build only the Stack Proc customer/workspace, policy, connection, broker and UI bridge. A reuse spike must exercise the actual local SDK, recovery behavior, credential renewal, callback semantics and no-token checkpoint requirement before selecting a direct dependency. No new package has been installed by this research.

## 1. Identity federation and customer onboarding

Use a maintained OIDC relying-party library for authorization-code flow with PKCE. Do not implement JWT verification, discovery or key rotation manually.

- Azure: allowlisted Entra tenant-specific issuers and registered confidential web client. Do not trust arbitrary `common` tenant responses as authorization to a workspace.
- AWS identity option: trusted Cognito user-pool OIDC/managed login, or an existing enterprise OIDC gateway. AWS STS is not the browser login provider. IAM Identity Center federation requires a separately verified compatible gateway/configuration; do not assume it exposes interchangeable Cognito behavior.
- The first Azure + AWS execution release can continue using Entra for all human login; Cognito login support is a separate provider profile on the same identity layer.
- Validate exact issuer/audience, signature/keys, expiry, nonce and state. Store PKCE verifier and nonce encrypted in a short-lived server transaction; bind it to an opaque browser cookie. Consume once, including failure paths. Reject replay, cross-browser state and unknown tenant.
- Pin callback and return URLs to configured origins. Never construct them from forwarded host headers. Use a GET/query callback with a narrowly scoped SameSite=Lax transaction cookie; application sessions remain opaque, HttpOnly and Secure on HTTPS. Local loopback HTTP is an explicit development configuration only.
- The shared session service issues and revokes local session records. Provider adapters do not each invent a session store. Initial sessions are bounded by validated identity/session policy; refresh/offline-access is not implicitly enabled.
- Local sign-out revokes the session. Provider logout is a separate intentional redirect where supported. Do not claim revoking a local cookie revokes a Microsoft/AWS identity-provider session.

Stable subject remains `(trusted issuer, sub)` for the OIDC app; Entra `tid/oid` may be retained as validated provider identifiers for explicit linking. Email/display name are profile fields, not membership keys. Do not merge the existing local QA identity with an Entra identity merely because the email matches.

Add explicit account linking that proves both sessions, or an audited administrator-reviewed migration. Preserve internal user IDs, memberships, run authors and ownership. Keep the local-development identity path available only in development; production continues to fail closed without enterprise auth and credential encryption configuration.

### Tenant and invitation handling

Add a versioned customer identity-provider binding with provider type, exact issuer, client ID/reference, allowed tenant, onboarding policy and activation state. Administrators configure trust; request-supplied email domains cannot create trust. A customer can bind more than one provider explicitly.

An unknown verified principal reaches onboarding or an invitation/approval screen, not an existing workspace selected by email/domain. New-customer creation and joining an existing customer remain distinct, audited actions. Onboarding allow/deny policy is explicit per deployment/customer.

The current `accept()` requires `emailVerified` for external identities. Entra does not guarantee a usable `email_verified` claim, and mutable email/UPN is insufficient evidence. Do not set `emailVerified=true` for all Microsoft accounts. Preserve the verified-email path when the provider actually proves it; otherwise require an invitation bound to an administrator-approved trusted subject or separate mailbox verification, then persist the verified invitation binding. Keep single use, expiry, intended workspace and role checks transactional. Provider group/role claims do not automatically assign owner/admin roles.

## 2. Execution principal

Persist a trusted execution envelope when a run is accepted:

```ts
type ExecutionAuthority = {
  workspaceId: string;
  actorId: string; // internal Stack Proc user/service principal
  actorKind: 'user' | 'service';
  authorizationRevision: number;
  runId: string;
  parentRunId?: string;
};
```

Populate it from the authenticated request or authorized scheduler/agent sponsor, never graph arguments. Preserve current child inheritance; service identities need explicit workspace grants and lifecycle, not a fabricated human email.

Human login tokens do not become execution tokens. Initial unattended execution uses application/workload credentials and runs across browser logout while the sponsoring principal retains required workspace permission. Revocation/removal blocks future external attempts; completed DBOS checkpoints replay without another cloud call. Cancellation must reach in-flight provider requests and dependent children. Approval authorization is rechecked for the acting reviewer, not inherited from the workflow submitter.

User-delegated Azure OBO and AWS end-user federation are explicitly deferred because durable renewal, consent, session expiry and changed grants require a distinct execution policy. Do not silently fall back from delegated to more powerful application credentials.

## 3. Credential broker

Introduce a provider-neutral broker that accepts server-derived authority, pinned connection ID/revision and an operation-defined resource requirement. Its result is a discriminated union, not an AWS-shaped object filled with Azure fields:

```ts
type EphemeralCredential =
  | { kind: 'azure-access-token'; token: string; expiresAt: string; audience: string }
  | {
      kind: 'aws-session';
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken: string;
      expiresAt: string;
      region: string;
    };
```

Keep compatibility shims for the existing AWS resolver and static provider secret path. New cloud connections use a versioned credential profile; existing graphs/connections are not rewritten on read.

The broker rechecks membership/service grant, connection ownership/status/revision/provider and operation resource policy immediately before fresh I/O. Recheck these gates even on cache hits. Keep tokens only in worker memory; cache by workspace, connection ID/revision, resource/audience and credential mode, with expiry skew and concurrent-refresh deduplication. Invalidate on rotation/revoke and reject nearly expired credentials. Bound exchange attempts/timeouts and sanitize errors.

Only trusted installed operations may request credential capabilities. Do not allow model arguments or graph input to choose a token endpoint, role ARN, client ID, tenant override, arbitrary scope or session policy. Store only non-secret credential provenance (connection/revision, provider, target audience/resource and expiry) in audit; never token values or signed URLs.

### Azure provider

Use Azure Identity SDK credentials. For local configured connections, support the existing encrypted client secret and explicit tenant/client identity. Add certificate or workload-identity federation as separate versioned modes; deployed managed identity must be explicitly selected, not a silent DefaultAzureCredential fallback to the developer's Azure CLI/browser account.

An operation maps to a fixed approved audience: Storage, ARM or another explicitly registered API. Connection policy restricts subscriptions/accounts/containers/resources separately; an OAuth scope alone does not enforce workspace resource boundaries. A subscription ID does not imply data-plane access. Support Azure public cloud initially; sovereign cloud endpoints require a separate validated profile.

### AWS provider

Use AWS SDK v3 STS with explicit worker identity and customer role trust. Support AssumeRole and a separately configured AssumeRoleWithWebIdentity mode. Bind role ARN, region/partition, requested duration and optional encrypted external ID to the connection. Generate stable, non-secret session names/correlation. Apply approved session policy/tags where supported without allowing caller escalation.

Do not read the developer's ambient AWS profile as a production fallback. Role trust, external ID and permission/resource policy must be verified independently of successful token issuance. Preserve session expiry and role-chaining duration constraints.

## 4. Provider operations and process execution

Complete the common dispatcher rather than adding cloud-specific branches to every process node. Compilation captures operation/version, connection/revision, parameter bindings and execution policy. Server installation determines availability; saved JSON cannot declare an adapter installed.

Dispatch order:

1. Resolve authoritative run/actor/workspace from persistence.
2. Validate installed operation/version, inputs, resource restrictions and execution policy.
3. Authorize current principal and resolve the pinned connection.
4. Obtain ephemeral credentials inside the actual fresh provider attempt.
5. Execute with combined cancellation/deadline and one effective retry layer.
6. Validate/bound/redact the output, checkpoint and emit existing run/activity events.

Validate policy before DBOS configures attempts, including crafted direct native dispatcher calls. Graph policy and runtime `node.config.execution` must have one authoritative mapping; SDK retries cannot multiply DBOS retries. Default mutations to one attempt; retry only with provider-supported idempotency or reconciliation. Unknown external outcomes remain uncertain.

First vertical slices pair Azure Blob list/read with AWS S3 list/read under existing versioned catalog contracts. Lists return one bounded page with explicit cursors. Reads require the shared immutable private artifact store and workspace-scoped access; do not checkpoint file bytes, bearer download URLs or SAS/presigned links. Artifact storage is a prerequisite with its own implemented contract, not an assumed catalog dependency. Start with lists if artifact storage is not ready, then complete reads before advertising them as installed.

Workflows, process activities and agent tools invoke the same dispatcher; agent configuration selects allowed connections/operations/policies outside model-generated arguments. Research tools must not acquire cloud write capability through a generic HTTP escape hatch. A cloud agent/model provider remains a separate adapter; cloud credentials do not enable MiniMax.

## 5. Product controls and APIs

Reuse Identity, Connections, People, workflow/process inspectors and Run history rather than separate Azure/AWS dashboards. Official installed Untitled UI controls, existing Font Awesome icons and bounded work-area/dialog layout remain the UI contract.

- Identity: provider trust status and admin configuration; user sign-in, session/logout and explicit account linking.
- Connections: cloud, credential mode, bounded resource policy, metadata, encrypted secret entry/rotation, expiry/readiness and Test connection.
- Test connection: server-only exchange plus an explicitly read-only resource check. Return sanitized stage/status, not tokens. Token issuance and resource authorization are distinct results.
- Inspectors: operation, compatible pinned connection, typed parameter bindings, retry/deadline policy and truthful unavailable reasons. Never show credential fields in nodes.
- Run history/Activity: actor, workload principal/provider, connection revision, operation, attempts, approvals, token renewal metadata and failure/recovery receipts.

Proposed routes: shared `/api/auth/:provider/start` and callback, protected identity binding/linking routes, protected `POST /api/control/connections/:id/verify`, existing connection lifecycle and run APIs. Mutation routes retain origin/CSRF enforcement; the current early `/api/auth/*` dispatch needs explicit review so provider endpoints cannot bypass it. No public credential-exchange route returns raw tokens. Developer CLI tokens remain workspace-scoped tool-authoring credentials, not cloud service credentials.

## 6. Delivery and acceptance

1. **Shared foundation:** additive trust/identity/session/principal contracts, broker union and legacy compatibility. Tests for local-development behavior and existing runs before any cutover.
2. **Entra identity:** OIDC callback/session/logout, onboarding, invitations and account-link migration. Fixture issuer tests before tenant registration/live use.
3. **Cloud credentials:** Azure credential mode plus AWS STS modes behind the common broker; fixture exchange/expiry/revoke tests. Neither requires switching human login providers.
4. **Execution:** installed dispatcher, Azure/S3 lists, native process/workflow and agent-tool authorization paths, then immutable artifact reads. Complete each visible operation end to end.
5. **Optional Cognito identity:** second OIDC provider profile with independent issuer/client/logout contract; prove Azure-login/AWS-execution and AWS-login/Azure-execution combinations.
6. **Live verification/cutover:** review exact tenant/account, app registration, callback URLs, resource roles and trust before creating access. Browser sign-in proves only the interactive account, not workload authorization. Keep customer workflows and IDs intact; no blanket local-account conversion.

Required checks: bad issuer/audience/signature/nonce/state; callback replay/cross-browser binding; expired identity and session revocation; unverified/missing email; invitation subject mismatch; tenant/customer isolation; stale/revoked connections; actor removal during queued runs; child attribution; scope/role/resource escalation attempts; near-expiry renewal; cancellation; bounded retries; completed-checkpoint replay without new exchange/I/O; uncertain mutation handling; artifact isolation; credential redaction in DBOS records, SSE, audit and logs. Run relevant control/integration tests and production build; distinguish fixture, token-exchange and actual cloud-resource verification.

## References

- [Microsoft authorization code + PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
- [Microsoft client credentials](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow)
- [Entra ID token claims and stable identifiers](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference)
- [AWS STS SDK v3](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/sts/)
- [AWS credential providers](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/migrate-credential-providers.html)
- [Cognito identity-provider SDK and managed login](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/cognito-identity-provider)
