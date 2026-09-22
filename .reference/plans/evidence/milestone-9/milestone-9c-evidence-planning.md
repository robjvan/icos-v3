# M9c Evidence — Tool Selection and Planning

## Claim

Every reasoning step receives an explicit planning frame — the turn
goal, tool policies (which tools run immediately vs pause for
approval), and the total step budget — so the model selects actions
with the run's constraints in view rather than inferring them from
history alone.

## Change

- `core/src/agent/planning-context.ts` (new): pure
  `buildPlanningBlock({goal, tools, maxToolSteps})` rendering a compact
  `<assignment>` block. Static per turn by design; step-varying state
  (remaining budget, fresh observations) belongs to M9k.
- `core/src/conversation/conversation.service.ts`: the block merges
  into the system message in `prepareTurn` alongside the existing
  steering. The wire tool schema is untouched (stays canonical);
  planning context is prompt-level only.

## Unit + e2e

- `tsc --noEmit` clean, `eslint` clean.
- Unit: 483 passed, including builder specs (goal/policy/budget
  content, trim, empty tool list) and a wiring test asserting the
  exact system content reaching the model. Five existing
  system-content expectations updated for the intentional prompt
  change; no positional context assertions moved.
- E2E: 38 passed.

## Live run

- Server: working tree on `dev`, `PORT=3104`, tmp SQLite files,
  memory extraction off. Provider: OpenRouter
  `deepseek/deepseek-v4-flash-0731`.
- Seed turn: the model searched, then proposed an unprompted rename;
  approve → resume completed the run (4 iterations, 4 tool calls).
- Follow-up question: the model chained 2 searches in one turn
  (3 iterations) and answered truthfully from the actual matches
  (nothing persisted yet — the seed turn had parked — so it correctly
  reported no transcript content rather than inventing any).
- `agent_runs` rows show completed runs with goals, step counts, and
  the approval pointer; every step request resolves to a ledger row.

## Deliberately not claimed

Per-step budget restatement and observation summarization (M9k);
goal revision mid-turn; symbolic planning (not needed — the
model-driven loop with explicit constraints demonstrates the M9c
example flow end to end).
