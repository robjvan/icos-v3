# M9m Evidence — Verification (agent-level invariants)

## Claim

The M9 verification list is covered by named tests, not just by
construction: planning, loop, approval, termination, and recovery
invariants each have at least one test that would fail if the
invariant broke. This file maps invariants to tests; the suites are
the evidence.

## Coverage map

Planning (model receives goal/tools/observations/constraints):

- system prompt carries goal, tool policies, budget
  (`conversation.service.spec`: framing test; `planning-context.spec`)
- next decision sees previous results as pairs
  (chaining/pair-context tests; e2e scoped-search turn)
- stops without a tool when appropriate (text-turn tests)

Loop:

- multiple sequential calls in one turn (chained unit tests; e2e
  identity test below)
- distinct durable identities per step, results bound to invocations
  (e2e `keeps distinct durable identities across chained steps`:
  two executed rows, distinct invocation ids, run references both,
  single transcript pair)
- no fabricated results (pair content asserted against execution
  payloads in failed-chain and observation specs)
- no auto-repeat (duplicate-resume tests across converse/resume,
  stream, and continuation paths)

Approval:

- parks with no transcript and no execution row
  (e2e park test now asserts `execution_json IS NULL`)
- resumes the correct invocation, duplicates answer identically
  (e2e park/resume/duplicate, undo, restart suites)
- rejection becomes a reconsideration round (unit + e2e)
- re-park needs a new authorization (unit)
- planner cannot bypass approval (unapproved mutations never
  execute — park rows carry no execution by construction, asserted)

Termination:

- clean completion, step/tool budgets, deadline, cancel, turn error
  (unit terminal mapping tests; bound/exhaustion tests)
- provider failure does not rerun completed tools (e2e failed-final
  + duplicate; restart test below)
- pathological repetition terminates at the bound (fan-out test:
  six rounds, then fails closed, zero executions)

Recovery:

- final fails → restart → durable answer, no re-execution, no new
  LLM call (e2e `recovers a failed final across restart
  without re-executing`)
- parked approval → restart → approval survives → approve → resume
  continues planning (e2e `resumes a parked approval across
  restart`)

## Unit + e2e

- `tsc --noEmit` clean, `eslint` clean.
- Unit: 501 passed. E2E: 42 passed.

## Live run

No new live run for M9m: it systematizes existing behavior, and
every invariant above was demonstrated live in the M9a–M9i evidence
runs against real providers (Ollama and OpenRouter).
