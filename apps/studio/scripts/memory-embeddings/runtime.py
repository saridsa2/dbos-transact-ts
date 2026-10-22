"""Local, text-only EmbeddingGemma 2 runtime. Never logs submitted text.

Download is an explicit provisioning operation; serving and benchmarking are offline.
Google model weights are Apache-2.0 and are not distributed in this repository.
"""
import argparse
import json
import math
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL = "google/embeddinggemma-2"
REVISION = "914f7f89142e33e77833254d9c9b90c3cef7303b"
DIMENSIONS = 768
IDENTITY = f"sentence-transformers:{MODEL}@{REVISION}:text:f32:retrieval-v1:{DIMENSIONS}"


def load(device):
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["TOKENIZERS_PARALLELISM"] = "false"
    import torch
    from sentence_transformers import SentenceTransformer
    torch.set_num_threads(min(8, os.cpu_count() or 1))
    model = SentenceTransformer(
        MODEL, revision=REVISION, local_files_only=True, trust_remote_code=False,
        device=device, config_kwargs={"vision_config": None, "audio_config": None},
        model_kwargs={"dtype": torch.float32},
    )
    model.eval()
    return model


def encode(model, text, action):
    if not isinstance(text, str) or not text.strip() or len(text.encode("utf-8")) > 32000:
        raise ValueError("Invalid embedding input size.")
    if action not in ("add", "search"):
        raise ValueError("Invalid embedding task.")
    prompt = "title: none | text: " if action == "add" else "task: search result | query: "
    tokens = model.tokenizer(prompt + text, truncation=False)["input_ids"]
    if len(tokens) > min(8192, model.max_seq_length):
        raise ValueError("Embedding input exceeds the token limit; split the document first.")
    vector = model.encode(text, prompt=prompt, normalize_embeddings=True, show_progress_bar=False).tolist()
    if len(vector) != DIMENSIONS or not all(math.isfinite(v) for v in vector) or not any(vector):
        raise RuntimeError("Invalid embedding result.")
    return vector


def serve(model, device, port):
    lock = threading.Lock()
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def setup(self):
            super().setup()
            self.connection.settimeout(5)

        def reply(self, status, body):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def authorized(self):
            # Reject browser-origin traffic; only the local application uses this protocol.
            return not self.headers.get("Origin") and self.headers.get("X-Stackproc-Embedding") == "1"

        def do_GET(self):
            if not self.authorized():
                return self.reply(403, {"error": "Local application access only."})
            if self.path != "/health":
                return self.reply(404, {"error": "Not found."})
            self.reply(200, {"model": IDENTITY, "dimensions": DIMENSIONS, "device": device,
                             "revision": REVISION, "local": True, "textOnly": True})

        def do_POST(self):
            if not self.authorized():
                return self.reply(403, {"error": "Local application access only."})
            if self.path != "/embed":
                return self.reply(404, {"error": "Not found."})
            if self.headers.get("Content-Type") != "application/json" or self.headers.get("Transfer-Encoding"):
                return self.reply(400, {"error": "Expected bounded JSON request."})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 64000:
                    raise ValueError("Invalid request size.")
                request = json.loads(self.rfile.read(length))
                if not isinstance(request, dict) or set(request) != {"text", "action"}:
                    raise ValueError("Invalid request fields.")
                if not lock.acquire(blocking=False):
                    return self.reply(503, {"error": "Local embedding runtime is busy."})
                try:
                    vector = encode(model, request["text"], request["action"])
                finally:
                    lock.release()
                self.reply(200, {"model": IDENTITY, "embedding": vector})
            except (ValueError, UnicodeError):
                self.reply(400, {"error": "Invalid input or token limit exceeded."})
            except Exception:
                # No exception details: tokenizers and model libraries can include input text.
                self.reply(500, {"error": "Local embedding inference failed."})

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    print(json.dumps({"ready": True, "model": IDENTITY, "device": device, "port": port}), flush=True)
    server.serve_forever()


def benchmark(model, device):
    # Synthetic banking cases; no customer records or actual bank policy.
    documents = [
        "Before opening a corporate account, identify the natural persons who ultimately own or control the company and verify their identities.",
        "Screen the applicant against sanctions lists. Escalate potential matches to compliance for independent review before onboarding proceeds.",
        "Retain the customer due diligence evidence, approval decisions and supporting documents in the audit record.",
        "A corporation is a legal entity distinct from its shareholders. An account holder is the party in whose name an account is maintained.",
        "The office cafeteria serves lunch between noon and two o'clock.",
        "A loan repayment schedule specifies principal, interest and payment due dates.",
    ]
    queries = [
        ("How do we check who really owns a business?", 0),
        ("What should happen if a customer appears on a restricted party list?", 1),
        ("Where should evidence of KYC approvals be kept?", 2),
        ("What is the difference between a company and the party named on an account?", 3),
        ("When are the interest and principal payments due?", 5),
    ]
    start = time.perf_counter()
    encode(model, "Memory readiness check", "search")
    warmup = time.perf_counter() - start
    vectors = [encode(model, d, "add") for d in documents]
    results, times = [], []
    for query, expected in queries:
        start = time.perf_counter()
        q = encode(model, query, "search")
        elapsed = (time.perf_counter() - start) * 1000
        times.append(elapsed)
        scores = [sum(a*b for a, b in zip(q, v)) for v in vectors]
        ranked = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)
        results.append({"query": query, "expected": expected, "top": ranked[0],
                        "correct": ranked[0] == expected, "scores": scores, "latencyMs": elapsed})
    print(json.dumps({"model": IDENTITY, "device": device, "warmupSeconds": warmup,
                      "top1Correct": sum(r["correct"] for r in results), "cases": len(queries),
                      "medianQueryMs": sorted(times)[len(times)//2], "results": results}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["download", "serve", "benchmark"])
    parser.add_argument("--device", choices=["cpu", "mps"], default="cpu")
    parser.add_argument("--port", type=int, default=11435)
    args = parser.parse_args()
    if args.command == "download":
        from huggingface_hub import snapshot_download
        print(snapshot_download(MODEL, revision=REVISION))
    else:
        start = time.perf_counter()
        model = load(args.device)
        print(json.dumps({"loadedSeconds": time.perf_counter() - start}), file=__import__("sys").stderr)
        if args.command == "serve":
            encode(model, "Memory readiness check", "search")
            serve(model, args.device, args.port)
        else:
            benchmark(model, args.device)
