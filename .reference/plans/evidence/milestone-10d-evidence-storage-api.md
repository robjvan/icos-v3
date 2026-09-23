# M10d Evidence — Claim Storage and Read API

**Date:** 2026-09-23. **Scope:** RuVector substrate integration,
claims read API, journal history trace. Prospective queue stays
M10e (its store doesn't exist yet).

## What landed

- `memory/claim-index.ts` — `ClaimIndex` boundary (`indexClaim`,
  `searchSimilar`, `status`) + `ClaimIndexUnavailableError`.
  SQLite stays the system of record; the index is recall
  acceleration only.
- `memory/ruvector-claim-index.ts` — embedded RuVector
  (`VectorDB` + `OnnxEmbedder`, never `AgenticMemory`), lazy init,
  fail-closed once-and-stays-disabled. Claim text is immutable so
  indexing happens once per claim at commit; no update path.
- Promotion commits index NEW/CONTRADICT claims (best-effort,
  never fails a commit); REINFORCE skips (text unchanged).
- `VECTOR_DB_PATH` config + `.env.sample`; `ruvector@0.3.2`
  dependency (darwin + linux-gnu prebuilds verified).
- `GET /core/claims` (status/category/origin/limit),
  `GET /core/claims/search` (paraphrase, degraded flag on index
  outage), `GET /core/claims/:id` (claim + resolved evidence
  candidates + journal history via new `listByClaimId`).
- `ClaimRepository.listClaims` gained category/origin filters.

## Verification

- 553 unit green, 45 e2e green (claims list/detail/search wired
  through a repository-backed fake index), `tsc`/`eslint` clean.
- **Live run** (rebuilt glibc container, `require('ruvector')`
  loads native): resumed a parked rename turn → 3 v2 candidates →
  3 proposals → approvals → sweep `{new: 7}` across queued rows →
  `GET /core/claims/search?q=what programming language does the
  user like` returns `user prefers TypeScript` top (0.649) →
  claim detail resolves user-origin evidence + `NEW/committed`
  journal history. Every committed claim carries
  `approved:<id>`; zero `auto` (default holds).
- Fail-closed proven at two levels: unit (mocked backend —
  disabled status, typed search error, absorbed writes) and live
  by design (alpine attempt in M10a refused writes outright).

## Notable findings

- **ts-jest cannot init ONNX** (dynamic `import()` needs
  `--experimental-vm-modules`): the real backend is untestable in
  unit specs by environment, not by bug. Unit proves the
  fail-closed contract with a mocked module; live proves the real
  path. Recorded so nobody "fixes" this twice.
- **Agent-loop interference:** two live turns parked on
  `session.rename` approval before any message was written (0
  candidates, healthy system). Memory testing must account for
  M9 tool behavior — approve/resume first, then expect
  extraction. The rename approval → resume → extraction chain
  itself worked flawlessly.
- **Cross-client HITL observed:** 4 queued proposals were already
  approved (frontend testing) when the sweep ran; the journal
  executed exactly those, nothing more. The pull pattern holds
  across clients.

## Open for later slices

- M10e: `prospective_items` store + `GET /core/prospective`,
  negation markers.
- M11: recall ranking/consumption over this substrate; HRR-lite
  associative surface (M10a decision, unbuilt).
- Re-measure RuVector cold-start reopen at 10k+ claims (M10a note).
