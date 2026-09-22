# ICOS v3 — Milestone 8: Tools

## Objective

M8 should prove **reliable, durable, approval-aware tool execution**.

The milestone is intentionally about the execution substrate, not autonomous tool-use loops.

### Research question

> Given a single user request and a model-generated tool request, can ICOS select a permitted tool, validate its arguments, obtain approval when required, execute it at most once per invocation, persist the outcome independently of conversation completion, and make the actual result available to the model?

The core execution path is:

```text
User request
    ↓
LLM
    ↓
structured tool call
    ↓
tool lookup / permission check
    ↓
argument validation
    ↓
approval if required
    ↓
execution
    ↓
durable result
    ↓
LLM response
```

Do not implement autonomous iteration in M8.

---

## Architectural Principle

### Execution is not conversation

A tool invocation is an execution event, not merely another kind of conversational message.

A tool can successfully execute even when:

- the LLM subsequently fails,
- streaming disconnects,
- the conversation transaction fails,
- the process restarts,
- the user never receives the final conversational response.

Therefore, **tool execution state and results must survive independently of whether the conversational turn completes.**

Conversation reconstruction should consume the execution history; it must not be the authoritative record of whether an operation happened.

A useful mental model is:

> Conversation is a view over execution history, not the execution ledger itself.

Do not represent tool execution solely as fabricated assistant/tool messages in conversation history.

---

## Existing Constraints

The current architecture indicates several gaps that M8 must address:

- The LLM boundary is currently text-oriented (`core/src/llm/llm-provider.ts:17`).
- Approval decisions persist, but approval does not currently resume execution (`core/src/approvals/approval.service.ts:71`).
- Conversation history does not currently contain structured tool calls/results (`core/src/session/sqlite-session.repository.ts:68`).

M8 should address these without unnecessarily redesigning unrelated subsystems.

---

## Milestone Slices

### [x] M8a — Tool Contract

Establish the canonical internal representation of a tool.

A tool should have enough metadata to determine:

- stable tool identity/name,
- description available to the model,
- argument schema,
- whether approval is required,
- execution handler,
- appropriate result representation.

Tool arguments and results must be structured data.

Do not rely on parsing arbitrary natural-language model output as the canonical execution mechanism.

#### Initial tools

Implement only two deliberately modest tools:

1. **Session search**
   - Read-only.
   - Wraps the existing session/search functionality.
   - Exercises structured arguments and real result retrieval.

2. **Approval-gated session rename**
   - Mutating.
   - Wraps the existing session rename functionality.
   - Requires approval.
   - Exercises durable mutation, approval, execution, and result reporting.

Do not introduce shell execution, arbitrary filesystem execution, HTTP execution, or another external integration in M8.

#### Implementation sequence

Start with a side-effect-free registry and strict argument validation. Both initial tools are scoped to the trusted current session; model arguments cannot select a different session. Search accepts `query` and optional `limit`; rename accepts `title`. Tool descriptors carry version and approval policy, but validation does not grant execution authority.

Add handlers only behind the invocation-bound approval and persistence boundary. Do not expose a temporary execution endpoint or dispatcher before that boundary exists. M8a's registry alone does not establish reliable execution or complete M8a.

Registry verification uses unit tests for the fixed allowlist, argument/schema constraints, permission rejection, immutable validated requests, and zero execution surface. Execution verification additionally requires real SQLite effects, approval enforcement, restart/recovery, and the M8e evidence paths.

#### Working progress — September 17, 2026

The initial registry and colocated tests are implemented in `core/src/tools/tool-registry.ts` and `core/src/tools/tool-registry.spec.ts`. Independent review confirmed the registry is not imported outside its tests. Handlers, model integration, execution ledger, and approval resumption remain unimplemented.

Verification from `core/`:

- `npm test -- --runInBand tools`: 25 passed.
- `./node_modules/.bin/tsc --project tsconfig.json --noEmit --incremental false`: passed.
- `./node_modules/.bin/eslint "{src,apps,libs,test}/**/*.ts"`: passed.
- `npm run build`: passed.
- `npm test -- --runInBand`: 281 passed, 7 failed in unchanged LLM and skill-loader tests. The failures concern a duplicated `/chat/completions` suffix and seed-skill paths resolving above the repository root. These need investigation before proceeding to a clean integration baseline.

