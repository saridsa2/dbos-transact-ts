# Tool builder and developer CLI

Status: target implementation specification, 19 October 2026. The first pure-code browser/CLI release is implemented; [implementation notes](tool-builder-implementation.md) distinguish delivered behavior from remaining target capabilities. This supersedes the preliminary tool-authoring section in `workspace-harness-port.md`.

Stack Proc will provide a code-first tool editor and a developer CLI that author the same portable tool package. Upload saves a draft. Publish creates an immutable executable revision. Enable makes that revision available to a workspace agent or workflow. These are separate actions with separate permissions.

## 1. Product and execution model

A tool is a named atomic capability with a typed input, typed output, implementation and declared effects. Its implementation may contain ordinary code, but its purpose and execution boundary remain focused. Processes, research loops and multi-step business workflows remain compositions. Agent lifecycle tools such as asking questions, delegation and memory remain owned by the harness.

Two equally supported authoring journeys:

1. Create a tool in the browser, edit code and schemas, test it, save a draft, publish and enable it.
2. Create a package on a developer machine, edit it in an IDE, validate/test locally, upload it into the same workspace draft, review/publish and enable it.

An uploaded tool must open in the browser with its source, schema files and fixtures intact. A browser-authored tool must be downloadable and editable with the CLI. The two clients share contracts, compiler and test semantics; neither owns a separate kind of tool.

Tools can be exposed to the agent, as atomic workflow operations, or both. The shared operation service executes them; enabling agent discovery and enabling a workflow offering are independent policies. Adding an ontology association does not change the code's permissions.

## 2. Existing foundations and required additions

| Existing implementation                                              | Reuse and required work                                                                                                                              |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/flows/code-editor.tsx` and installed CodeMirror packages | Reuse editing, syntax and diagnostics foundations; add package files, generated SDK types, tool-aware completion and source locations                |
| `server/code/runner.ts`, `worker.mjs`, `lib/authoring/model.ts`      | Reuse disposable QuickJS workers, cancellation and limits; add an adapter from a compiled exported tool function to the current function-body runner |
| `server/workspace-harness/extensions.ts`                             | Add a workspace-published catalogue alongside trusted server extensions; uploaded code must not be registered as a Node callback                     |
| `server/agent/extension-execution.ts`                                | Reuse input/output validation, exact-input approval and read-only child restrictions through a common invocation service                             |
| `server/agent/mcp.ts` and connection credential resolution           | Reuse pinned MCP offerings and server-side credentials for connection-backed tools                                                                   |
| `server/agent/workspace-runtime.ts`                                  | Reuse durable invocation receipts, discovery, budgets, cancellation and Activity; capture authored tool revision/runtime pins                        |
| `server/control/auth.ts`                                             | Keep identity behind adapters; add explicit developer-login/token capabilities rather than copying browser session cookies                           |
| Current knowledge revision patterns and workspace authorization      | Reuse optimistic edits, immutable revisions, publication and audited workspace-scoped operations                                                     |

The current worker executes JS/TS function bodies with no dependencies or external I/O. Package module compilation, a tool SDK, authored-tool storage, connection-backed code execution and CLI authentication are new implementation work.

## 3. Browser experience

### Tool library

Add a Tools workspace area. Its fixed header contains the title, search, status/runtime filters and Create tool / Import package. Use the official Untitled UI table with name, description, runtime, draft state, published version and availability. Row actions are accessible icons for opening, testing, downloading and archiving. No outer work-area scrolling.

### Code editor

Opening a tool opens a dedicated code work area, rather than a properties-only configuration dialog:

- Fixed header: tool name, draft/version state and aligned Save draft, Test, Publish and Enable actions as permitted.
- Left file explorer: manifest, source, schemas and test fixtures. Creation uses templates with working examples.
- Centre: CodeMirror editor with horizontal file tabs, line numbers, search, formatting, diagnostics, completion and source-mapped errors. It occupies most of the available space.
- Collapsible right inspector: Definition, Access, Versions and Help. Metadata controls edit the manifest; they are not a second copy of tool state.
- Bounded bottom panel: Problems, Test input, Output, Logs and Test history. Test input supports schema-driven controls and JSON mode. Output supports a tree and raw view. Execution status and Stop remain visible while testing.

Each editor/panel owns its own bounded scroll; headers and actions stay reachable. Square controls, Geist, Font Awesome Pro and Untitled UI remain the product language. Help is the last inspector section. Draft changes do not alter the published implementation or interrupt active executions.

Input/output schemas are ordinary package files. Form-based schema editing and code editing update the same buffer through a validated transaction. A malformed schema remains editable with a precise error; the form does not replace it with defaults. Save can retain an invalid draft, but Test and Publish require a valid executable snapshot. All server tests operate on a persisted immutable draft snapshot/hash, so unsaved edits must be saved explicitly before testing.

Completion includes generated input/output types, the selected runtime's SDK, local exports and configured operation aliases. Capability completion must not suggest APIs unavailable to the runtime. Use the installed TypeScript tooling and CodeMirror integration; Rust/WASM is not a prerequisite.

## 4. Package and manifest

Initial languages: TypeScript and JavaScript. Python and arbitrary server processes require separate runtime profiles and are outside the first release.

```text
sum-values/
  tool.json
  src/index.ts
  src/helpers.ts
  schemas/input.schema.json
  schemas/output.schema.json
  tests/basic.input.json
  tests/basic.expected.json
  README.md
  .stackproc/project.json
