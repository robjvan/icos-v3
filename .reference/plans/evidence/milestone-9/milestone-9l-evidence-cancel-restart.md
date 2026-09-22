# M9l Evidence — Cancellation and Restart

## Claim

Runs cancel on demand without touching M8 state, and survive
process death: parked approvals, run rows, and ledger rows
reconstruct truthfully, with no invocation re-executed merely
because the process stopped.

## Change

- `core/src/agent/agent-run.repository.ts`: `cancelRun` marks a
  non-terminal run `cancelled` (idempotent no-op on terminal rows,
  error on unknown). Approval bindings survive cancellation —
  M8 decides execution, never the run row.
- `core/src/conversation/conversation.service.ts` +
  `conversation.controller.ts` + DTO: `POST
  /core/conversation/runs/cancel` (`sessionId`, `runId`) → run id,
  session, state, cancelled flag. 404 unknown, 400 foreign session.
  Cancelled runs take the legacy single-shot resume path (never
  continue planning); parked turns still resolve through M8.
- Cancellation is user-initiated or disconnect-driven only — no
  automatic cancel on timeouts (those fail or exhaust budgets).

## Unit + e2e

- `tsc --noEmit` clean, `eslint` clean.
- Unit: 511 passed, including repo cancel semantics (running and
  parked cancel, terminal idempotent, unknown throws) and service
  cancel tests (parked cancel blocks continuation, unknown/foreign
  rejected).
- E2E: 44 passed, including full cancel lifecycle over HTTP: park
  → cancel (`cancelled: true`) → approval untouched and still
  approvable → resume answers without new tool calls → re-cancel
  no-op → 404/400 paths.

## Live run

- Server: working tree on `dev`, `PORT=3103`, tmp SQLite files,
  memory extraction off. Provider: OpenRouter
  `deepseek/deepseek-v4-flash-0731`.
- Cancel drill: park → cancel (`cancelled: true`) → approve →
  resume answered `ok` with the rename executed through M8. (The
  executed turn then completed the run row — cancellation governs
  planning, not the already-authorized invocation, as designed.)
- Restart drill: parked rename, server killed (`pkill dist/main`),
  rebooted on the same files → approve → resume → `ok`, title
  durably `"Restart drill"`. Run row `completed` with 2 iterations,
  1 tool call. Nothing re-executed; nothing lost.

## Deliberately not claimed

No cancel UI surface yet (endpoint only; thin client frozen). No
in-flight `executing` kill drill (search claims resolve in ms —
unwinnable race; the `unknown` path is unit-covered). Non-stream
turns cannot be cancelled mid-flight (no client signal exists).
