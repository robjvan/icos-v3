# M9d Evidence — Observation and Context Update

## Claim

Tool results become observations linked to their invocations, derived
from the M8 ledger — never duplicated or reconstructed. Failures stay
failures, unknown stays unknown, and rows without a durable execution
(pending, parked, invalid) yield no observation.

## Change

- `core/src/agent/observation.ts` (new): `RunObservation`
  (request/invocation/tool/args/status/result) plus
  `observationFromRecord` and `observationStatus`. Status derives
  from the execution payload: `ok` → succeeded, `unknown` code →
  unknown, any other failure → failed. No execution → undefined.
- `core/src/agent/agent-run.repository.ts`: `observations(runId)`
  walks the run's step request ids in order and maps each executed
  ledger row; missing rows and unexecuted rows are skipped, malformed
  rows are skipped, never thrown.
- `core/src/conversation/conversation.service.ts`:
  `continuationPair` now builds from the step observation, so the
  loop reasons from the same authoritative result the run records.
  Behavior unchanged (refactor, covered by existing chaining tests).

## Unit + e2e

- `tsc --noEmit` clean, `eslint` clean.
- Unit: 489 passed, including observation mapping specs
  (success/failure/unknown/no-execution), repository derivation specs
  (step order, invocation linkage, unknown preserved, invalid and
  missing rows excluded), and a loop test chaining after a failed
  search with the failure payload observable in the next proposal.
- E2E: 38 passed (one transient single-test failure observed on one
  run, green on the immediate rerun and three subsequent runs —
  believed flaky, see below).

## Live run

- Server: working tree on `dev`, `PORT=3103`, tmp SQLite files,
  memory extraction off. Provider: OpenRouter
  `deepseek/deepseek-v4-flash-0731`.
- Run 1 (seed + unprompted rename): 4 succeeded `session.search`
  executions + 1 parked `session.rename` with no execution row.
  Per the derivation rule this run observes exactly the 4 searches;
  the parked rename yields nothing until executed. Run state stayed
  `awaiting_approval` (never approved — correct).
- Run 2 (recall + rename): 1 succeeded search + 1 approved rename,
  both executed; run `completed` with both observations linked by
  invocation id. Every step request resolved to its ledger row.

## Deliberately not claimed

No run read API (observations are consumed internally and in tests;
M9n demos will surface them). Validation failures still fail the
turn rather than returning to the model (M9i may revisit). The
single e2e flake needs a name if it recurs — it did not reproduce
in four following runs.
