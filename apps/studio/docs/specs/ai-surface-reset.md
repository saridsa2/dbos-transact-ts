# AI surface reset — 2026-10-20

The user retired the existing AI frontend to start fresh. No replacement AI screen is introduced in this change.

Removed from the running application: the workspace agent provider and polling, floating AI Blob and attached panel, activity/conversation workbench, agent settings and dynamic question/proposal UI, the legacy document-analysis screen, navigation and source-analysis actions, and the generated-workflow proposal link. AI notifications are filtered only in the shell; their records and read state remain on the server. Bookmarked `/intelligence` URLs redirect to saved workflows.

The backend is unchanged: agent and intelligence services, routes, DBOS execution, MiniMax integration, queues and ambient triggers, credentials, policies, migrations, saved sessions, work items, proposals and histories remain. This is not a backend shutdown or data reset.

Workflows, runs, node configuration and static help, manual ontology/RDF editing, process editing and deterministic workflow compilation, source imports, tool authoring and CLI, connections and customer administration remain available. The tool editor keeps its fullscreen frame.

The removed presentation code and its original tests were saved locally before removal in `.studio/retired-ai-surfaces-1792465151.tar.gz`. This ignored recovery archive is not part of the application build or a published product dependency. Licensed vendor sources are retained. Shared backend contracts and their validation tests are retained; retired component-rendering tests are removed with their UI.

A future AI interface requires a new agreed design. The historical interface specifications are references, not authorization to restore the old surfaces.

## Authorized replacement — 2026-10-20

After reviewing the AI SDK Agents catalog, the user approved a fresh fullscreen intelligence workspace. `/intelligence` now mounts that replacement. The retired orb, dock, document-analysis screen and legacy provider remain retired.

The new surface composes licensed Chat Screen, Chat Layout, App Sidebar, Session List, Session Tabs, Starter Prompts, Attachments Tray, Thinking State, Generative Form, Agent Run Tree, Trace Viewer and Run Log sources. Original source snapshots and hashes are retained under `vendor/aisdkagents/upstream` and `provenance.json`. Host adaptations use Untitled UI controls, Stack Proc styling, a paper-plane send icon, asynchronous draft preservation and controlled inspector opening. No library demo data is used by the running workspace.

Instructions and structured answers enter the existing durable `/api/agent/requests` intake with stable retry IDs. Session URLs restore history after refresh. Read-only event adapters deduplicate replay using string cursors, keep partial answers provisional and show recorded timings only. Existing workspace SSE refreshes session metadata; selected active work and accepted submissions also reconcile durable snapshots. Closing a surface does not cancel backend work.

Proposal review presents the proposed model, detects removed entities and relationships, checks the current ontology version and uses the existing content-hash-pinned apply endpoint. The first browser verification staged a three-entity Banking proposal without applying it. A separate live MiniMax test exercised a typed question, answer/resumption, resource links and recorded model/tool activity. Desktop keyboard resizing and narrow-screen sheet reopening were checked.

This first slice attaches saved ontology/process/source revisions. Arbitrary local file uploads, a measured per-source context-window breakdown, command-menu wiring, session rename/pin/delete persistence, and older-history pagination remain follow-up work. Their catalog sources are available where imported; unsupported actions are not exposed as working controls. The backend engine, migrations, credentials and policies are unchanged.

## Library context and proposal replacement — 2026-10-20

The context surface now composes licensed Knowledge Sources and Generative Form: the former displays attached saved revisions and removes attachments, while the latter selects up to ten available saved revisions. No index/chunk counts are invented. Attachment revisions and durable request serialization remain unchanged.

Proposal presentation now uses the licensed Artifact Panel for saved/proposed document versions, source viewing, copy, download and fullscreen. The document includes a readable entity/property summary and the exact complete schema. Licensed Agent Gate owns the approval controls and summary; host code retains baseline loading, removal detection, role/state/version checks and the existing hash-pinned apply endpoint. Agent Gate's demo auto-approval is disabled; only explicit user approval may apply. The old custom entity accordion/property rows, checkbox selector and review action bar were removed. Host composition and data projections remain necessary; these do not implement replacement UI primitives.

## Conversation lifecycle — 2026-10-20

The library Session List row menu now supports archive, restore and confirmed deletion. An active/archived selector exposes archived conversations. Archiving is reversible and does not cancel running work; restore before sending a new goal. Read-only members cannot mutate conversation state.

Migration 006 adds lifecycle timestamps and a persisted tool-effect receipt. The backend checks all runs and delegated descendants, applied change sets, accepted memories, consumed write approvals and issued tool effects. Active/queued work, uncertain outcomes and unclassified historical tool effects prevent deletion. Internal plans, questions and unapplied proposals alone are not workspace changes. The check is repeated transactionally under a session lock; intake, answers and proposal application use the same lock to prevent a deletion racing a new change.

Deletion tombstones an eligible conversation: it disappears from lists, cannot be reopened or used for further instructions, and cannot apply an old proposal. Durable execution and audit receipts remain intact. Existing migration checksums are unchanged.

## Role-aware context uploads — 2026-10-20

The licensed Attachment Tray accepts UTF-8 text and Markdown files, via picker/drop/paste, with ten attachments per instruction and a 250 KB/200,000-character per-file limit. Server validation is authoritative. Uploads become immutable workspace source revisions, and are explicitly linked to the conversation. Pending uploaded context survives refresh; removing it detaches the draft reference without deleting the saved source. Accepted requests record which revisions were attached.

Owners/admins/editors may upload by default, as explicitly selected by the user. People → Context permissions lets owners/admins enable or disable editor uploads; viewers remain read-only. The existing member-role dialog explains the effective upload permission. Membership and workspace policy are rechecked at upload time, with optimistic concurrency for policy edits. Audit events include uploader identity, role, file name, size, content hash, conversation and immutable artifact/revision IDs; document contents and credentials are excluded. Denied uploads and permission changes are audited. Uploads count as workspace modifications for conversation deletion eligibility.

The same upload permission is enforced for Sources imports inside the knowledge write transaction, so an editor cannot bypass the conversation uploader policy through the general artifact API. Audit search includes recorded metadata such as file names.

UI refinement: the session library is filtered with official Untitled UI Active/Archived tabs and a bordered search field. Saved workspace context and new uploads share a compact action row; the upload picker retains drop/paste support. Navigation uses the monochrome currentColor SP glyph without the brand tile. Opaque black interface colors use charcoal (#303236).