```

`tool.json` is declarative JSON, never an executable configuration file. Example:

```json
{
  "schemaVersion": 1,
  "id": "396789d8-86fa-4d41-bfb9-63da004e4c62",
  "slug": "sum-values",
  "name": "Sum values",
  "description": "Add the supplied numeric values and return their total.",
  "version": "0.1.0",
  "runtime": "pure-js-v1",
  "entrypoint": "src/index.ts",
  "inputSchema": "schemas/input.schema.json",
  "outputSchema": "schemas/output.schema.json",
  "effects": "pure",
  "exposure": ["agent", "workflow"],
  "limits": { "timeoutMS": 5000, "memoryMB": 32, "maxOutputBytes": 65536 },
  "tests": [{ "name": "basic", "input": "tests/basic.input.json", "expected": "tests/basic.expected.json" }]
}
```

The stable UUID identifies the tool; the slug/name are human-facing. Version is a developer-supplied semantic label. Server revision number and content hash are authoritative for execution. Republishing the same version with different content is rejected. IDs are scoped by workspace, allowing the same package to be installed into different workspaces without sharing credentials or permissions.

Exposure is a requested offering, not an authorization grant. Schema constraints, implementation/runtime, effects, connection requirements, documentation and fixtures belong to the immutable package. Actual workspace connection IDs and enablement policy live in a separate installation binding.

`.stackproc/project.json` stores non-secret defaults such as API URL and workspace alias. `.stackproc/remote.lock.json` stores the last synchronized tool ID, edit version, package hash and revision for conflict detection. These files do not participate in executable content hashing. Credential files, `.env` files, generated caches, `node_modules`, Git metadata and local connection bindings are not uploaded.

## 5. Code and SDK contract

### Pure code

```ts
import type { ToolContext } from '@stackproc/toolkit';
import type { Input, Output } from '../.stackproc/types';

