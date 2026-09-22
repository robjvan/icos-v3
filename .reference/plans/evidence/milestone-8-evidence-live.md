# M8 Live Evidence — Tool Turns via Ollama

## Setup

- Commit: wiring slice `5570d28` on `dev` (M8a `61f0ae6`, M8b `405e5d8`, M8c `430adeb`, M8d `9df8763`).
- Server: `core/dist` built from the working tree, `PORT=3101`, tmp SQLite files.
- Provider: Ollama OpenAI-compatible endpoint, model `gemma4-e4b-unc:latest`.
- `violet:latest` was probed first and rejected: `does not support tools` (400). `gemma4-e4b-unc:latest` emits well-formed `tool_calls` with `finish_reason: tool_calls`.
- Memory extraction disabled for the run to isolate the tool path; skills enabled with an empty catalog.
- Full request/response log: `/tmp/icos-live/flow.json` (local run artifact, not committed).

## Session `477e4f3e-2fe3-4373-beb1-00efe261479d`

| Step | Request | Result |
|---|---|---|
| Seed text turn | `I collect teal notebooks and brass keys.` | 200 text reply, transcript persisted |
| Search turn | `What did I just say I collect?` | 200 `ok`, `tool.session.search`, reply consumed the actual FTS match |
| Rename turn | `Please rename this session to Ward map.` | 202 `approval_required`, bound approval, nothing persisted |
| History while pending | `GET /core/conversation/:id` | 4 messages only — pending turn wrote nothing |
| Approve | `POST /core/approvals/:id/approve` | 200 approved |
| Resume | `POST /core/conversation/resume` | 200, title set to `Ward map`, reply from durable final |
| Duplicate resume | same | 200 identical reply in 4ms, no re-execution |
| Restart + resume | server killed, restarted on same DB files | 200 identical durable reply |

## Ledger afterwards (`tool_requests`)

- 1 `closed` text turn, transcript `written`.
- 1 `succeeded` search invocation with a real scoped match (`messageId` 9 in the live session only), final `succeeded`, transcript `written`.
- 1 `succeeded` rename invocation bound to the approved approval, final `succeeded`, transcript `written`.
- Zero duplicate or orphan rows.

## Invariants demonstrated live

- Model-selected permitted tool with structured arguments, validated before execution.
- Approval required and enforced for the mutation; pending state wrote nothing.
- Exactly one execution per invocation across approve/resume/duplicate-resume/restart.
- Structured call/result persisted independently of conversation completion and consumed by the model (search answer quoted the actual match; rename reply confirmed the actual title).
- State survived process restart; resume after restart re-executed nothing.
- Fork/undo and provider-failure paths are covered by unit + e2e tests, not by this run.
