# M9e Evidence — Bounded Multi-Step Tool Turns

## Motivation

Live ledger row `9e0c27ea` (`invalid`, `invalid_call_count`): the model
proposed two `session.search` calls in one response (queries
`"nest server logs stopping"` and `"v2 v3 legacy host"`). Both named
tools we have — the failure was fan-out, not an unknown tool. M8 allows
exactly one call per request, so the turn died with "unusable tool
proposal". M9e chains sequential single-call steps instead.

## Change

- `core/src/conversation/conversation.service.ts`: `converse` and
  `converseStream` run a bounded loop (`MAX_TOOL_STEPS = 5`). Completed
  approval-free searches append an assistant/tool pair (durable
  invocation ids) and propose again; parks, text, and invalid proposals
  end the turn through the unchanged render path. Bound exhaustion
  finalizes via the existing `resume` path. System prompt steers one
  call per response (`TOOL_STEP_INSTRUCTION`).
- `core/src/tools/tool-execution.service.ts`: `consume` accepts
  `skipFinal`, deferring the tools-disabled final on intermediate steps.
  Ledger states, claims, and exactly-once semantics unchanged;
  `recentExecutions` already resolves pairs from execution rows.

## Unit + e2e

- `tsc --noEmit` clean, `eslint` clean.
- Unit: 466 passed (28 suites), including new `multi-step turns`
  block (search→text chaining with pair-context assertions,
  rename-after-search parks with no writes, fan-out still fails
  closed, streaming per-step tool events with one terminal done),
  `skipFinal` defer/finalize test, and bound-exhaustion finalize test.
- E2E: 37 passed, including reworked search-turn chaining assertion
  and bound-exhaustion failed-final delivery.

## Live run

- Server: working tree on `dev`, `PORT=3103`, tmp SQLite files,
  memory extraction off.
- Provider: OpenRouter `deepseek/deepseek-v4-flash-0731` (streaming).
- Seeded one session with two facts, then asked for both back in one
  turn. The model chained **3 × `session.search`** in a single turn
  (`meta → token* → tool → tool → tool → done(ok)`) and answered both
  parts correctly from the actual matches.
- Rename still parks (`approval_required` + bound approval) and
  completes through approve → `resume-stream` with the title durably
  set; duplicate resume answers identically with no re-execution.