export async function run(input: Input, ctx: ToolContext): Promise<Output> {
  ctx.log.info('Adding values', { count: input.values.length });
  return { total: input.values.reduce((sum, value) => sum + value, 0) };
}
```

Generate `.stackproc/types.d.ts` with `Input` and `Output` from the canonical schemas during initialization, schema edits and validation. This generated file is excluded from package contents and regenerated by the server compiler. Generated types provide editor assistance; server runtime validation remains mandatory. The first SDK provides bounded structured logging and execution metadata. `run` receives validated JSON input. It returns JSON matching the output schema. There is no credential object, general `fetch`, filesystem, shell, Node process, package installation or dynamic import capability.

Local source imports within the package are supported. External runtime dependencies are rejected in v1. The toolkit's type imports are compiler-owned and erased from executable output. Dependency support later requires an allowlist, locked contents, licensing/provenance and the same server build checks; it must not become an implicit `npm install` during upload.

### Connection-backed code

Support a separate `operation-js-v1` profile after the pure-code slice. It binds one registered external operation or MCP offering and lets the author write `prepare(input)` and `format(result)` functions. Both functions run in the isolate:

```text
validated input → prepare code → validated operation input
→ host approval and credential-bound dispatch → validated operation result
→ format code → validated tool output
```

The host performs external I/O between the two code stages. Code returns data; it never receives a credential or a live host function. The bound operation/connection requirement appears in the manifest inspector and package diff. This profile gives developers a code-based integration tool while retaining a clear atomic operation and approval boundary.

Do not advertise arbitrary `ctx.invoke()` calls, unrestricted provider SDK imports or multiple network actions inside pure code. A future general managed runtime would need an explicit broker protocol, per-effect receipts, cancellation and a defined recovery model. Multi-operation business orchestration remains a workflow.

The effective effect classification is at least as restrictive as the bound operation. A manifest cannot label a known write operation as read-only. Publish validates classifications; runtime still enforces current workspace policy and read-only delegated-agent restrictions.

## 6. Compiler and execution architecture

Use a shared `ToolCompiler` with pinned TypeScript checking and esbuild bundling. Server and CLI use identical compiler options and generated SDK definitions. Type checking is a separate gate; bundling is not runtime isolation. Use controlled compiler/resolver code, neutral target, bundled local imports and source maps. Do not run uploaded build scripts, compiler plugins, executable configuration, package hooks or entrypoint code to discover metadata. See the [esbuild build API](https://esbuild.github.io/api/#build).

The server rebuilds source itself. Client-generated bundles are advisory caches and never executable authority. The server creates an immutable build record containing package hash, compiler/SDK versions, runtime profile, emitted artifact hash, source map hash and diagnostics. Compilation runs in a resource-bounded worker. Load the resulting self-contained code only into QuickJS, adapting its `run` export to the existing worker runner. Never import an uploaded module into the Studio Node process or execute it with host `eval`/`Function`.

Initial package limits: 1 MiB total uncompressed source/docs/fixtures, 100 files, 16 KiB per input/output schema, 256 KiB emitted JavaScript, JSON-only results, 64 KiB default output and 16 KiB logs. Pure runtime defaults are 5 seconds and 32 MiB; policy may allow up to the existing 30-second/128-MiB runner ceilings. Agent-observation limits can be lower; larger results require an authorized artifact reference rather than truncating a JSON value silently.

Use a versioned `.sptool` ZIP envelope with a canonical JSON file index and SHA-256 hashes. Reject absolute/traversal paths, duplicate paths, symlinks, special files and excessive compression ratios before extraction. Hash logical paths and exact UTF-8 bytes in sorted order; ZIP timestamps/order are irrelevant. Package hashing includes manifest, sources, schemas, fixtures and documentation. Build hashing additionally includes compiler, SDK and executor identity. Content addressing detects change; it is not proof of publisher identity.

## 7. Version lifecycle and enablement

```text
local files / editor buffers
  → saved draft snapshot → validated and tested build
  → published immutable revision → workspace-enabled offering
