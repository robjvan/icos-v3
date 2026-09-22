# M9j Evidence — Repetition and Loop Protection

## Claim

Identical single tool calls are detected and skipped before
validation: no ledger row, no execution, no approval, and the model
sees a `repeated_call` error observation it can react to within
budget. Unrestricted repetition terminates at the step bound.

## Change (already committed in `c66cfeb`)

`skipRepeatedCall`/`priorAttempts` in `ConversationService`: context
scan on tool name plus deep-equal args, pre-validation, all four
loops. Skipped steps still record their request id (audit-complete;
observations ignore ids with no ledger row).

## Unit + e2e (already committed)

- Skip without re-execution, terminates-when-only-repeating
  (budget_exhausted), no second approval for repeated renames.
- E2E: identical searches execute once across two proposals.

## Live run

- Server: working tree on `dev`, `PORT=3103`, tmp SQLite files,
  memory extraction off. Provider: OpenRouter
  `deepseek/deepseek-v4-flash-0731`.
- Prompted repeat (`search teal, then search teal again`): 3
  iterations, 1 tool execution, `completed`/`final_answer`. The
  repeat skipped pre-validation and the model answered from the
  single execution.
- Ledger proof: only one `succeeded` search row for the turn; the
  duplicate proposal produced no second row, no second invocation,
  no second approval. The parallel fan-out attempt in the same turn
  was correctly rejected as `invalid_call_count` (a separate row) —
  fan-out still fails closed, repeats skip.
