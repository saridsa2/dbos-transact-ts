# Existing implementation notes — not an approved product specification

These notes describe the implementation that preceded product review. They are evidence for the later gap assessment, not decisions that constrain the proposed design.

# Workflow authoring and DBOS execution

Stack Proc owns the authoring model. DBOS owns durable execution and recovery. Existing native graphs remain schema version 2; authored graphs opt into `authoringVersion: 1`. Persist the original authored graph. Compile an immutable execution snapshot at dispatch, never replace the saved author's parameters with DBOS bindings.

## Parameter contract

`lib/authoring/model.ts` defines a recursive parameter union: fixed JSON, expression source, object fields or array items. Object/array modes are composite Fixed values in the UI. Each child independently supports Fixed/Expression. Runtime-plan identities such as handler names, queues, referenced graphs and retry policies remain static settings.

`lib/authoring/expressions.ts` parses a constrained expression grammar without evaluating JavaScript. Roots are `$input`, `$vars`, `$nodes`, `$item`, `$state`, `$execution`; only fixed property/index access and documented pure helper calls are allowed. Prototype paths and arbitrary calls are rejected. Expressions produce bounded JSON with finite numbers. Node references must name upstream nodes. Initial variable declarations depend only on workflow input.

`variables` declares named recursive parameters. A Set variables node produces an object merged into workflow variables after successful execution; subsequent parameter resolution sees the updated values. It does not mutate the workflow input. Preview uses initial values plus recorded ancestor variable updates. Missing upstream data produces an explicit resolution error. Preview never executes preceding nodes.

## Node editor

Use `ParameterFields` for data inputs and node-specific metadata for tabs/fields. Do not expose a raw DBOS operation as the primary editing experience. Use the shared context dialog: typed input tree and upstream outputs on the left, configuration tabs in the center, recorded output and separate preview/test results on the right. Each pane scrolls independently; header and actions remain visible. On compact viewports, pane tabs select one pane.

Invalid fields have red highlighting, an exclamation marker, an associated error message and a tab indicator. Nested errors identify their parameter path. Cancel discards staged changes. Done applies a graph draft; Save persists it. Run snapshots are read-only.

## Code execution contract

A Code node stores language, source, execution mode, pinned runtime/dependencies, and execution limits. Current languages: JavaScript and TypeScript. Runtime: QuickJS WASM 0.32.0; TypeScript transpilation: 5.9.3; package dependencies: none. The server seals source and policy with SHA-256 in the execution snapshot. Each invocation gets a disposable Node worker hosting QuickJS, with no host functions, process/environment, filesystem, network, credentials or module loader exposed to guest code.

Guest inputs are JSON `input` and `variables`; per-item mode additionally provides `item` and `index`. Return a JSON value. Local promises can settle inside the guest; timers and external asynchronous I/O are unavailable. Console logs are bounded and returned as execution metadata. Execution limits: wall-clock 10–30000 ms, guest heap 8–128 MiB, output at most 4 MiB, input plus variables at most 4 MiB, four active workers per process, at most 1000 items in per-item mode. Worker startup/transpilation count against timeout. Cancellation and deadline terminate the worker. The `CodeRunner` interface is the extension boundary for additional execution backends.

The compiler lowers Code to a reserved durable step handler and Set variables to an assignment. Authored workflows use `studio.executeGraph.v3`; existing v2 registration remains available. Code runs inside a DBOS step and checkpoints its value, logs and source revision together. Completed results are reused after recovery. Incomplete attempts can execute again; do not assume arbitrary external side effects would be exactly once if a later runner adds I/O.

The protected `/api/authoring/test-code` endpoint checks workspace execute permission and runs the same worker without creating a workflow checkpoint. Test audit stores success/failure and revision, not source/input/output. This is distinct from input preview and full workflow execution.

## Verification

Unit coverage exercises compiler preservation, recursive parameters, expression grammar and limits, JavaScript/TypeScript execution, per-item mode, host isolation, heap/output/time limits and cancellation. Integration coverage saves authored graphs, executes variables and code through DBOS, checks authorization and guest failures, and kills/restarts the service after a completed random-valued code step to prove its checkpoint is reused.

Use the local **Code and workflow variables** example to verify the complete user path; default output is `18`.