```

Each save creates an immutable draft snapshot and advances the editable head using optimistic version checks. Tests refer to snapshot/build hashes. Publish requires a successful server build and all declared fixture tests for that exact hash; tools without fixtures need at least one explicit accepted test. Invalid drafts remain saveable, with diagnostics. Successful tests of earlier source do not qualify newer source for publication.

Publishing and enabling are separate. Upload or publish does not silently give an agent a new capability. Enablement records the published revision, effect policy and approved connection binding revisions. Updating an enabled tool requires a reviewable revision diff. Existing work keeps its captured tool/build/binding pins; new work uses the newly selected revision. Disabling prevents new dispatch, while archiving preserves source, history and receipts. Connection revocation takes effect at authorization boundaries even for pinned work.

Browser edits and CLI uploads use the same `expectedVersion`. If both changed the same draft, return a conflict with base/current/incoming hashes and offer a diff/merge. Do not use last-writer-wins. A local `--force` flag cannot bypass server version guards, publication rules or permissions.

## 8. Developer CLI

Proposed distributable packages: `@stackproc/cli`, `@stackproc/toolkit` and an internal shared tool compiler/contracts package. The executable is `stackproc`, with Node 22.13+ matching the current application baseline. npm package availability is part of implementation, not an existing installation command guarantee.

```bash
stackproc auth login --server https://stackproc.example.com
stackproc workspace select acme/development

stackproc tools init sum-values --language typescript
cd sum-values
stackproc tools validate
stackproc tools test --fixture basic
stackproc tools upload . --workspace acme/development
stackproc tools test --remote --fixture basic
stackproc tools diff --remote
stackproc tools publish --version 0.1.0 --hash <validated-package-hash>
stackproc tools enable sum-values --revision <published-revision>