No e2e or live execution verification has been performed for M8. This progress note is not milestone-completion evidence; M8a and M8 remain incomplete.

#### Working progress — M8b (September 17, 2026)

M8a committed as `61f0ae6`; M8b committed as `405e5d8` (`core/src/llm/llm.protocol.ts`, `core/src/llm/llm.protocol.spec.ts`, updated `core/src/llm/llm.client.ts`). Additive tool-aware APIs (`chatWithTools`/`chatStreamWithTools`) return a discriminated `LlmResult`; legacy `chat`/`chatStream` remain text-only and reject unexpected tool calls. Offered tools map to explicit wire aliases resolved through a request-local table; parsed calls carry canonical name/version, raw argument string, and parsed arguments for later registry validation. Streamed arguments assemble under bounded limits; tool results require complete assembly plus a `tool_calls` finish reason and terminal `[DONE]`; `tool_choice: 'none'` rejects any returned call. URL building now normalizes to exactly one `/chat/completions` suffix (this also fixed the pre-existing doubled-suffix LLM test). No execution, persistence, or conversation wiring exists; parsed calls are data only, and multi-call results must be rejected before any execution in M8c.

Verification from `core/`:

- `npm test -- --runInBand --testPathPatterns='llm|tools'`: 151 passed.
- `npm test -- --runInBand`: 380 passed, 6 failed — all pre-existing skill-seed path failures unchanged by M8b (`docs/skills` seeds resolve outside the repository root).
- `npm run test:e2e -- --runInBand`: 30 passed.
- `npm run build`, `tsc --noEmit`, and non-mutating eslint: passed.

Remaining for M8: M8c bounded execution, M8d approval/invocation ledger, M8e live verification. The 6 seed-path failures require resolution before M8 integration claims a clean baseline.

#### Working progress — M8c (September 17, 2026)

M8c is implemented but uncommitted: `core/src/tools/tool-execution.repository.ts` (SQLite ledger over `tool_requests`), `core/src/tools/tool-execution.service.ts` (bounded `consume`), `core/src/tools/tool-execution.service.spec.ts` (49 tests over real temporary SQLite databases), plus the `tool_requests` table and immutability trigger in `core/src/session/database.ts`. The service consumes an already-completed model result plus trusted session/request/context/allowed-tools: at most one tool call per request, registry validation (unknown → version → permission → session → args, then raw-argument consistency), search-only execution under an atomic claim token, rename held at `awaiting_approval` with no mutation and no generic-approval bridge, and a separately claimed tools-disabled final LLM call. A waiter timeout returns the `executing` record without persisting failure; the sole owner persists the actual eventual outcome in the background. Interrupted claims stay `executing` until an explicit token-bearing release resolves them to a durable `unknown` outcome — never auto-retried. No conversation, HTTP, or module wiring exists yet; approval grant/resume is M8d work.

Verification from `core/`:

- `npm test -- --runInBand tools`: 74 passed.
- `npm test -- --runInBand`: 435 passed, 0 failed.
- `npm run test:e2e -- --runInBand`: 30 passed.
- `npm run build`, `tsc --noEmit`, non-mutating eslint, `git diff --check`: passed.

Two incidental fixes were required along the way: the skill-seed spec paths (one directory too deep after the `core/` move) and a realm-fragile `instanceof Error` check in `isQueryError` that broke FTS fallback when the full suite ran in one Jest process. No e2e tool-execution or live verification has been performed; M8c, M8d, M8e, and M8 remain incomplete.

#### Working progress — M8d (September 18, 2026)

