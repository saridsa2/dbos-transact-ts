# Customer control plane

## Product scope

Customers need one place to onboard their organization and users, manage reusable service connections and credentials, and audit workflow execution. Account Management is the application reference for account lifecycle and identity patterns. It does not supply canvas nodes.

## First slice

Implemented at `/control`:

- Onboard a customer and workspace; optionally adopt existing local workflows/history.
- Select an authorized workspace; invite users through email-bound, expiring invitation links; accept/revoke invitations.
- Assign admin, editor and viewer membership roles; remove members while preserving the workspace owner.
- Create and edit OpenAI, Anthropic/Claude, Microsoft Foundry, Microsoft Azure, Azure OpenAI, HTTP, MCP, Postgres and AWS STS connection records.
- Encrypt static credentials and optional STS external IDs server-side; rotate credentials with revision checks; revoke workspace access.
- View run history with actor/status and links to existing graph/node traces; view paginated administrative and run lifecycle audit events.
- Keep all graph, run, message, approval and connection API access scoped to the selected workspace.

Saved connections are marked **provider access not verified**. Creating a connection validates settings and stores credentials; it does not perform a model call, verify an external account or make an integration node executable.

## Data and ownership

`cp_customers` owns workspaces. `cp_users` identifies people by immutable issuer/subject pairs. `cp_memberships` grants a workspace role. `cp_invitations` stores a token hash, invited email, role, expiry and acceptance. `cp_connections` stores non-secret configuration and a revision. `cp_connection_secrets` holds authenticated ciphertext and a secret version. `cp_audit` records actor, action, resource, time and an allowlisted detail payload. Development sessions store hashed opaque tokens.

Existing `studio_flows`, `studio_runs` and approvals retain their data and gain workspace/actor attribution. Child executions inherit the parent's workspace. Referenced saved graphs resolve only within the invoking workspace. Earlier local runs and scheduled work can have a system actor; manual starts and debounced submissions record their initiating user.

## Permission contract

| Action                                             | Owner              | Admin | Editor | Viewer |
| -------------------------------------------------- | ------------------ | ----- | ------ | ------ |
| View workflows, run traces and connection metadata | Yes                | Yes   | Yes    | Yes    |
| Save/run workflows; send messages; resolve reviews | Yes                | Yes   | Yes    | No     |
| Create/edit/rotate/revoke connections              | Yes                | Yes   | No     | No     |
| Invite/change/remove editors and viewers           | Yes                | Yes   | No     | No     |
| Assign/change/remove admins                        | Yes                | No    | No     | No     |
| Read administrative audit trail                    | Yes                | Yes   | No     | No     |
| Transfer/remove owner                              | Separate operation | No    | No     | No     |

Roles are application membership records. Identity-provider claims do not automatically grant these permissions. Tenant/workspace IDs supplied by clients always undergo membership checks. A new authenticated user can create their own customer workspace without gaining access to an existing one.

## Connection and credential contract

A connection belongs to exactly one workspace and contains service type, display name, authentication kind, typed non-secret settings, lifecycle status and revision. Nodes will store its ID and revision. The first slice exposes metadata only; it has no HTTP credential reveal route.

AES-256-GCM protects stored secrets with a fresh nonce and workspace/connection/version authenticated context. A local development key is generated under ignored `.studio/credential-key` with file mode 0600. External authentication deployments must configure a 32-byte base64 `STUDIO_CREDENTIAL_KEY`. Backups must retain the encryption key separately from encrypted database backups. Master-key rotation and managed vault/KMS backends are follow-on work.

Connection rotation replaces the ciphertext and advances its version. Configuration changes advance the connection revision. Revocation removes the stored secret and blocks broker resolution; it does not revoke a key at the external provider. Historical runs retain connection references, not copies of key values. Requesting an unavailable revision fails explicitly.

## API surface

- `/api/control/session`: normalized identity/session and authorized workspaces; development sign-out.
- `/api/control/session/development`: local development identity creation only.
- `/api/control/onboarding`, `/api/control/workspace`: create and select workspaces.
- `/api/control/members`, `/api/control/invitations`: membership and invite lifecycle.
- `/api/control/connections`: metadata inventory and creation; per-connection edit, rotate and revoke routes.
- `/api/control/runs`, `/api/control/audit`: recent execution history and cursor-paginated audit records.

Invitation links are returned once for the inviter to share. Email delivery is not configured. External identity adapters require verified email before invitation acceptance. Development identity explicitly permits local testing with unverified email.

## Audit and execution

Persist workflow saves, manual run requests, debounced submissions, review decisions, membership changes and connection lifecycle changes. Insert run start/wait/resume/complete/failure records alongside persisted execution events, so replay does not duplicate them. Administrative details omit credential values, request bodies and invitation tokens. The existing node trace remains the detailed execution record.

The initial history view shows the latest 100 executions with client-side search/status filtering. Audit history uses a server cursor. Organization-wide retention/export policy, immutable external audit sinks, granular review permissions and cost aggregation await later increments. Domain adapters must avoid emitting secrets into ordinary node outputs.

## Acceptance

Tests must prove cross-workspace isolation for direct IDs and child graph references; role enforcement on server routes; invite email binding, expiry/revocation/reuse protection; encrypted storage with no secret in metadata/audits; optimistic revision checks; secret removal on revocation; temporary session expiry rejection; and existing workflow recovery after restart. Browser checks cover onboarding, connection creation/rotation/revocation, invitations, history and audit navigation.

## UI system

Use the official Untitled UI React source components for controls, tables and modal dialogs. Components are installed with the authenticated `untitledui` MCP and its official CLI; do not create substitute primitives. Application icons use Font Awesome Pro Regular. Bundle licensed assets locally, retain license notices, and never commit registry or MCP access tokens.

