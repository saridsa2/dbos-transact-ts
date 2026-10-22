# Supplied Claude runtime source reference

Original runtime modules imported from the user-supplied `claude-src` folder, with hashes in `provenance.json`. Original file contents and notices are preserved. The user affirmed permission to modify and redistribute; no upstream license file was present. This record does not invent an upstream open-source license.

The `.txt` suffix deliberately keeps incomplete modules outside the TypeScript application graph. The dependency audit found 536 unresolved local imports reachable from QueryEngine/query and no build manifest. These reference modules are not a runnable dependency.

`server/workspace-harness/query.ts` is the standalone Stack Proc lifecycle port. Stack Proc's DBOS adapter supplies model calls, tool calls, policy checks, receipts, session context and suspension. It does not import the source tree's terminal UI, shell tools, global home configuration, analytics or vendor authentication. Runtime provenance identifies **Stack Proc's port**, never claims an unmodified Claude Code engine or Claude Agent SDK.

Initial scope: bounded model/tool turns, serial authorized tools, immediate question/proposal suspension, typed answer continuation, replay of durable checkpoints, cancellation and uncertain-outcome handling. Upstream compaction, streaming tool scheduling, subagents and filesystem session machinery are reference material, not implemented capabilities.
