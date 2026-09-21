# M9i Evidence — Failure and Recovery

## Claim

Validation failures return to the model as correctable observations
instead of killing the turn; executed failures and unknown outcomes
keep flowing as themselves; nothing invalid ever executes.

## Change

- `core/src/conversation/conversation.service.ts`:
  `validationFailurePair` renders a rejected proposal as the model's
  raw calls plus one error response each (the ledger's own verdict),
  and all four loops (turn/stream/resume/resume-stream) continue
  into it within budget. Bound exhaustion still fails closed as
  before. Approval rejection and unknown outcomes were already
  observations via M9d/M9h; no change there.
- `core/src/conversation/stub-tool-execution.ts`: `invalidRecord`
  takes a failure code (default preserves existing callers).

## Unit + e2e

- `tsc --noEmit` clean, `eslint` clean.
- Unit: 501 passed, including bad-args recovery (failure JSON
  observable in the next proposal, single transcript write),
  fan-out recovery (the exact production `invalid_call_count`
  incident: reject → sequential search → answer), resume-path
  recovery, and the updated always-fan-out test (retries every
  round to the bound, then fails closed with zero executions).
- E2E: 39 passed, including blank-query rejection recovered over
  HTTP with one transcript pair.

## Live run

- Server: working tree on `dev`, `PORT=3103`, tmp SQLite files,
  memory extraction off. Provider: OpenRouter
  `deepseek/deepseek-v4-flash-0731`.
- Full cycle (seed, recall+rename park, approve, resume) completed
  with both answers delivered; the recovery branch did not misfire
  (no false invalids); zero invalid rows written.
- Production ledger invariant re-verified: the single historical
  invalid row (`9e0c27ea`, `invalid_call_count`) carries no
  invocation id and no execution payload — rejected proposals never
  execute, before and after this slice.

## Deliberately not claimed

Forcing a live invalid proposal on demand (model-dependent;
deterministic coverage sits in unit+e2e). Repetition protection
beyond the step bound (M9j). Retry of unknown mutating outcomes —
currently unreachable (only search claims can go unknown, and
searches are reads).