stackproc tools pull sum-values --revision <revision> --output ./sum-values-copy
stackproc tools history sum-values
stackproc tools inspect sum-values --revision <revision>
stackproc auth logout
```

| Command                      | Contract                                                                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `init`                       | Generate stable identity, manifest, code, schemas, fixture and README from a runtime template                                          |
| `validate`                   | Parse manifest/schemas, resolve imports, type-check and compile without executing user code                                            |
| `test`                       | Run pure code in the same local QuickJS executor with the selected fixture; label local results clearly                                |
| `upload`                     | Package explicit allowlisted files, show target/hash, upload once idempotently and create/update a draft using the remote edit version |
| `test --remote`              | Request a server test of the exact saved snapshot; stream logs and return a test receipt                                               |
| `publish`                    | Publish an exact validated hash and version under server permissions; never publish merely because upload succeeded                    |
| `enable`                     | Request workspace enablement/bindings under capability-management permission                                                           |
| `pull`                       | Download a selected snapshot with hashes; refuse to overwrite dirty local files unless an explicit backed-up replacement is requested  |
| `diff`, `history`, `inspect` | Show source/schema/capability/version changes and build/test evidence                                                                  |

`upload --watch` may validate and synchronize drafts in development after an explicit start. It never publishes or enables. A conflict stops synchronization and preserves both versions. Failed checks leave the prior remote snapshot intact. File watching is not an ambient agent heartbeat.

Every command supports explicit `--server`, `--workspace`, `--profile`, `--json` and noninteractive operation where applicable. CI must supply target workspace and identity explicitly. Exit categories distinguish validation, authentication/permission, conflict, execution failure, transport uncertainty and unsupported capability. Do not infer the workspace from a tool manifest's untrusted contents.

Persist upload/publish command idempotency keys before network I/O. On an interrupted request, query its receipt using the same key and hash. Do not automatically create another revision. `--json` outputs a stable result envelope with target, tool ID, edit version, hashes, revision/test/command IDs, outcome and structured diagnostics; it never includes credentials.

## 9. Authentication and STS

CLI authentication must use an explicit adapter capability. Interactive login uses a browser authorization flow with PKCE and a loopback callback, or an adapter-provided device authorization flow. Adapters advertise the supported flow; the CLI fails clearly when none is available. There is no silent development identity or browser-cookie fallback against a remote server. PKCE follows [RFC 7636](https://www.rfc-editor.org/rfc/rfc7636).

Extend the identity boundary with login discovery, authorization/token exchange and bearer-token verification. Issue short-lived, audience-bound developer tokens scoped to a workspace and permitted tool actions. Resolve the principal and current membership/role on the server; token claims do not replace current workspace policy. Keep refresh credentials in the OS credential store. CI supports a provided short-lived token or enterprise workload/STS federation through the configured adapter. Credentials stay outside the tool package and Git.

Suggested scopes: `tools:read`, `tools:write`, `tools:test`, `tools:publish` and `tools:enable`, each intersected with current workspace role/policy. This requires developer token issuance/verification work; the current `AuthAdapter.authenticate` hook alone does not already provide the CLI login protocol. Local development may expose a clearly marked local-only login capability, never the production default.

Enterprise sign-in/token-service federation and AWS STS temporary credentials remain distinct adapters. A developer token authorizes upload to Stack Proc. AWS STS credentials authorize a bound external operation and are resolved on the server at invocation. Neither substitutes for the other. Tokens and uploaded packages must not contain long-lived customer connection secrets.

## 10. Test and effect semantics

Local tests are pure or use explicit fixture observations; they never resolve real workspace secrets. Remote pure tests use the same runner/compiler versions that will execute the published artifact. Connection-backed tests default to controlled fixture observations. The result must identify Local, Remote fixture or Live effect, plus source/build hash and effective policy.

A live external test is a real action: it requires approved connection bindings, the same authorization/effect checks as production and an exact-input approval where policy requires one. A CLI `--allow-effects` flag records intent but cannot bypass the server approval flow. Test fixtures cannot replace production dispatch modules or install server callbacks.

Cancellation, timeout, resource errors, schema errors and dependency unavailability have separate recorded outcomes. Show field/file/line diagnostics. Never label a failed test successful because code compiled. Do not show ordinary successful outputs as arbitrary raw tool JSON in the agent conversation; authored presentation references resolve only to trusted host UI renderers, with raw diagnostics in Activity.

## 11. Storage and APIs

Add workspace-scoped tables for tool heads, immutable source snapshots, server builds, fixture/test runs, published revisions, installation bindings and upload/command receipts. Store immutable package/build blobs through a content-addressed artifact-store interface; Postgres stores metadata and integrity hashes. The local provider may store blobs under `.studio`, but production requires shared durable storage rather than one worker's filesystem.

| Table          | Principal fields                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| `wt_tools`     | workspace/tool ID, slug/name, edit version, draft/published revision pointers, archived state, creator               |
| `wt_snapshots` | immutable snapshot ID, package hash, manifest and blob reference, parent/base snapshot, author                       |
| `wt_builds`    | snapshot/hash, compiler/SDK/runtime identity, artifact/source-map hashes, diagnostics and outcome                    |
| `wt_tests`     | snapshot/build/fixture/input hashes, execution profile, outcome, bounded output/log references, actor and timestamps |
| `wt_releases`  | tool ID, semantic version, immutable revision/build/hash, publisher and timestamp                                    |
| `wt_bindings`  | selected release, exposure, workspace connection aliases/revisions, effect policy and enablement version             |
| `wt_commands`  | principal/workspace/client key, request hash, command kind, state and durable result receipt                         |

Existing immutable revision/permission patterns should be extracted where shared rather than duplicated. No migration edits after application; add the next migration in the active sequence.

Proposed authoring API: `/api/tools`, `/api/tools/:id`, `/api/tools/uploads`, `/api/tools/commands/:id`, `/api/tools/:id/builds`, `/api/tools/:id/tests`, `/api/tools/:id/tests/:testId/events`, `/api/tools/:id/releases`, `/api/tools/:id/bindings`, `/api/tools/:id/history`, `/api/tools/:id/export` and `/api/tools/:id/archive`. Mutations carry expected head/binding versions, exact hashes and client command keys. Browser and CLI use the same API. Authentication callbacks/token exchange live behind the control-plane auth adapter, not the tool execution routes.

Upload acceptance, build and test are distinguishable states. Long builds/tests use durable queued jobs and resumable event cursors. SSE reports accepted/validating/building/testing/succeeded/failed/cancelled phases and safe logs; it is presentation only. An accepted upload is not proof of a successful build or executable publication. Reconnect resumes from the last event ID.

## 12. Harness, workflow and recovery integration

Resolve enabled published tools through a new authored-tool catalogue alongside existing extensions and MCP. Tool search returns descriptions first, then relevant schemas. Capture the tool release, definition/build hashes, runtime identity and binding revisions in work provenance and invocation receipts. Use stable names derived from tool identity; display names may change without breaking references.

Extract a shared invocation service used by agent calls, workflow nodes and remote tests. It validates input, checks current policy, runs the correct executor and validates output. Agent execution and production workflow execution call that service inside their existing DBOS checkpoint boundaries; avoid nesting `DBOS.runStep` inside another tool step. Standalone tests have their own explicitly identified execution records.

For `operation-js-v1`, record prepare result, exact operation input/binding, approval, dispatch and format result under the host invocation. A recorded successful external effect followed by failed formatting is a known partial failure, not an uncertain dispatch. A missing dispatch receipt is uncertain. Neither state automatically repeats the external action. Pure formatting may be rerun against the recorded observation; the operation is not repeated. Provider-supported idempotency uses the host invocation key. Never promise exactly-once effects where an external provider does not support them.

Completed invocation receipts replay their recorded output after restart. An issued external effect without a complete receipt remains uncertain. Known pre-dispatch schema/policy failures are explicit failures. Agents cannot alter tool code, effect policy, credentials or installed versions through invocation arguments. Agent-assisted authoring creates a reviewed draft, and publication remains separately authorized.

## 13. Delivery order

1. **Contracts, packaging and CLI authentication:** shared manifest/SDK/compiler contracts, artifact envelope/hash, developer-token adapter flow, draft upload and CLI skeleton. Establish UI/CLI parity now.
2. **Pure code end to end:** browser file editor, local/remote tests, immutable builds, publish/enable, CLI upload/pull/diff, agent discovery, execution and workflow offering. This is the first complete release; the CLI ships with it.
3. **Connection-backed code:** prepare/format SDK, registered operation and MCP binding editors, effect approvals, live-test labelling and partial-effect receipts. Preserve the same package and CLI contract.
4. **Developer hardening:** draft watch, richer diff/history, CI workload federation, signed distribution/managed dependency profiles as separately versioned capabilities.

Initial release does not include arbitrary Node/Python servers, customer-uploaded host extensions, unrestricted npm dependencies, custom React output components or automatic publication by an agent. These are explicit future capabilities, not hidden consequences of accepting code uploads.

## 14. Acceptance gates

- A browser-authored package can be pulled, changed locally and uploaded back without losing schemas, tests or IDs. The reverse path works equally.
- Equivalent source produces the same package hash across clients; server compilation remains authoritative and records its pinned toolchain.
- An interrupted upload/publish is reconciled using its command receipt, without duplicate drafts/releases.
- Concurrent UI/CLI edits produce a conflict and a usable diff, preserving both versions.
- Invalid drafts remain editable; invalid/unbuilt/untested hashes cannot be published or enabled.
- Tool source never executes during upload, manifest inspection, type checking or bundling in the host process.
- Missing capability, oversized/archive traversal inputs, escaped package imports, invalid schemas/results and guest time/memory limits fail explicitly.
- A developer identity on another machine can upload with scoped tokens; expired/revoked tokens, wrong audiences, cross-workspace access and missing scopes are rejected.
- CLI and browser cannot bypass approval or use another workspace's connection. AWS STS temporary credentials never enter package artifacts or code inputs.
- Published pins survive pause/restart; disabling/revoking policy stops future dispatch; completed receipts replay without repeating effects.
- The code editor has accessible diagnostics/completion, a bounded frame and reachable test/publish actions at narrow widths and zoom.
- Agent Activity and workflow run inspection identify tool/release/build, input/output validation, safe logs, execution status and failure cause.

The implementation notes are authoritative for current runtime availability. Target capabilities in this document do not by themselves enable an executor, provider or deployment.