M8d is implemented but uncommitted. Parking a rename now atomically creates a bound `session.rename` approval (`tool_requests.approval_id → approvals.id`, one-to-one, immutable, delete-restricted) in the same transaction, so every `awaiting_approval` row has a owning approval and generic approvals confer zero authority. `resume(requestId, sessionId)` enforces the owning session (forks denied), revalidates stored policy inside the claim, observes the bound approval through the lazy-expiry-applying read, mirrors `rejected`/`cancelled`/`expired` to terminal invocation states with zero execution, and on `approved` claims exactly once then performs the session rename and its ledger write in a single transaction. Consume auto-resumes parked invocations on same-input calls; all terminal paths share one finalization step. Schema adds `approval_id` plus the mirrored states, with a preserving rebuild migration for M8c-era tables (approval-less parks are un-actionable and dropped) and convergence of the immutability trigger onto all identity columns.

Verification from `core/`:

- `npm test -- --runInBand tools`: 86 passed (includes grant/deny/cancel/expire/fork/restart/race/rebind/revalidation/final-failure/unknown paths).
- `npm test -- --runInBand`: 448 passed, 0 failed.
- `npm run test:e2e -- --runInBand`: 30 passed.
- `npm run build`, `tsc --noEmit`, non-mutating eslint, `git diff --check`: passed.

Remaining for M8: conversation/HTTP wiring of the tool turn (proposal → approval → resume → response), M8e live verification across providers, and milestone evidence. M8d, M8e, and M8 remain incomplete.

#### Working progress — Wiring + M8e (September 18, 2026)

Conversation/HTTP wiring is implemented but uncommitted. `ConversationService` now runs every turn through `chatWithTools`: text proposals persist as before, single tool calls execute through the M8c/d substrate, rename parks return 202 `approval_required` with a bound approval payload, and `POST /core/conversation/resume` (+ `resume-stream`) resumes by request id without re-executing. SSE gains `tool`/`approval` events and `requestId`/`status` on `meta`/`done`. Context reconstruction appends ledger-derived call/result pairs (stable durable ids) after history instead of persisting fabricated tool messages. Transcript writes go through a one-shot `transcript_state` claim, so retried resumes never duplicate rows; gaps on crash match the existing store-nothing-on-failure philosophy. Failed finals return 200 with the durable execution `result` attached, so recovery delivers the persisted outcome instead of 502ing again. Invalid/multi-call proposals fail closed with 502 before any execution. `/undo` hides turn text but never erases the ledger; forks cannot resume foreign requests (`invalid_session` → 400).

Verification from `core/`:

- `npm test -- --runInBand`: 460 passed, 0 failed (includes tool-turn, resume, pairing, claim, and recovery unit tests).
- `npm run test:e2e -- --runInBand`: 37 passed (includes scoped search execution, park → approve → resume, rejection mirroring, final-failure delivery, resume validation/fork denial, SSE tool/approval events, undo isolation).
- `npm run build`, `tsc --noEmit` (both configs), non-mutating eslint, `git diff --check`: passed.
- Live run against Ollama `gemma4-e4b-unc:latest` (only local model with tool support; `violet:latest` rejects tools): full text → search → park → approve → resume → duplicate-resume → restart-resume path with a real model, ledger-verified singularity. Evidence: `.reference/plans/evidence/milestone-8-evidence-live.md`.

Remaining for M8: commit code + evidence, mark status. No M9 work undertaken.

---

### [x] M8b — Model Protocol

Extend the LLM boundary sufficiently to represent structured tool calls.

The model must be able to produce a canonical invocation approximately equivalent to:

```text
tool:
  name: session.search
  arguments:
    query: "..."
```

or:

```text
tool:
  name: session.rename
  arguments:
    title: "..."
```

The exact implementation/protocol should follow the capabilities of the current provider abstraction.

The important requirement is that the core runtime receives a **structured tool invocation**, rather than attempting to infer tool execution from prose.

The model should only be offered tools that are actually available and permitted in the current context.

---

### [x] M8c — Bounded Execution

Implement a bounded, deterministic execution pipeline for a single invocation.

M8 should support:

```text
tool selection
    ↓
tool existence / permission check
    ↓
argument validation
    ↓
approval decision
    ↓
execution
    ↓
durable result
```

Do not implement an autonomous loop.

For each user request, allow at most one tool call, followed by one final LLM call with tools disabled to consume the durable result and produce the response. Reject any model request containing multiple tool calls before executing any of them. No tool calls from the final LLM response may execute.

A single model turn may request a tool, but M8 should not automatically continue:

