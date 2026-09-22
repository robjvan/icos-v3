# M9g Evidence — Execution Budgets

## Claim

Turns run under three configured budgets — proposal rounds,
tool executions, wall-clock duration — persisted per run, enforced
in every loop entry (fresh turns and post-approval continuations),
with exhaustion forcing a text answer and a truthful
`budget_exhausted` terminal. Token usage and cost are explicitly
not tracked: provider usage chunks are ignored by design, and run
elapsed time derives from row timestamps.

## Change

- `core/src/config.ts` + `core/.env.sample`: `AGENT_MAX_ITERATIONS`
  (5), `AGENT_MAX_TOOL_STEPS` (5), `AGENT_MAX_TURN_DURATION_MS`
  (900000), all positive-int validated. Defaults preserve exact
  pre-M9g behavior.
- `core/src/conversation/conversation.service.ts`: loop bounds read
  config (rounds, executions, deadline via `turnDeadlineExceeded`
  with injectable limit); run `limits` persist all three; planning
  block states rounds and steps.
- `RunLimits` extended; eleven spec config literals updated.

## Unit + e2e

- `tsc --noEmit` clean, `eslint` clean.
- Unit: 498 passed, including config parse/default/reject tests and
  loop tests proving the iteration and tool budgets force text
  independently (3 proposals then `toolChoice: 'none'`.
- E2E: 38 passed.

## Live run

- Server with `AGENT_MAX_ITERATIONS=2 AGENT_MAX_TOOL_STEPS=2`
  (OpenRouter model): a rename-then-re-park turn hit the round bound
  on resume-continuation and was forced to text — run terminated
  `completed` with transcript intact, second rename left pending and
  unexecuted. Custom budgets enforced, not just documented.
