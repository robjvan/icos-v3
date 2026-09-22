# M9k Evidence — Agent Context Construction

## Claim

Every reasoning step receives the goal, conversation context, tools,
attempted actions, actual results, failures, approval state, and
remaining budget — rebuilt per round so progress never goes stale —
while staying compatible with the session/context infrastructure.

## Change (already committed in `c66cfeb`)

`prepareTurn` splits the static system base from the rest;
`assembleStep` rebuilds (base + fresh planning block + rest + new
pairs) every proposal round with progress (`stepsUsed`,
`toolCallsUsed` with remaining count, `priorActions`, approval
id/decision). Resume continuations rebuild with the same shape
(prompt/catalog refreshed, skill bodies frozen with the turn).

## Unit + e2e (already committed)

- Builder specs (progress/approval lines), assembly ordering specs,
  wiring tests on the exact system content, 508 unit green.

## Live run

- Same run as M9j: per-step blocks observable indirectly — the turn
  used its search result to answer rather than re-searching, and
  the rename→approve→resume cycle completed with the continuation
  carrying the approval decision forward (run row: `completed`,
  approval pointer set, transcript written once).
- Deliberately no epistemic memory (M9 scope boundary holds).