```text
LLM → tool → result → LLM → tool → result → ...
```

That belongs to M9.

#### Invocation identity

Every tool invocation must have a unique, durable invocation ID.

Approval and execution must operate on that **specific invocation**, not merely on a tool name or generic operation.

Conceptually:

```text
invocationId: 8f31...
tool: session.rename
arguments: {...}
```

Approval authorizes invocation `8f31...`.

A second approval for the same invocation must not cause a second execution.

---

### [x] M8d — Approval and Persistence

Implement a small SQLite-backed invocation ledger.

The ledger should be linked to:

- session,
- originating conversational turn/request,
- tool invocation,
- approval where applicable.

It should persist structured calls and results.

Do not use fabricated conversation messages as the source of truth.

#### Suggested invocation lifecycle

Use explicit execution states. Exact naming may differ, but the semantic distinction must be preserved:

```text
proposed
validated
invalid
awaiting_approval
approved
rejected
cancelled
expired
executing
succeeded
failed
unknown
```

Not every invocation must pass through every state.

`invalid` is a terminal state for invocations rejected during tool lookup, permission check, or argument validation (including unknown tools). Zero execution occurs, and the invocation is never retried or resumed from `invalid`. It is distinct from `failed`, which is reserved for invocations that actually began execution and failed.

#### Unknown outcome

`unknown` is a first-class state.

For a mutation:

```text
approved
    ↓
executing
    ↓
process dies / connection lost / execution outcome cannot be established
```

must not automatically become:

```text
failed
```

It may be:

```text
unknown
```

because the operation may have happened.

Do not blindly retry an operation whose outcome is unknown.

This is particularly important for future external integrations.

---

### [x] M8e — Verification

Verification should test the execution mechanism and its invariants, not just the happy path.

#### Safety invariants

Verify:

- Unknown tool → terminal `invalid`, zero execution.
- Invalid arguments → terminal `invalid`, zero execution.
- Disallowed tool → terminal `invalid`, zero execution.
- Multi-call request → rejected before any execution.
- A user request permits at most one tool call and one final LLM call with tools disabled; no further tool execution is allowed.
- Rejected approval → zero execution.
- Expired approval → zero execution.
- Cancelled invocation → zero execution.
- Duplicate approval → at most one execution.
- Already-executed invocation → never executes again.
- Forked session → cannot execute inherited pending approval.

#### Durability invariants

Verify:

- Successful tool execution survives LLM response failure.
- Tool results survive process restart.
- Pending approvals survive process restart.
- Invocation state can be reconstructed after restart.
- Disconnect/reconnect exposes truthful state.
- Structured call/result pairing survives conversation reconstruction.

#### Truthfulness invariants

Verify that:

- `invalid` means validation failed before execution and is terminal.
- `succeeded` means execution actually succeeded.
- `failed` means execution occurred and failed.
- `unknown` means execution outcome cannot be established.
- Conversation reconstruction never fabricates a result.
- A failed conversational response does not imply failed tool execution.
- A persisted approval does not imply that execution occurred.

#### Functional paths

At minimum demonstrate:

##### Read path

```text
User
→ model selects session search
→ valid arguments
→ execution
→ actual search result
→ model receives actual result
→ response
```

##### Approval path

```text
User
→ model selects session rename
→ valid arguments
→ approval requested
→ approval granted
→ exactly one execution
→ actual rename result
→ model receives actual result
→ response
```

##### Rejection path

```text
User
→ rename requested
→ approval requested
→ rejection
→ zero rename executions
```

##### Duplicate approval path

```text
approval granted
→ execution
→ duplicate approval/retry event
→ zero additional executions
```

##### Provider failure path

```text
tool execution succeeds
→ result persisted
→ provider response fails
→ restart/recovery
→ result still exists
→ tool is not rerun
```

##### Restart path

Test pending approval and completed execution across a process restart.

---

## Approval Semantics

Approval must authorize one specific invocation.

Required behavior:

- Approval of invocation A cannot authorize invocation B.
- Rejection must never execute the tool.
- Expiry must never execute the tool.
- Cancellation must never execute the tool.
- Duplicate approval must never execute the tool twice.
- Restart must preserve the approval state.
- Approval resumption must retain the original invocation's context.
- A fork must not inherit an executable pending approval.

