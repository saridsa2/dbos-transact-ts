# Stack Proc Harness2 dependency

Install with `npm run harness2:setup`, verify with `npm run harness2:check` from `apps/studio`.
Requires uv; setup selects Python 3.12. The VCS dependency and lockfile refer to the actual upstream Apache-2.0 package. Keep its source and license intact; do not copy or rewrite its engine.

`check.py` is a dependency smoke check using the upstream deterministic demo, not the workspace executor. It verifies the exact installed commit and explicitly reports `productionCutover: false`. It does not use model credentials. Use a fresh output directory if deliberately rerunning uncached upstream demo executions.

The production adapter and legacy-loop removal are tracked in [the cutover contract](../../docs/specs/harness2-cutover.md). Installing this package does not switch the existing agent runtime.
