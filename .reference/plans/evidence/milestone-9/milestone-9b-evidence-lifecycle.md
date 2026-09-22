# M9b Evidence — Agent Lifecycle

## Claim

Runs move through an explicit persisted lifecycle — `created` →
`reasoning` → `action_proposed` → `executing` → `observing` (per step),
`awaiting_approval` on park, and terminal `completed` / `failed` /
`cancelled` / `budget_exhausted` — with bound exhaustion and client
disconnect terminating truthfully instead of masquerading as success.

## Change

- `core/src/session/database.ts`: `agent_runs` CHECK expanded to the
  ten-state set, plus `migrateAgentRuns` rebuild for M9a-era files
  (stranded `running` rows map to `failed` with their executed count;
  all other states carry over; idempotent reopen).
- `core/src/agent/agent-run.repository.ts`: `transitionRun` for
  transient states; `markTerminal` accepts the four terminal states;
  `createRun` starts at `created`; termination reasons extended
  (`cancelled`, `step_bound`).
- `core/src/conversation/conversation.service.ts`: the turn loop
  transitions per phase in both streaming and non-streaming paths;
  bound exhaustion marks `budget_exhausted`/`step_bound` (the answer is
  still delivered); a disconnected client marks `cancelled` (stream
  path only — detected via the client abort signal, distinct from
  timeouts); resume drives `executing` then terminal.

## Unit + e2e

- `tsc --noEmit` clean, `eslint` clean.
- Unit: 480 passed, including full transition-sequence assertions
  across chained searches, park/resume terminal flow, bound →
  `budget_exhausted`, abort-signal → `cancelled`, and the rebuild
  migration test (row preservation, stranded mapping, new states
  accepted, old state rejected, idempotent).
- E2E: 38 passed (existing run-row assertions unchanged).

## Live run

- Server: working tree on `dev`, `PORT=3103`, tmp SQLite files,
  memory extraction off. Provider: OpenRouter
  `deepseek/deepseek-v4-flash-0731` (restored account key).
- Text turn → `completed` / `final_answer`, zero tool calls.
- Rename turn → parked with bound `approval_id`, then approve →
  resume → `completed`, title durably set, duplicate-safe as before.
- Transient states are not retained in rows (only the current state
  persists, by design); the per-step sequence is covered by unit
  assertions on transition order.

## Deliberately not claimed

Termination reason taxonomy stays minimal (M9f refines it); budgets
stay a single step constant (M9g); no run read API (M9n demos).
