# Fullscreen activity workspace

**Retired UI, 2026-10-20:** The user requested a fresh start for all AI surfaces while preserving the backend. The activity workbench, compact panel, orb and document-analysis screen have been removed. This document is historical design context, not a current implementation contract. Manual tool authoring retains its fullscreen frame. See [AI surface reset](ai-surface-reset.md).

Stack Proc workspaces center on work products and durable activities. Tool authoring and workspace intelligence use a common fullscreen frame, alongside the existing workflow and ontology editors. Administrative resource lists remain in the customer shell.

## Records and execution

An agent definition supplies policy and capabilities. An activity expresses an objective and retains its inputs, decisions, results and execution evidence. A session supplies model context; it is not the activity shown in navigation. Artifact revisions and pending decisions remain separate records.

The initial implementation projects existing `wa_work_items` as activities. Their stable IDs remain in URLs, selection and history. It does not invent a new execution-attempt table or relabel sessions as activities. Existing DBOS checkpoints, MiniMax access, cancellation, steering, typed questions and reviewed ontology changes remain authoritative. Future multiple-attempt modeling must preserve these identities.

`GET /api/agent/activities` returns the latest 100 work items for the authorized workspace, including objective, state, session ID, timestamps and recorded request context. A selected `work` query opens that exact item, including older work in the same session. Legacy session links resolve its latest work only when no work ID was selected. Requests use the current intake and idempotency keys.

## Shared workbench

A compact header retains Stack Proc identity, workspace context, work name, real state, contextual actions and Back. The page frame never scrolls; each editor or inspector owns bounded inner scrolling. Untitled UI controls, Geist and Font Awesome remain the design system. The shared frame hosts domain editors, not a universal chat template.

The intelligence overview presents activities with objective, current state and update time. Selecting one opens a fullscreen work surface. The default Work view shows the objective, proposed artifacts and latest result; Decisions contains pending typed questions and review controls; Execution contains the existing licensed React Bits activity view; Discussion is optional and scoped to the selected activity. Plans and outputs are drawn from actual stored state. Empty views do not simulate progress or generated artifacts. New activity intake has an objective and starts through the durable queue.

The tool resource list remains administrative. Opening a tool uses the same fullscreen frame, with package files, source editor, diagnostics/fixtures and its definition/access/version inspector. Saving, publishing and enabling retain their existing independent lifecycle and authorization. Unsaved edits retain navigation guards.

## Floating intelligence anchor

The AI Blob is hidden on `/intelligence`. Elsewhere it is 132px closed and 84px with the compact panel open. Dragging past a small threshold moves it without activating the agent. On release it snaps to the nearest viewport corner; its corner is stored locally per workspace. Alt plus arrow keys select the corresponding edge. Escape cancels an active drag, and pointer cancellation restores the previous corner.

Anchor coordinates account for the actual viewport, safe-area insets and the header. Resizing recomputes positions from the corner, not stale pixels. The panel uses the same anchor and opens inward, with a connecting tail, accessible composer and bounded height. Top corners open downward; bottom corners open upward. The active orb remains clickable to close the panel. Reduced motion disables size/entrance transitions. Browser storage failure does not disable the launcher.

## Verification

Verify that an older activity stays selected after SSE updates; workspace activity queries never cross tenant boundaries; no duplicate goal is created after ambiguous intake; typed decisions and existing proposal review still work. Verify drag versus click, all four snap corners, resize, reload, keyboard docking, panel attachment and intelligence-route absence. Build and type-check, exercise fullscreen tool navigation and bounded scrolling, and keep production user data unchanged during layout checks.
