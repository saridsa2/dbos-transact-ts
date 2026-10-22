# Local semantic memory

EmbeddingGemma 2 runs in a separate local Sentence Transformers process. MiniMax continues
to handle reasoning and history observation/reflection. This worker does not summarize
history, approve memory, change workspace policy, or execute tools.

## Provision and run

Requires Python 3.12 and `uv`. From `apps/studio`:

```sh
npm run memory:setup
npm run memory:benchmark
npm run memory:serve
```

Setup installs the pinned dependencies into the ignored `.studio/embeddinggemma-runtime-venv`
and explicitly downloads the pinned weights to the Hugging Face cache. The download is
approximately 1.5 GB; loading only text avoids retaining the vision/audio encoders.
Serving and benchmarks use cached files only, disable Hub telemetry, and disallow remote code.
No model request downloads weights. Keep the worker running alongside the application.

For Apple Silicon GPU inference, use `npm run memory:serve -- --device mps`.
CPU is the portable default; both use float32 (float16 is incompatible with this model).

Local smoke evaluation on 2026-10-21 (M5 Max, 48 GB): CPU and MPS each retrieved the
expected document for all five labeled synthetic questions. Median warm query latency was
24 ms on CPU and 21 ms on MPS. These timings exclude model loading and are not a
comparison against another model or a general retrieval-quality claim.

Set `.env.local`, then restart the application service:

```dotenv
STUDIO_MEMORY_EMBEDDINGS_PROVIDER=embeddinggemma
STUDIO_MEMORY_EMBEDDINGGEMMA_URL=http://127.0.0.1:11435
```

No Ollama process, hosted API key, or external inference endpoint is used. The old Ollama
adapter is available only for explicitly configured legacy deployments.

## Runtime contract

- Bind only to `127.0.0.1`; reject browser Origin headers and require the application header.
- `GET /health` identifies the exact model space; `POST /embed` takes `{text, action}`,
  with action `add` for documents and `search` for queries. Inputs and model errors are not logged.
- One inference at a time; busy requests receive 503. Application deadlines remain authoritative;
  an interrupted HTTP client does not cancel computation already running in PyTorch.
- Reject more than 32,000 UTF-8 input bytes or 8,192 tokens, including task prefix, rather
  than silently truncating. Return normalized, finite 768-dimensional vectors.
- Queries use `task: search result | query: `; documents use `title: none | text: `.
- Model revision, precision, task format and dimensions are included in vector identity.
  Existing Nomic vectors are retained in their old namespace and never compared to Gemma vectors.
  The existing bounded Mem0 reconciliation rebuilds only eligible approved memory versions.
- Existing authorization, encryption, revocation checks and memory usage events remain in
  the application. The worker is an inference service, not a second memory database.
- If unavailable, readiness reports unavailable and existing audited retrieval degradation
  applies; there is no silent switch to another embedding provider.

## Verification

`npm run memory:benchmark` uses six synthetic banking/reference passages and five labeled
queries. This is a smoke evaluation, not a general quality benchmark or proof of bank-policy
correctness. Run `-- --device mps` to compare local GPU performance.

```sh
python3 -m unittest discover -s scripts/memory-embeddings -p 'test_*.py'
STUDIO_EMBEDDING_INTEGRATION=1 npx vitest run server/agent/context/embeddinggemma.integration.test.ts
```

## Provenance and license

Model: [`google/embeddinggemma-2`](https://huggingface.co/google/embeddinggemma-2),
revision `914f7f89142e33e77833254d9c9b90c3cef7303b`, **Apache-2.0**. Weights are downloaded
separately and not bundled in this repository. Retain the upstream license and attribution
when distributing model artifacts. This selection refers specifically to version 2.

Runtime libraries retain their own upstream licenses (including Apache-2.0 Sentence
Transformers/Transformers, BSD PyTorch/Torchvision, and Pillow's HPND license).
Dependencies are pinned in `requirements.txt`; regenerate with
`uv pip compile scripts/memory-embeddings/requirements.in -o scripts/memory-embeddings/requirements.txt --python-version 3.12`.

Official usage, text-only loading and precision guidance:
https://ai.google.dev/gemma/docs/embeddinggemma/inference-embeddinggemma-with-sentence-transformers
