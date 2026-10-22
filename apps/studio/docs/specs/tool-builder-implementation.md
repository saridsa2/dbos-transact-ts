# Tool builder implementation

Delivered 19 October 2026: the first pure-code release of the [tool builder and CLI](tool-builder-and-cli.md). This is a shared browser/CLI implementation, not two separate tool formats.

## Use it

Open **Tools** in the workspace navigation. Create a tool to get a working TypeScript source file, input/output schemas and a fixture. Edit the package files in CodeMirror. Save draft, run Test fixtures, then Publish and Enable. Publication and enablement require an owner/admin; editors may save and test. The schema and SDK completions are available in the source editor. Semantic server diagnostics include file/line/column. Invalid drafts remain saveable.

The browser uses official Untitled UI controls, tabs, table and dialogs. The editor has bounded file, source, test and inspector viewports; at narrow widths Details opens the inspector without hiding its controls permanently. Header actions stay outside the scroll regions. The output/log panels are developer inspection surfaces; ordinary agent replies remain separate from raw Activity.

An enabled agent tool is discoverable through `agent_tool_search_v1`; its release/source/build hashes are captured with work provenance. Agent Activity includes its bounded logs. A workflow Step can select the tool's `workspace_tool.<uuid>.r<revision>` handler from the registered-operation list. The shared executor runs inside the existing DBOS checkpoint, without nested steps. Current workspace membership and enablement are checked at dispatch. Completed checkpoints replay recorded results even if the tool is later disabled.

## Developer CLI

From `apps/studio`:

```sh
npm run build:tools-cli
node cli/dist/stackproc.mjs --help
```

Create a distributable package with `npm pack ./cli --pack-destination .studio/tools`. The CLI package contains its executable, compiler worker and QuickJS worker. It has not been published to npm. Install the resulting tarball on a developer machine using Node 22.13 or later:

```sh
npm install --global /path/to/stackproc-cli-0.1.0.tgz
stackproc auth login --server https://your-stackproc-origin.example
```

Login prints a browser URL and a one-time approval code. Approve the matching code from your signed-in Stack Proc browser in the intended workspace. The developer token is scoped to that workspace, valid for one hour, checked against current roles and revocable through logout. Interactive token storage currently supports macOS Keychain. CI and other platforms can provide a short-lived `STACKPROC_TOKEN` from their credential manager; no plaintext token file is written. Browser authentication remains behind the existing AuthAdapter. This does not implement an enterprise STS issuer or AWS credential exchange provider.

```sh
stackproc tools init sum-values --language typescript
cd sum-values
stackproc tools validate
stackproc tools test --fixture basic
stackproc tools upload .
stackproc tools test --remote
stackproc tools diff
stackproc tools publish --hash <hash-returned-by-upload>
stackproc tools enable --revision 1
stackproc tools pack --output ../sum-values.sptool
stackproc tools pull <tool-uuid> --output ../downloaded-tool
stackproc tools history <tool-uuid>
stackproc auth logout
```

`--server`, `--workspace` and `--profile` select the target; CI may use `STACKPROC_SERVER`, `STACKPROC_WORKSPACE` and `STACKPROC_TOKEN`. Workspace selectors currently use workspace IDs. `publish` and `enable` operate on the current package directory. `pull`, `history` and `inspect` use a tool UUID. All command results are JSON. Unrecognized flags are rejected rather than ignored. The scaffold generates TypeScript; JavaScript implementations can use JSDoc types. Validation regenerates `.stackproc/types.d.ts`, the local SDK declarations and a non-uploaded IDE tsconfig.

Upload accepts a package directory or `.sptool`. Source files are allowlisted; symlinks and special files are rejected. Upload/publish keys are persisted before dispatch and retained across interrupted requests. Stale UI/CLI heads conflict rather than overwriting each other. Pull refuses to overwrite existing files. Browser export/import uses the same hashed `.sptool` envelope.

## Runtime and persistence

The server rebuilds source in a disposable, memory-limited compiler worker with a 15-second ceiling. It uses the pinned TypeScript checker and esbuild resolver, accepts package-local imports and rejects external/dynamic imports. Source is never imported into the Studio host. QuickJS executes the bundle with typed JSON boundaries and bounded logs, memory, output and time. The current function-body executor adds a 100,000-character compiled-source ceiling below the package format's maximum bundle size.

Tool heads, immutable source snapshots, build/test evidence, releases, availability and command receipts are stored in Postgres. Source/build payloads currently live in JSONB, so they are durable and shared by workers. A separately configured blob-store provider is not implemented. Publication requires successful server tests of every declared fixture for the current snapshot/toolchain and rejects reuse of a semantic version for different content. Test suites are bounded to 30 seconds after compilation.

Browser tests stream compile/fixture/final-receipt events over SSE. Tests run in the request lifecycle and can be stopped; completed test receipts persist. This initial release does not provide a durable background test queue or resume a half-finished test after server termination. If the connection is lost, inspect Test history before rerunning. Pure tests have no external effects.

## Remaining target capabilities

The next runtime profile is `operation-js-v1`: isolated preparation/formatting around one host-owned, connection-bound registered operation or MCP offering. It is not enabled by the pure-code release. General network calls, customer-uploaded Node modules, Python runtimes, arbitrary npm dependencies and host callbacks remain unavailable.

Other remaining specification work: schema-driven test-input forms, draft watch synchronization, historical-revision CLI pull, a separate toolkit npm distribution, general JSON Schema-to-TypeScript coverage, full TypeScript-language-service completion, richer source diff/merge UI, durable queued test execution, independently configured artifact providers, additional OS credential stores and enterprise workload-federated CI login. The CLI currently displays changed files with both contents for review; it does not silently merge them.

