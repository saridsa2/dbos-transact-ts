# Harness2 cutover: required implementation contract

> Superseded runtime decision (2026-10-19): the user selected an owned source port. See [the current implementation contract](workspace-harness-port.md). Harness2 requirements below are historical and are not the active runtime direction.

Status: pinned upstream substrate and OpenCode execution adapter implemented. Real MiniMax tool execution and typed-question continuation verified in an isolated application database. Recursive workspace refinement, candidate selection and adoption are **not implemented**, so the full Harness2 integration remains incomplete.

This decision supersedes the earlier reference-only Harness2 approach. The production runtime adapter delegates execution to the pinned upstream OpenCode executor; the old custom model loop is reachable only by explicit integration fixtures. Do not describe the substrate adapter as a completed recursive refinement integration.

## Runtime boundaries

| Responsibility                                                                                          | Required owner                                                           |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Propose–Probe–Compose recursion, candidate scheduling, selection, evidence-supported experience library | Actual upstream `harness2.core` modules                                  |
| Model/tool execution and model protocol continuation                                                    | Upstream OpenCode executor supported by Harness2, configured for MiniMax |
| Workspace authorization, tools, domain validation, connections and credentials                          | Stack Proc application services exposed through an execution adapter     |
| Durable intake, work identity, ownership leases, execution receipts, recovery and audit                 | DBOS and Stack Proc persistence adapters                                 |
| Chat, questions, proposals and progress presentation                                                    | Existing React Bits / Untitled UI application components                 |

Harness2 is a recursive harness optimization framework, not a ready-made chat service. Its `Substrate`/`BenchmarkAdapter` protocols are the supported integration seams. Creating adapters is required; copying or rewriting the engine or an agent model/tool loop is prohibited. A generic model SDK alone does not satisfy this requirement.

## Pinned dependency

`server/harness2/pyproject.toml` and `uv.lock` pin upstream commit `1cfe254e8d25b15f37048c3730134686abe60335`. Setup uses Python 3.12 through uv:

```
npm run harness2:setup
npm run harness2:check
```

The check imports upstream recursion, scheduling, selection and library modules, checks installed VCS provenance, and runs upstream's deterministic local recursion example. It uses no customer data or model credential. This establishes that the real dependency executes; **it does not establish product runtime integration**. Output is explicitly marked `productionCutover: false`. The demo is never a production executor.

## Integration and cutover sequence

1. Implement an execution adapter using the supported OpenCode substrate and pinned executor version. MiniMax remains the configured provider. Isolate each workspace's executor state and resolve only the selected workspace connection; do not inherit the developer's home configuration or unrelated environment credentials.
2. Expose the existing versioned workspace operations through a scoped tool bridge. Every operation still passes application authorization and schema validation. The executor must not gain general host filesystem, shell, network or installation access merely because upstream benchmark launchers permit it.
3. Project upstream messages, tool events, typed questions, usage, errors and completion into existing workspace SSE and persisted work records. UI controls come from typed tool schemas. Preserve upstream IDs separately from host UUIDs. Never simulate progress or declare an installed engine to be the active runtime.
4. Bridge question suspension and answers to the executor's supported continuation mechanism. Preserve entered values, pending question identity, optimistic versions and idempotency. A queued answer, rejection, running activation and completed response are distinct states.
5. Connect Harness2's actual refinement pipeline to isolated workspace task snapshots and executable tools. Baseline and candidate probes must not duplicate live mutations, notifications or customer-facing actions. Adopted harnesses have immutable hashes and provenance, scoped experience storage and rollback. Application permissions and credential policies remain outside editable harness components.
6. Replace the custom `server/agent/runtime.ts` turn loop. DBOS manages durable executor activations and receipts, rather than implementing inference/tool orchestration. Preserve historical messages and in-flight work without running both engines for one work item. An unavailable engine fails visibly; there is no silent fallback.

## Proof required before production enablement

- Persist actual Harness2 and executor revisions plus the adopted harness fingerprint on each new work item; expose truthful runtime provenance.
- A real MiniMax request completes an authorized workspace tool round trip through the upstream executor.
- A typed question suspends and resumes once after an answer; answer rejection is visible; a restart preserves its identity and values.
- Cancellation, executor failure, service restart and uncertain outcomes are distinguishable. Reconciliation cannot duplicate application effects.
- A real Harness2 refinement run produces candidate execution evidence, performs upstream selection and retains scoped library evidence. Mocked engine calls do not satisfy this gate.
- Cross-workspace access and prohibited tools fail at the host boundary. Candidate probes cannot modify live artifacts.
- Ontology changes remain proposals requiring the existing review/application transaction. Publication and workflow execution retain their current permissions.
- The app works with Harness2/executor dependencies unavailable by showing an actionable failure, never by activating the custom loop.
- Remove the legacy inference/tool loop from production routing only after these gates pass. Any retained legacy code is explicitly migration-only and unreachable for new Harness2 work.

## Source references

- [Harness2 upstream overview](https://github.com/google-research/harness2)
- [Upstream substrate protocol](https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/substrate/base.py)
- [Upstream recursion engine](https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/recursion.py)
- [Upstream OpenCode substrate](https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/substrate/opencode.py)
