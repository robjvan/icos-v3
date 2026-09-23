# M10b Evidence — Claim Model

**Date:** 2026-09-23. **Scope:** belief record, identity, origin
stamp, repository boundary. No promotion, no read API, no vector
indexing (M10c/d). No repo files outside `core/src` + this note.

## What landed

- `core/src/memory/claim.ts` — `Claim` / `NewClaim` /
  `ClaimEvidence` / `ClaimCategory` / `ClaimStatus` / `ClaimOrigin`
  types, `categoryFromKind` mapping (preference, relationship → own
  categories; everything else → fact; procedure has no extractor
  yet, honestly unmapped).
- `core/src/memory/claim-identity.ts` — conservative normalization
  (case, whitespace, edge quotes; no stemming) + `identityKey`.
- `core/src/memory/claim.repository.ts` — abstract boundary
  (`createClaim`, `getClaim`, `findByTriple`, `appendEvidence`,
  `setStatus`, `listClaims`, `ping`). M10d may implement it on
  vectors; nothing assumes SQLite.
- `core/src/memory/sqlite-claim.repository.ts` — SQLite
  implementation on the memories DB: unique identity convergence
  (duplicate create throws, directs to append), lifecycle
  enforcement (candidate→active, active→contradicted, any→retired),
  REINFORCE append that never rewrites `firstAssertedAt`/`origin`.
- `claims` table in the memories schema + `source_role` ledger
  column (fresh DDL + `addColumnIfMissing` for live files; legacy
  migration untouched — the DEFAULT covers old rows).
- Origin stamp: extractor schema gains `source` (prompt +
  validation, absent → `unknown`), `EXTRACTION_VERSION` bumped to
  `memory-extraction-v2`, service stamps `role` with `?? 'unknown'`
  defense so pre-stamp extractor outputs can never NULL-violate.
- `ClaimRepository` wired in `conversation.module.ts` (no consumer
  yet — M10c).

## Verification

- 529 unit green (33 suites), 44 e2e green, `tsc --noEmit` clean,
  `eslint` clean.
- New: `claim-identity.spec` (normalization conservatism,
  convergence, category mapping), `sqlite-claim.repository.spec`
  (defaults incl. all reserved fields, duplicate refusal,
  triple lookup, evidence append invariants, lifecycle
  enforcement, reopen persistence), pre-stamp ledger rows read
  `unknown` (repository spec), pre-M10b file migration test
  (`database.spec`: old DDL + live row → claims table created,
  role defaults, row preserved).
- Caught live: e2e mock extractor without `sourceRole` exposed the
  NULL-violation path — fixed with `?? 'unknown'` at the mapping
  layer, mock updated to report `user`. Fail-closed behaved as
  designed (extraction dropped, conversation unaffected).

## Deliberate non-goals (kept)

- Message-side attribution stays turn-level (`messageId` is the
  user message; `role` carries the side) — matches the plan's
  "stored, never join-derived" rule.
- Reserved columns exist and read defaults; M10b asserts they stay
  untouched (repository spec).
- `retired` is enforceable but unwritten — no caller until M12.
