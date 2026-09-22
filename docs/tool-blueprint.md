# Tool Blueprint — Adding a Tool to ICOS v3

Fill in Part 1, hand this file plus the completed blueprint to an agent,
and point it at Part 2. Tools are code, not config: the catalog is a
frozen array, and each tool flows through five touchpoints below. There
is no plugin directory and no dynamic registration — deliberately, so
every tool gets validated, approved, executed, and persisted through the
same audited path.

---

## Part 1 — The blueprint (fill this in)

```text
Name:                <dot.case, e.g. session.search> (version: 1)
Description:         <one line, model-facing — this drives when it gets called>
Approval policy:     none | required
                     none     = executes immediately, chainable in the turn loop
                     required = parks for human approval, ends the chain

Arguments:
  - <name>: <type, bounds, required?> ...
  - Unknown fields: rejected (registry rejects extras — list everything)

Reads:               <what it reads, e.g. session transcript via FTS>
Writes:              <what it mutates, e.g. nothing / session title>
                     Any write implies approval: required.

Result shape:        <JSON shape the model sees, must fit 64 KB serialized>
Failure modes:       <what can go wrong, and the failure code for each>
```

---

## Part 2 — Implementation checklist

### 1. `core/src/tools/tool-registry.ts`

- Add the name to `ToolName`.
- Add a `*_SCHEMA` (frozen) and a `validate*Args` parser: plain objects
  only, no inherited properties, reject unknown fields, trim text,
  enforce length/range bounds. Return frozen values.
- Add the `DESCRIPTOR` with `approval` set from the blueprint and wire
  it into `validate()` (name → version → permission → session → args).

### 2. `core/src/llm/llm.protocol.ts`

- Add the snake_case wire alias to `ALIASES` (canonical names never go
  on the wire). The parser resolves aliases back through a
  request-local table, so concurrent requests cannot cross-authorize.

### 3. `core/src/tools/tool-execution.service.ts`

- `validate()`: add the policy branch. `approval: 'none'` tools execute
  in `consume`; anything else must behave as approval-gated.
- Add the executor (see `search()`): read through a repository,
  serialize the outcome, enforce the 64 KB cap. Pure reads return
  `{ ok: true, ... }`; failures return `{ ok: false, failure: { code } }`
  — never throw domain errors.
- `respond()` needs no change (tools-disabled final already generic).

### 4. `core/src/tools/tool-execution.repository.ts` (only if the tool writes or gates)

Approval-free reads need nothing here. Anything else must generalize
the current `session.rename` name checks — do not add a third hardcoded
name:

- `register()`: derive `awaiting_approval` vs `validated` and the bound
  approval row from the descriptor's approval policy, not the tool name.
- Add a `claim<Key>` / `finish<Key>` pair following `claimSearch` /
  `finishSearch` (atomic `UPDATE ... WHERE state = ... AND
  execution_token IS NULL`, exactly-once). Mutations and their ledger
  writes belong in one transaction (see `finishRename`).

### 5. `core/src/conversation/conversation.service.ts` (only if the tool gates or chains)

- Approval-gated: extend `approvalSummary()` (currently rename-only;
  without this the parked turn throws) and `mirrorNotice()` for the
  reject/cancel/expire texts.
- Approval-free and chainable: extend `continuationPair()` (currently
  search-only) so loop steps append the assistant/tool pair. Otherwise
  the tool runs once and the turn ends — which is a fine choice, just
  make it deliberately.

### 6. Tests (all must stay green: `npx jest`, `npm run test:e2e`, `tsc`, `eslint`)

- `tool-registry.spec.ts`: schema accepts/rejects, unknown fields,
  bounds, frozen outputs.
- `tool-execution.service.spec.ts` (real SQLite): execute-once,
  concurrent claims, `skipFinal` deferral if chainable.
- `conversation.service.spec.ts`: chaining/park shape, transcript
  written once, fan-out still fails closed.
- `test/app.e2e-spec.ts`: one live-shaped turn through HTTP + SSE.

### 7. Evidence

Per repo rules, no behavior change is claimed without it: append a run
note to `.reference/plans/evidence/` (unit + e2e + live run against a
real provider, tmp DBs). If the tool answers an M9 slice, mark it in
`milestone-9-agent-orchestration.md`.

---

## Limits table (do not work around these; change them explicitly if you must)

| Limit | Value | Where |
|---|---|---|
| Tool calls per step | exactly 1 (fan-out fails closed) | `tool-execution.service.ts` |
| Tool steps per turn | 5, then forced text answer | `conversation.service.ts` (`MAX_TOOL_STEPS`) |
| Serialized result | 64 KB | `tool-execution.service.ts` (`MAX_RESULT_BYTES`) |
| Wire argument bytes | 64 KB per call / 256 KB total | `llm.protocol.ts` |
| Search execution timeout | 2000 ms (owner ambiguity on timeout, never auto-retry) | `ToolExecutionService` options |
| Transcript writes | one claim per turn; pending turns write nothing | `claimTranscript` + `renderTurn` |

## Pitfalls already paid for

- Gateways echo the terminal choice: OpenRouter appends a usage chunk
  repeating the finished delta. The stream parser accepts it only when
  it adds nothing — do not loosen this to fix a provider quirk.
- `rawArguments` must deep-equal parsed `args`; the model must send
  already-canonical JSON.
- Invocation ids in context must be the durable `invocationId`, never
  the model-supplied call id — future turns resolve pairs from these.
- Resume never re-executes: it observes the ledger row. Any new
  executor must be reachable through claim-gated repository methods
  only, so approve/resume/duplicate-resume/restart all converge.
- The system prompt steers one call per response
  (`TOOL_STEP_INSTRUCTION`). If the new tool invites fan-out (e.g.
  "search for each item"), say so in its description instead:
  "call once per step; chain across steps".