### Pending approval context

A pending approval must retain enough information to resume the original invocation faithfully, including the relevant:

- session,
- turn/request context,
- tool identity,
- validated arguments,
- tool contract/version information as appropriate.

Do not reconstruct a pending invocation by asking the model to regenerate it.

---

## Tool Contract Versioning

Pending invocations should not silently change meaning if the tool definition changes while an approval is pending.

At minimum, persist enough identity/version information to establish which tool contract was used when the invocation was created.

For example:

```text
tool: session.rename
contractVersion: 1
arguments: {...}
```

A sophisticated migration/versioning system is not required for M8, but the architecture must not assume that the current tool definition is necessarily identical to the definition used to create an existing pending invocation.

---

## Conversation Reconstruction

Conversation history must preserve tool-call/result pairing when a tool invocation is included in model context.

The conversational representation should allow the model to understand something equivalent to:

```text
assistant:
  tool_call:
    id: 8f31...
    tool: session.search
    arguments: {...}

tool:
  tool_call_id: 8f31...
  result: {...}
```

The exact provider format can differ.

The critical requirements are:

1. The call and result remain paired.
2. The invocation ID remains stable.
3. Results come from the durable invocation ledger.
4. Conversation reconstruction never invents a successful tool result.
5. A tool result remains available even if the original conversational response failed.

---

## Failure Semantics

M8 must distinguish failures occurring at different stages.

Examples:

### Unknown tool

```text
model requests unknown tool
→ validation failure
→ terminal invalid
→ zero execution
```

### Invalid arguments

```text
valid tool
→ invalid arguments
→ validation failure
→ terminal invalid
→ zero execution
```

### Rejected approval

```text
valid mutation
→ approval requested
→ rejected
→ zero execution
```

### Expired approval

```text
valid mutation
→ approval requested
→ expires
→ zero execution
```

### Provider failure after execution

```text
LLM requests tool
→ tool executes successfully
→ result persisted
→ subsequent LLM response fails
```

The result must remain persisted.

On recovery, ICOS must not execute the tool again merely because the conversational turn did not finish.

### Interrupted mutation

```text
approved
→ execution starts
→ process dies
```

Result:

```text
unknown
```

unless the system has authoritative evidence that it succeeded or failed.

Do not automatically retry.

---

## `/undo` Semantics

Do not make `/undo` imply that a tool execution can automatically be reversed.

For example:

```text
session.rename executed
```

does not mean `/undo` can claim that the external action was reversed unless an actual compensating operation exists and is explicitly performed.

M8 should keep conversation/history rollback separate from external execution reversal.

---

## Fork Semantics

Forking a conversation must not copy executable pending approvals into the fork.

A pending approval belongs to its original invocation/session context.

A fork may preserve historical information about the invocation, but it must not gain authority to execute the original pending operation.

---

## Scope Boundary

Keep the following **out of M8**:

- autonomous iteration,
- multi-step tool-use loops,
- parallel tool execution,
- scheduling,
- background jobs,
- subagents,
- shell execution,
- arbitrary code execution,
- general-purpose external integrations,
- complex retry orchestration,
- tool planning,
- agent termination policies.

Those belong to later milestones.

The purpose of M8 is to establish a trustworthy primitive that M9 can safely operate.

---

## Definition of Done

M8 is complete when ICOS can demonstrate:

> A model can request one permitted tool using structured arguments; ICOS validates the request; approval is required and correctly enforced for mutations; the tool executes at most once for a given invocation; the structured call and actual result are durably recorded independently of conversation completion; state survives restart/disconnect; and failure/recovery behavior is truthful rather than inferred from conversational state.

Completion requires verified unit, e2e, and live-run evidence committed to `.reference/plans/evidence/`, plus clean `tsc` and `eslint` checks. Do not claim M8 complete without this committed evidence.

M8 should leave behind a stable execution substrate.

M9 can then investigate the separate question:

> Given this reliable primitive, can the model use tools repeatedly and appropriately to accomplish a larger task?

Do not solve M9 while implementing M8.
