# M9a Evidence — Agent Run State

## Claim

Every non-command conversation turn persists one `agent_runs` row
capturing goal, session, step request ids (referencing M8 ledger rows
by convention), counters, limits, approval pointer, and terminal state
— without changing turn behavior, and with tracking failures isolated
from conversation.

## Change

- `core/src/session/database.ts`: new `agent_runs` table (IF NOT
  EXISTS, so old files upgrade on boot) registered for schema verify.
- `core/src/agent/agent-run.repository.ts` (new): concrete synchronous
  repository — `createRun`, `recordStep`, `markParked`, `markTerminal`,
  `get`, `findByRequest`. Lifecycle values are provisional (`running`,
  `awaiting_approval`, `completed`, `failed`); M9b owns the machine.
- `core/src/conversation/conversation.service.ts`: the turn loop
  starts/records/parks/completes runs; resume paths resolve the run by
  step request and complete it. All tracking calls are isolated
  try/catch + warn: observation can never fail a turn.

## Unit + e2e

- `tsc --noEmit` clean, `eslint` clean.
- Unit: 476 passed, including 7 repository tests over real SQLite
  (CRUD, counters, park/terminal, request lookup, unknown-run
  rejection, session-cascade delete) and 5 wiring tests (per-turn
  record shape, park pointer, resume completion, failure marking,
  tracking-failure isolation).
- E2E: 38 passed, including direct DB read-back of a turn's run row
  (goal, `completed`, one step request matching the response
  `requestId`, limits, `final_answer` termination).

## Live run

- Server: working tree on `dev`, `PORT=3103`, tmp SQLite files,
  memory extraction off, empty skills.
- Note: OpenRouter calls failed during this run (account key emptied
  in local `core/.env` → provider 401s). Those turns correctly 502'd
  and their runs recorded `failed` / `turn_error` with zero steps —
  the failure path working as designed. The evidence turns below ran
  against local Ollama `gemma4-e4b-unc:latest`.
- Two text turns in one session produced two `completed` runs with
  goal text, one step request each, `toolSteps: 0`,
  `limits {maxToolSteps: 5}`, and every recorded request id resolving
  to a `closed` row in `tool_requests`.

## Deliberately not claimed

No lifecycle machine (M9b), no planner distinction (M9c), no
observation model beyond ledger references (M9d), no run read API
(verification used direct DB reads in tests/live). Retried duplicate
POSTs create a second run row each — dedup is future work.
