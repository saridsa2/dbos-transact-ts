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
