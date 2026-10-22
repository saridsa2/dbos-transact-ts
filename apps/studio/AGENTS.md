<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Product UI

Use official Untitled UI React components for customer control plane controls, tables and dialogs. Discover and install them through the authenticated `untitledui` MCP and official CLI. Do not hand-build replacement primitives. Use Font Awesome Pro Regular through `components/fa-icons.tsx`; retain license notices and keep access tokens out of the repository.

Match the Nexbic product reference: locally bundled Geist Variable, light display headings, warm neutral surfaces, black actions and square controls. Keep body text 15–16px and secondary text at least 14px. Preserve the `ui-` color namespace when updating vendor components so they do not override the workflow canvas theme. Keep business authorization, authentication and credential exchange outside the UI components.

## Admin work-area consistency

For new or changed Stack Proc admin screens, apply the `stackproc-work-area` skill at `/Users/satyasuman/.codex/skills/stackproc-work-area/SKILL.md`. Every work area has a task header with aligned page CTAs and search/filters, optional tabs immediately below, and bounded inner content scrolling. The work-area frame never scrolls. Keep one task per work area and use accessible icon buttons for actions inside data tables. Preserve the separate fullscreen workflow canvas.

## Workspace agent engine (required)

The user superseded the Harness2 direction on 2026-10-19 and authorized a standalone port from their supplied Claude runtime source. `vendor/claude-source-reference` retains original reference modules, source hashes and the dependency audit. Those incomplete modules are not a runnable upstream package.

`server/workspace-harness/query.ts` is the owned Stack Proc lifecycle port, and `server/agent/workspace-runtime.ts` supplies DBOS model/tool checkpoints, workspace authorization, credentials, session context and replay receipts. Provider access stays behind `AgentModel`; MiniMax is the required configured provider. Record truthful runtime provenance as the Stack Proc port, never as an unmodified Claude Code engine or Claude Agent SDK.

Do not silently restore Harness2/OpenCode or legacy execution as a fallback. Preserve history, and explicitly suspend work pinned to a different engine revision. Run durable question, duplicate, cancellation, tenant isolation and recovery tests before cutover. Source reference presence does not imply compaction, token streaming, subagents or coding tools are implemented.

The previous AI frontend was retired on 2026-10-20 at the user’s request. Do not mount an agent provider, orb, chat, intelligence workbench or document-analysis UI until a new design is explicitly authorized. Backend endpoints, runtime options, queues, migrations, credentials and histories are retained. Runtime option contracts remain in `server/workspace-harness/options.ts`; the concept/source map is `docs/specs/workspace-harness-concepts.md`. Full source remains unchanged at `vendor/claude-src`; exclude `.grepai` from Git and vendor source from application TypeScript compilation. Keep immutable applied migrations intact. Use the isolated concept integration suite on port 3024 in addition to the port 3022 regression suite. New capabilities must be executable through the durable host, pinned to workspace policy and observable in Activity; source import or a capability flag alone is not implementation evidence.

The user subsequently authorized the fresh AI SDK Agents fullscreen composition on 2026-10-20. Its host is `components/intelligence/workspace.tsx`; licensed sources and original snapshots are in `vendor/aisdkagents`. Preserve this distinction from the retired AI surfaces. Adapt the library components to the existing MiniMax/DBOS intake, events and review contracts; do not introduce a second agent runtime. Scope and remaining capability gaps are recorded in `docs/specs/ai-surface-reset.md`.
