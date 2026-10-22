# Graph Memory source adaptation

Original: https://github.com/adoresever/graph-memory
Pinned upstream: `5841b1987c3967998818764c9d4238add5f3aa7c` (MIT; LICENSE retained).

This subset contains the local async PostgreSQL port and the upstream personalized
PageRank separated from SQLite loading. The host compiler requires extensionless
TypeScript import specifiers; that vendor-only edit is recorded in PROVENANCE.json.
The local clone retains the unchanged legacy SQLite host interfaces, a parallel
async SQLite repository, its tests, and PostgreSQL usage documentation.

Refresh after reviewing local port changes:

    node scripts/prepare-graph-vendor.mjs /path/to/graph-memory

No agent host, provider fetch client, embedding defaults, context takeover or plugin
runtime is included. PostgreSQL schema is owned by immutable host migration 017;
canonical content, authority, approvals and encryption remain host responsibilities.
