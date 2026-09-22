# M9h Evidence — Approval-Aware Planning

## Claim

Resolving an approval no longer ends the turn: the executed result
(or denial) becomes an observation and the run re-enters bounded
planning against its remaining budget. Re-parked mutations need a
new authorization; duplicate resumes converge on the durable answer
without new writes.

## Change

- `core/src/tools/tool-execution.service.ts`: `resume` accepts
  `skipFinal`, deferring the tools-disabled final on continuation
  entries (mirrors `consume`).
- `core/src/conversation/conversation.service.ts`:
  `resumeObservationPair` builds the entry observation (executed
  result, or the mirrored denial state — never invented);
  `resumeTurn`/`resumeStream` continue a parked run through the
  bounded loop (descriptors re-offered, remaining budget from the
  run row, fresh deadline segment) and fall back to a legacy
  single-shot render otherwise; `settleResumeRecord` converges
  terminal-run duplicates onto the last step's durable answer
  (succeeded final or closed text) instead of inventing a second
  answer and transcript write.
- `continuationPair` generalized beyond search (turn-loop behavior
  unchanged: only executed steps pair).

## Unit + e2e

- `tsc --noEmit` clean, `eslint` clean.
- Unit: new resume-continuation block (plan-again after approval,
  reconsider after denial with no mirror text persisted, re-park
  with a new approval id, streaming continuation with one terminal
  done, duplicate-after-continuation identical with a single
  transcript write).
- E2E: 38 passed after reworking three tests to continuation
  semantics — including proving the earlier duplicate-resume
  regression (park id no longer resolves post-continuation runs;
  fixed via request-list lookup) and the unfinalized-park-row
  duplicate (fixed via last-step convergence).

## Live run

- Approved rename → continuation proposed a second rename → parked
  again under a new approval (no bypass: new invocation, new
  authorization). Budget forced text; unapproved rename never
  executed; transcript written once.
- Rejected rename → resume → the model reported the denial
  truthfully ("rejected by the approval step, session name was not
  changed") and offered next steps; title untouched; run
  `completed`/`final_answer`.
