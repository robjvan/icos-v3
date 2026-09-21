# M9f Evidence — Termination and Completion

## Claim

Every run end maps to an explicit persisted terminal state: clean
answers complete, bound/deadline exhaustion is `budget_exhausted`
(even when an answer is delivered), denials complete as
`approval_denied`, disconnects cancel, and errors fail. Termination
never relies solely on the model deciding to stop.

## Change

- `core/src/conversation/conversation.service.ts`: shared
  `terminalRun` mapping (bound/deadline/denied/clean) used by both
  turn loops and both resume paths; turn deadline backstop
  (`MAX_TURN_DURATION_MS`, 15 min; per-call timeouts already bound
  healthy turns) forces text-only proposals past expiry; stream
  disconnects mark `cancelled` via the client abort signal, distinct
  from timeouts.
- `core/src/agent/agent-run.repository.ts`: termination reasons
  extended (`cancelled`, `step_bound`, `time_budget`,
  `approval_denied`). No schema change (schemaless JSON).

## Unit + e2e

- `tsc --noEmit` clean, `eslint` clean.
- Unit: 491 passed, including pure deadline checks, a
  deadline-exceeded loop test (Date.now spied: forced text answer,
  `budget_exhausted`/`time_budget`), mirrored-rejection denial
  assertion, and the pre-existing bound/cancel coverage.
- E2E: 38 passed, including a direct DB read-back asserting the
  rejected run persists `completed`/`approval_denied`.

## Live run

- Server: working tree on `dev`, `PORT=3103`, tmp SQLite files,
  memory extraction off. Provider: OpenRouter
  `deepseek/deepseek-v4-flash-0731`.
- Rename → reject → resume returned the mirror notice with outcome
  `rejected`; the run row reads `completed` /
  `{"reason":"approval_denied","toolSteps":0}`.

## Deliberately not claimed

Budget configurability and duration tracking precision (M9g);
cancellation outside streaming (no client signal exists there);
`processing` outcomes still complete while background execution is
M8-governed (M9l).
