# Diagram editor adapters

Status: implemented domain adapters and separate workflow/process renderers. Ontology remains separate.

## Boundary

The shared canvas is a rendering and interaction foundation, not a universal domain document. Workflow documents, process definitions and generated implementations remain separate. Process compilation, immutable revisions, generation receipts, execution and authorization retain their existing services and storage contracts.

`lib/graph-editor/adapter.ts` defines an adapter with:

- A domain identifier, connector style and container policy.
- `project(document)` to produce stable scene IDs, geometry, nodes and labeled edges.
- `apply(document, command)` to translate a diagram edit into a new domain document without mutating the input.
- `validate(document)` for domain draft diagnostics. Full executable workflow validation continues at the existing save/run/compiler boundary.
- `configuration(document, nodeId)` to resolve a domain configuration target.

`executeEditorCommand` rejects writes to read-only diagrams before dispatch. Common commands are move, delete, connect, reconnect, reroute and arrange. Domain adapters may extend this vocabulary without adding process-specific conditions to the renderer.

Rendering is owned by separate domain components, not a shared diagram renderer:

- `components/flows/workflow-renderer.tsx` owns a free-form workflow world with one node layer.
- `components/processes/process-renderer.tsx` owns a partitioned process canvas. Every activity is a DOM child of its actual lane content region and renders in lane-relative coordinates. The process renderer draws elbow connections in world coordinates across those regions.
- Shared `BoardNode`, `EdgeLayer`, coordinate utilities and interaction prop types are lower-level building blocks. The workflow renderer uses GraphSurface and its infinite-world viewport. The process renderer does not use GraphSurface or the centered world transform.

The generic `EditorDiagram` renderer was removed. Adapters supply domain projections and commands to their own renderers. Hosts retain grouped undo/redo, selection, overlays, configuration dialogs and persistence. Generic controls continue to use the installed component system.

## Domain behavior

The workflow adapter preserves existing node dimensions, rope connectors, branch labels, edge ports/conditions, free card placement and rank layout. Its edits preserve operation definitions, parameter bindings and other graph metadata. Existing workflow configuration and runtime validation remain authoritative.

The process adapter preserves typed sequence-flow constraints, elbow routing, lane membership, pool layout and decision/merge semantics. Lane assignment, resizing and lane changes are domain commands. Pools and lanes partition the process canvas and own their activity regions, rather than decorate a global node layer. They are absent from the draggable node scene. Moving a lane ID as a node is rejected. Activity dragging may change responsibility; resizing adjusts shared pool boundaries. Reorder/remove controls are available through Swimlanes settings, not inline movement controls on the canvas. The process editing area is a native scrolling lane sheet, beginning at the top-left and filling the available width/height. There is no outer infinite canvas, grid, movable pool frame or pan gesture. Wheel and trackpad input scroll normally; explicit zoom scales the sheet and its scroll extent. The toolbar is above the sheet, not floating inside another canvas. An ordinary drag on empty lane content selects the lane without moving it. Activities are captured by the stable canvas during dragging, so crossing lane regions does not lose the pointer capture when their DOM parent changes. Processes without declared lanes render an implicit Unassigned region without mutating the saved document.

Native process operations still compose the workflow configuration dialog. Other process activities use its shared configuration frame. The configuration target retains domain identity rather than converting a process into a workflow for editing.

## Verification and scope

Adapter regression tests exercise geometry/config preservation, reconnect metadata, duplicate workflow connections, process-specific connection restrictions, structured lane commands, configuration lookup and read-only rejection. Existing process geometry, compilation and execution tests remain in place.

This extraction does not introduce a new renderer library, replace domain schemas, change executable behavior, or migrate stored documents. Ontology adoption is a later adapter with its own relationship and property semantics. The process renderer owns lane-local placement and hit regions; a generalized nesting framework is not introduced. DOM regression tests verify actual lane ancestry and that workflow rendering has no process regions.

Process pointer conversion includes the sheet origin, native scroll offsets and zoom; activity and cross-lane connector geometry use the same mapping. A visual last lane fills otherwise unused height. Dragging beyond its persisted lower boundary expands that lane as part of the same undoable edit. Existing document coordinates remain unchanged by viewing, scrolling or zooming.
