# M10a Evidence — RuVector Evaluation Spike

**Date:** 2026-09-23. **Spike:** `ruvector@0.3.2` (ruvnet/RuVector, MIT).
**Method:** live install + smoke script in `/tmp/opencode/m10a-spike`
(kept out of the repo), plus one container run against the cached
`icos-v3-core` image. No repo files touched.

## Decision

- **Semantic backend: RuVector as an embedded in-process library.**
  `VectorDB` (dumb vector index + free JSON metadata) +
  `OnnxEmbedder` (all-MiniLM-L6-v2, 384d, local ONNX). Explicitly
  **not** `AgenticMemory` or any typed memory layer — RuVector
  stores vectors, ICOS owns what memory means.
- **Associative surface: bespoke HRR-lite in SQLite.** No new
  dependency; v2 proved the shape (SQLite-backed resonance store).
  Token-overlap resonance scoring behind the repository boundary,
  built in M11a.
- **Container base must move alpine → glibc** (`node:24-slim` or
  equivalent) before M10b. One-line Dockerfile change, verified at
  next `docker compose up --build`.

## Question-by-question answers

### 1. What is RuVector here?

A library. `npm install ruvector` → NAPI-RS native binding,
in-process, local files. No server, no network, no API key. The
`ruvector-server` HTTP service and Postgres extension exist but are
not needed. Integration surface: `new VectorDB({ dimensions,
distanceMetric, storagePath })` + `insert / insertBatch / search /
get / delete / len`, all promise-based, TypeScript types included.

### 2. Docker composition fit?

**Not on the current base.** `core/Dockerfile` is `node:24-alpine`
(musl). No `ruvector-core-linux-x64-musl` prebuild is published
(verified 404 on the registry; only `-gnu` variants exist). Live
container test on the cached `icos-v3-core` image produced the
fail-closed error:

```text
Error: [RuVector] No vector backend is available: @ruvector/core
failed to load and @ruvector/rvf cannot substitute for it.
Reads return empty; writes are refused so data is not silently dropped.
```

So alpine = hard no. The gnu prebuilds exist (`0.1.30` confirmed),
Node 18+ is supported (we run 24), and the package needs no build
toolchain (prebuilt binaries — the Dockerfile's python3/make/g++
stays for better-sqlite3 only). Switch to a glibc base and the
existing compose shape is unchanged. Their fail-closed refusal
(reads-empty/writes-refused, never silent drops) matches ICOS
philosophy — noted with approval.

### 3. Record-model fit?

Verified live. Claim-shaped metadata round-trips and filters:

```text
inserted: 1de7b41a 388a3cfb len: 2
unfiltered top: claim-1 score: 0.2387
filtered count: 1 top: claim-1        ← filter: { origin: 'user', status: 'active' }
delete claim-2: true len: 1
```

The M11b provenance lens (`origin`/`status`/`category` filters) is
directly supported by the engine's filtered search. Claim schema
bends nothing toward RuVector: one vector per claim (embedding of
the triple text), all belief semantics in SQLite.

### 4. Down behavior?

In-process library, so "down" = load failure at boot, not a network
partition. Policy: boot-time load check; on failure the semantic
surface is absent, lexical (FTS5) carries the load, responses carry
`memory-degraded`. Writes are never silently dropped (the engine
itself refuses them; Core must surface, not swallow).

### 5. Embedding sovereignty (extra question, answered)

`OnnxEmbedder.init()` loads `all-MiniLM-L6-v2` (87 MB) with one
network download, then `~/.ruvector/models` disk cache
(`RUVECTOR_CACHE_DIR` overridable), 293 ms init / 303 ms first
embed on Apple Silicon with SIMD. Runtime can be 100% offline: bake
the model into the image at build time or volume-mount the cache
dir. No provider, no key, no telemetry observed.

### 6. Cold start caveat (from upstream README, not yet measured)

Reopening a persisted DB enumerates vectors and rebuilds the HNSW
index: 0 ms at our scale (measured, n=1). Re-measure at 10k+ claims
before calling this settled.

## Deferred to M10b implementation

- `Dockerfile`: `node:24-alpine` → `node:24-slim` (keep the
  build toolchain for better-sqlite3).
- `RUVECTOR_CACHE_DIR` + `storagePath` volume planning in compose.
- `ClaimRepository` boundary with RuVector behind it; SQLite-only
  fallback path kept working (M10a's sovereignty backstop stands).
- HRR-lite resonance scoring design (M11a slice).
