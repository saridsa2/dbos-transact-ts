# Mem0 OSS provider adapter

Pinned npm package: `mem0ai@3.3.1` (Apache-2.0). See `PROVENANCE.json`, retained `LICENSE`, and `provider-injection.patch`.

`index.mjs` is an attributed adaptation of the published OSS bundle. It exposes constructor injection for the host embedder, LLM, vector store and deterministic memory ID. Telemetry and promotional notices are disabled; the host disables entity boosts, inference and optional history. No Mastra runtime or enterprise source is bundled here. Mastra's observation/reflection architecture informed the independently implemented history coordinator; its prompts were not copied.

The upstream package's own locked dependencies must resolve alongside this adapted bundle, especially its Zod version. `scripts/prepare-memory-vendor.mjs` verifies both SHA-256 hashes and installs the adapter as `mem0ai/dist/oss/stackproc.mjs`. The application postinstall runs that script. After an intentional install with scripts disabled, run it explicitly. It does not download software or execute package-provided scripts. Never edit the installed generated file directly.

To upgrade: inspect the exact published OSS artifact and its dependencies/licenses, regenerate the narrow patch and hashes, retain applicable upstream notices, and rerun model-boundary, isolation, encryption, idempotency, revocation and outbound-request tests. Do not bypass hash verification or replace the adapter with unmodified `Memory` defaults.

Direct runtime dependencies of the copied bundle retain their own licenses: `openai` Apache-2.0, `uuid` MIT, `axios` MIT, `zod` MIT, and optional `better-sqlite3` MIT. Versions and transitives are pinned by the application lockfile. SQLite is never constructed in the injected host configuration. There is no upstream root NOTICE in the reviewed source revision; the original license is included because the published npm tarball omitted it.
