# M10c Evidence — Promotion Pipeline

**Date:** 2026-09-23. **Scope:** derivation, hybrid authority,
journal, sweep execution. CONTRADICT *mechanics* live here;
negation markers + clarification surfacing stay M10e.

## Design decisions (from the slice)

- **Trigger: fire-and-forget proposal + explicit sweep execution.**
  The extraction chain proposes (never blocks/fails conversation);
  `POST /core/promotions/run` executes. Same pull pattern as
  tool-approval resume — no hooks in the approvals system.
- **Intent is advisory.** Derivation at proposal time usually sees
  an empty claim store; execution re-derives, so stale NEW rows
  converge to REINFORCE instead of duplicating (proven in spec).
- **Fixed confidence rules:** NEW/CONTRADICT adopt the observation
  (approval is the trust gate); REINFORCE +0.05 capped at 0.99.
  M12 owns compounding.
- **Unknown origin parks visibly** (`failed: unknown_origin`) —
  never defaulted. Affects only pre-stamp legacy rows.
- **Auto path implemented, default-off:** NEW + admitted kind +
  known origin only; REINFORCE/CONTRADICT always HITL. Unknown
  kinds in config fail startup loudly.
- **Contradiction scope:** normalized subject+predicate match,
  different object. Never-active losers retire instead of
  contradict (keeps the single-head invariant M12 chains assume).

## What landed

- `memory/promotion.ts` (operations, journal states, sweep summary),
  `promotion-journal.repository.ts` + SQLite impl (one row per
  candidate, terminal states final, recovery replay),
  `promotion.service.ts` (derive/propose/execute/sweep/recovery).
- `promotion_journal` table + `subject_norm`/`predicate_norm`
  conflict columns (fresh DDL + additive migration + SQL backfill
  for legacy rows; repository writes exact norms).
- `getCandidate` (ledger) and `findBySubjectPredicate` (claims)
  lookups; `MEMORY_PROMOTION_AUTO[_KINDS]` config + `.env.sample`.
- `POST /core/promotions/run`, `GET /core/promotions/pending`.
- Extraction chain proposes after every save; `proposeCandidates`
  never throws.

## Verification

- 545 unit green (incl. 12 promotion specs: HITL default, auto
  opt-in, convergence with rederivation note, contradiction,
  denial, exactly-once, missing-candidate abort, unknown-origin
  park, recovery replay, propose-never-throws), 45 e2e green
  (incl. full approve→sweep→committed loop), `tsc`/`eslint` clean.
- Caught live: e2e mock returned candidates for every message,
  cross-polluting the approvals lifecycle test — mock is now
  message-aware (`I prefer oak` only).
- **Live run** (rebuilt `icos-v3-core`, glibc base healthy): one
  turn → 4 v2 candidates with model-stamped roles (3 assistant,
  1 user) → 4 `memory.promote` approvals → approved the user
  belief → sweep `{new: 1, skipped: 3}` → second sweep all
  skipped, pending queue shows 3 proposed. Claim created with
  `approved:<id>` promotion and user origin.

## Open for later slices

- M10d: claims/prospective read API (live claim verified via
  sweep summary + journal only).
- M10e: negation-marker conflicts, clarification surfacing.
- Future: legacy unknown-origin attribution rule.