The Nexbic reference (`BhaskarProject/nexbic/web`) supplies the product styling: Geist Variable, warm eggshell and stone surfaces, black actions, square controls and light display headings. Studio namespaces the Untitled color tokens to preserve the existing workflow canvas theme. Customer control plane body text is 15–16px and secondary text is at least 14px. Sign-in and AWS STS remain independent adapter contracts.

## Stack Proc shell and live updates

The product is named **Stack Proc**. Reuse the original logo mark from `stackproc-ai/components/logo.tsx` with the Stack Proc wordmark. `StackProcShell` owns global branding, notifications, account controls and navigation. Admin work-area frames do not scroll; their bounded inner content viewports own scrolling. The workflow builder remains a separate fullscreen surface. The header provides the active section, connection state and notification menu. Workspace switching and profile/account actions use official Untitled UI dropdown components. Each control plane section has a URL (`/control?tab=...`); page-specific actions stay inside that page.

`useControlNavigation`, `useWorkspaceEvents` and `useWorkspaceRefresh` share navigation and live state, with `usehooks-ts` callbacks and local notification read state. One same-origin EventSource connection serves the entire mounted shell. Workspace pages, workflow lists, run traces and debounced execution status refresh in response to events. Countdown rendering remains a local timer.

Committed audit writes and node checkpoints append metadata-only `cp_workspace_events` rows and issue Postgres `NOTIFY`. The server uses a shared `LISTEN` connection to drain durable rows into authenticated SSE streams. Per-workspace transaction locks keep numeric cursor order consistent with commits. Reconnect uses `Last-Event-ID`; a heartbeat catches up after listener interruption and rechecks session/membership. Revoked access closes the stream. Slow clients reconnect and replay rather than accumulating unbounded buffers. Fine-grained execution progress invalidates traces but does not fill the notification menu. Credentials, workflow inputs and outputs never enter the notification payload.

Connections include Microsoft Azure service principals (tenant ID, application/client ID, optional subscription ID, encrypted client secret) and Azure OpenAI (endpoint, deployment, optional API version, encrypted API key), alongside Microsoft Foundry. This slice stores validated settings; live Azure token exchange and provider calls are adapter work.

Protocol references: [SSE event IDs and reconnects](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events), [Postgres transaction-aware notifications](https://www.postgresql.org/docs/current/sql-notify.html), and [Azure application/service-principal identity](https://learn.microsoft.com/en-us/entra/identity-platform/howto-create-service-principal-portal).

The workflow builder (`/flows`) now occupies the complete viewport and uses its own canvas toolbar and Back link. The application header/sidebar remain on workspace pages. The shared SSE provider continues to feed execution updates while the builder is open.

Notifications resolve to their actual graph, execution, connection or people view, include resource names, and persist per-user read state in `cp_notification_reads`. `POST /api/control/notifications/read` marks only authorized workspace events for the current user. The profile menu displays the user name/email and current customer/workspace/role, with explicit View profile, Identity and access, and Sign out actions.

## Admin work-area layout

`components/control/work-area.tsx` provides the shared header, optional navigation, content viewport, status and footer composition. Search, filters and contextual page CTAs align with the title in the header. Official Untitled UI tabs sit immediately beneath that header. Only the bounded content region scrolls; table column headers stay sticky and counts/pagination remain outside the table viewport. Table record actions use Font Awesome Pro icon buttons with accessible labels and tooltips.

- Overview summarizes workspace health and setup progress without inline connection administration.
- Connections owns provider records and its Add connection CTA.
- People has Members and Invitations views (`/control?tab=team&view=members|invitations`). Invite teammate opens a focused dialog. Role changes open a record dialog; membership and invitation revocation retain confirmation.
- Run history places search/status in its header and opens traces through a row icon.
- Audit trail confines events to its table viewport and keeps Load earlier events in the fixed footer; search applies to loaded events. Restricted accounts see an explicit permission state.
- Identity focuses on the signed-in identity and authentication adapter; provider credentials belong to Connections.
- The workflow library uses the official Untitled UI table for Saved workflows, with accessible Open and Delete icon actions. Editors can confirm permanent deletion of a saved definition and its schedule; existing execution snapshots and run history are retained. The server enforces workspace membership and execution authority, audits `workflow.deleted`, and broadcasts the update through workspace SSE. Deletion failures remain visible in the confirmation dialog.
- The workflow library has Saved workflows and Examples tabs (`/?view=examples`), without a second run-history feed. Import/New workflow are available only to users with execution/editor authority.

Connection, invitation, role, confirmation, profile and onboarding dialogs separate the fixed heading and action footer from the scrolling body. Initial load, fetch failure and empty states are mutually exclusive. Shared SSE refreshes update existing content without remounting its viewport; navigation to another task resets its content position.

### Process editing and unsaved navigation

Process records use Overview, Inputs and Steps tabs immediately below the work-area header. Overview owns the name, purpose and pinned ontology references; Inputs owns the run schema and default values; Steps owns ordered actions and clarifications. Only the active section's bounded content scrolls; edits remain in the record draft across tabs.

Process, ontology and tool editors register unsaved state with the shared navigation guard. App Back actions, ordinary links and control-plane navigation use an Untitled UI discard dialog with Keep editing and Discard and leave. Reloading or closing a browser document retains the browser-owned beforeunload warning; browsers forbid replacing that warning with application markup. Native window.confirm/alert/prompt calls are not used by application editors. Workflows, Sources and Tools use distinct diagram, database and gear navigation icons.