## Verification

- Compiler/isolate tests: typed/local imports, stable hashes, invalid schemas/source, output validation and execution timeout.
- Package tests: exact source round-trip, size/path/integrity rejection.
- Isolated Postgres lifecycle/access suite: upload replay/conflicts, exact-hash publication, invalid drafts versus released code, enable/disable and tenant isolation; device approval, current-role checks and revocation; packaged CLI local test, upload, remote test, publish, enable and pull.
- DBOS integration: agent discovery and invocation of the authored tool; workflow checkpoint replay after process termination, preserving a recorded random result even after the tool is disabled.
- Existing runtime and harness integration regression suites, TypeScript and production build.
- Browser: creation, file navigation, fixture execution, publication and responsive inspector.

## Editor panel refinement — 2026-10-20

The manual tool editor uses `react-resizable-panels` for the Files/code columns and code/results rows. Visible separators support pointer dragging, keyboard adjustment and double-click reset. The single task header includes the active file, draft/version status and tool actions. Files and Results have minimize icons on their headers; collapsed edges retain restore icons. Minimize and restore animate for 220ms, with reduced-motion support. The Details inspector was removed; manifest and schema files stay in Files. New file uses Untitled UI’s `FilePlus01` icon and the installed input-field-modal composition with a labeled full-width path input, inline validation, close control and Cancel/Create footer. Panel tab headers use balanced top/bottom padding; hidden panels are inert and can always be reopened. Collapsing does not unmount CodeMirror or change the draft. Layout preferences are local to the browser and independent of saved source. Testing opens the results panel. At narrow widths Files starts collapsed.

File names use regular-weight Geist; headings and tabs use medium weight. The active path is not a bold heading. Code and gutters use locally bundled JetBrains Mono Regular at 14px. Scrolling stays inside Files, the source editor, results or the inspector, with the editor toolbar and task actions fixed.

### Tool references in agent instructions

Agent responsibility Markdown resolves exact registered built-in tool names in prose and inline code to `ToolLink`, composed from the official Untitled UI link button. Existing Markdown links and fenced code blocks are preserved; unknown names do not receive speculative destinations. `ToolLink` also accepts a workspace tool ID for `/tools?id=…` references.

Built-in references open `/tools?capability=…` in the same fullscreen tool editor, with read-only installed implementation source and input schema as a supporting file. The file explorer, CodeMirror and resizable/minimizable panels are shared with workspace tools. Descriptions are shared with model offerings in `lib/agent/tool-catalog.ts`; schemas come from the canonical `toolArguments` registry. Opening a reference neither executes a tool nor grants access. Unknown capability URLs show an unavailable state. Validation: reference-transform tests, production build, and Chrome click-through from the published workspace agent to `memory_search_v2`.

The Tools catalog includes registered built-in tools alongside workspace code tools, with a Type column and built-in/workspace filters. Search covers built-in identifiers, display labels and descriptions. Built-in rows have read-only inspection actions and show “Agent policy” availability rather than implying workspace-wide enablement. Workspace code tools retain publishing, download and archive controls.

Built-in source is loaded through authenticated `GET /api/tools/builtins/:name` after workspace read authorization. The server maps registered names to an explicit allowlist of source paths; client input is never treated as a path. The response includes the implementation, runtime dispatcher, shared description source, generated input schema and a SHA-256 source snapshot hash. These are installed source files, not an editable standalone package or an assertion of a historical execution’s source version. Shared modules may contain multiple tools. Missing installed source returns an explicit unavailable state. Built-in inspection exposes no save, publish, enable or test execution actions. Validation covers exact source content, all registered names, traversal/unknown names, authorization, production build and Chrome file inspection.

Both tool kinds now share a hierarchical file list with per-level indentation, collapsible folders and official file-type icons. Tool descriptions live in README.md rather than Results. Markdown files open in a rendered GFM Preview tab with a Markdown source tab using the existing CodeMirror editor; workspace source edits retain the existing draft/save flow and built-in source stays read-only. Results retains Problems, Output, Logs and Test history, with explicit empty states for built-ins rather than fabricated execution receipts.

## Workspace API keys and Procczar CLI (2026-10-22)

Workspace → API keys is an owner/admin-only work area. Named keys are shown once, SHA-256 hashed at rest, scoped to one workspace and its creator's live membership, and expire after 7, 30 or 90 days. Revocation takes effect on subsequent requests. Creation and revocation are audited without credential values. API keys cannot create or manage other keys. The immutable tool migration 002 adds key persistence without rewriting migration 001.

Keys authorize only `/api/tools` and its child routes, with separately selectable read, upload/edit, test, publish and enable/archive permissions. Existing server role checks still apply. An API key does not authorize process execution or general workspace administration. Use the browser session to manage keys.

The CLI exposes `procczar` and retains `stackproc` as a compatibility alias. Set `PROCCZAR_SERVER`, `PROCCZAR_WORKSPACE` and `PROCCZAR_API_KEY` from a credential manager; `procczar auth status` validates current access. On macOS, `procczar auth login --api-key-stdin --server https://your-host` validates then stores a piped key in Keychain. Keys never enter profile JSON or CLI output. Local logout removes an API key from Keychain without revoking it; revoke through the workspace UI. Existing browser/device login and legacy STACKPROC environment variables remain supported.

Visible branding is Procczar. The existing PC monogram paths and colours are retained on a white background; legacy asset URLs remain compatible.
