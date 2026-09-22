# ICOS v3 — Milestone 9: Agent Orchestration

## Objective

M9 should prove the first complete **model-driven agent loop**.

M8 established reliable, durable execution of a single model-selected tool invocation. M9 adds the orchestration layer that can decide what to do next, observe the result, continue when necessary, and terminate when the task is complete.

### Research question

> Given a user goal and access to reliable tools, can ICOS iteratively select appropriate actions, incorporate their actual results into its working state, recover from bounded failures, respect approval boundaries, and terminate when the goal is satisfied or execution can no longer reasonably continue?

The fundamental loop is:

```text
User goal
    ↓
Agent state
    ↓
Model reasoning
    ↓
Next action
    ↓
M8 tool execution
    ↓
Observation
    ↓
Updated agent state
    ↓
Model reasoning
    ↓
...
    ↓
Completion / termination
```

M9 is the first milestone where ICOS becomes an actual **agent loop** rather than a conversational system with tool support.

---

# Architectural Boundary

## M8 owns execution

M8 remains responsible for:

- tool contracts,
- tool availability and permission checks,
- argument validation,
- approval enforcement,
- invocation identity,
- execution,
- durable invocation state,
- durable results,
- execution failure semantics,
- `unknown` execution outcomes.

M9 must not bypass these mechanisms.

The planner proposes an action.

The M8 execution substrate decides whether and how that action may execute.

Conceptually:

```text
                    M9
        ┌─────────────────────────┐
        │      Agent controller   │
        │                         │
        │ goal → reason → action  │
        │ ↑                 ↓     │
        │ └──── observation ─┘     │
        └────────────┬────────────┘
                     │
               proposed action
                     ↓
        ┌─────────────────────────┐
        │          M8             │
        │    Tool execution       │
        │                         │
        │ validate → approve      │
        │ → execute → persist     │
        └────────────┬────────────┘
                     │
                actual result
                     ↓
                   M9
```

M9 should never assume that a proposed action actually executed.

It must consume the authoritative outcome returned by M8.

---

# [x] M9a — Agent Run State (implemented September 20, 2026)

Implemented as `agent_runs` in the sessions database plus
`core/src/agent/agent-run.repository.ts`: one row per non-command
turn with goal, session, step request ids (M8 ledger references by
convention), counters, limits, approval pointer, and terminal state.
The turn loop records/parks/completes runs with failure isolation —
tracking can never fail conversation. Lifecycle values are
provisional; M9b owns the machine. Evidence:
`milestone-9a-evidence-runstate.md`.

Introduce an explicit state representation for an **agent run**.

An agent run is distinct from a conversation session.

A session may contain multiple agent runs, while a single agent run may contain multiple actions and observations.

At minimum, an agent run should track:

- run ID,
- originating session/turn,
- user goal,
- current lifecycle state,
- action/invocation history,
- observations,
- pending approval state,
- iteration count,
- tool-call count,
- configured execution limits,
- termination reason.

Conceptually:

```text
AgentRun
├── id
├── sessionId
├── originatingTurnId
├── goal
├── state
├── actions[]
├── observations[]
├── iteration
├── budgets
└── termination
```

The exact persistence strategy should fit the existing architecture.

Do not duplicate the M8 invocation ledger unnecessarily. Agent state should reference authoritative tool invocations/results rather than maintaining a second conflicting execution history.

---

# [x] M9b — Agent Lifecycle (implemented September 20, 2026)

Implemented in the turn loop over the M9a store: `created` →
`reasoning` → `action_proposed` → `executing` → `observing` per step,
`awaiting_approval` on park, terminal `completed` / `failed` /
`cancelled` (client disconnect, stream path) / `budget_exhausted`
(bound forced the answer, still delivered). M9a-era `agent_runs`
tables migrate with stranded `running` rows mapped to `failed`.
Evidence: `milestone-9b-evidence-lifecycle.md`.

Define explicit agent-run states.

The exact names may differ, but the semantics should distinguish states such as:

```text
created
reasoning
action_proposed
waiting_for_approval
executing
observing
completed
failed
cancelled
budget_exhausted
```

A run should never appear `completed` merely because the model generated a response.

Completion should represent the agent's decision that the task is complete.

Likewise, an agent waiting for approval must not be treated as failed or completed.

---

# [x] M9c — Tool Selection and Planning (implemented September 20, 2026)

Implemented as a static per-turn planning block
(`core/src/agent/planning-context.ts`) merged into the system message:
turn goal, tool policies (immediate vs approval-pausing), and total
step budget, alongside the one-call steering. Previous actions and
observations ride the existing pair context; the wire schema is
untouched. Step-varying budget restatement belongs to M9k. Evidence:
`milestone-9c-evidence-planning.md`.

M9 introduces **single-step and multi-step tool planning**.

The model receives:

- the current goal,
- relevant conversation/context,
- available permitted tools,
- previous actions,
- actual observations/results,
- applicable constraints.

It decides the next action.

The next action may be:

```text
final response
```

or:

```text
tool invocation
```

The model should be able to reconsider its approach after observing a tool result.

For example:

```text
Goal:
"Find the session containing my M8 planning notes."

Reason
 ↓
session.search("M8")
 ↓
Observation: several matching sessions
 ↓
Reason
 ↓
session.search("M8 tools execution ledger")
 ↓
Observation: target session identified
 ↓
Final response
```

Do not implement a separate symbolic planning framework unless the existing evidence demonstrates that one is necessary.

The initial planner should remain model-driven.

---

# [x] M9d — Observation and Context Update (implemented September 20, 2026)

Implemented as `RunObservation` in `core/src/agent/observation.ts`,
derived from M8 ledger rows (never duplicated): status from the
execution payload (`ok` → succeeded, `unknown` → unknown, else
failed); rows without a durable execution yield nothing.
`AgentRunRepository.observations()` returns them in step order linked
by invocation id, and the loop builds continuation pairs from the
same derivation. Evidence:
`milestone-9d-evidence-observations.md`.

Tool results become **observations** available to subsequent reasoning.

The critical rule is:

> The agent reasons from the actual persisted result, not from an assumed or reconstructed result.

After each completed action:

```text
action
    ↓
M8 authoritative result
    ↓
observation
    ↓
agent state update
    ↓
next model invocation
```

Observations should retain their relationship to the originating invocation.

A failed action should be observable as a failure.

An unknown execution outcome should remain unknown.

Do not silently convert execution failures into empty or successful observations.

---

# [x] M9e — Iterative Execution (implemented September 20, 2026)

The September 19 loop mechanics are claimed now that the foundations
landed: each step runs through M8 `consume` against the run record
(M9a), walks lifecycle transitions (M9b) with a planning frame (M9c),
and continues from invocation-linked observations (M9d). Bound
(`MAX_TOOL_STEPS`, forced text, `budget_exhausted`), sequential-only
(fan-out fails closed), approval-gated tools end the chain, resume
never re-executes. The loop lives in `ConversationService` rather
than a separate controller — sufficient for turn-scoped runs;
revisit if runs outgrow a turn. Evidence:
`milestone-9e-evidence-multistep.md` plus the M9a–M9d evidence.

Implemented as a bounded multi-step loop in `ConversationService`
(`converse`/`converseStream`) over the unchanged M8 substrate: each step
proposes at most one call through the existing `consume` path (new
`skipFinal` defers the tools-disabled final on intermediate steps);
completed approval-free searches append an assistant/tool pair and propose
again; approval-gated tools, text answers, and invalid proposals end the
turn through the standard render path. Bound: `MAX_TOOL_STEPS = 5`
executions, then a forced `toolChoice: 'none'` text proposal; bound
exhaustion with a pending search finalizes via the existing `resume`
path. Fan-out proposals still fail closed (`invalid_call_count`); the
system prompt steers one call per response. Parallel calls remain out of
scope. Evidence: `milestone-9e-evidence-multistep.md`.

---

Implement the first bounded reasoning/action loop.

Conceptually:

```text
while agent has not terminated:
    ask model for next action
    if final response:
        complete
    if tool invocation:
        submit to M8
        wait for authoritative outcome
        add outcome as observation
        continue
```

This loop must have explicit limits.

Do not permit unrestricted autonomous iteration.

M9 should initially support sequential execution only.

Parallel tool calls are out of scope unless required by the existing model protocol and demonstrated to be necessary.

---

# [x] M9f — Termination and Completion (implemented September 20, 2026)

Implemented as a shared `terminalRun` mapping in `ConversationService`:
clean answers complete, bound/deadline exhaustion is
`budget_exhausted` (answer still delivered), denials complete as
`approval_denied`, disconnects cancel (stream path, abort signal),
errors fail. Turn deadline backstop (`MAX_TURN_DURATION_MS`, 15 min;
M9g makes budgets configurable). Evidence:
`milestone-9f-evidence-termination.md`.

Define explicit termination behavior.

An agent may terminate because:

- the model determines the goal is complete,
- the model produces a final answer,
- the user cancels the run,
- the iteration budget is exhausted,
- the tool-call budget is exhausted,
- the time budget is exhausted,
- an unrecoverable error occurs,
- an approval cannot be obtained and no useful continuation exists.

Termination must be explicit and persisted.

The system must not rely solely on the model eventually deciding to stop.

The agent controller should enforce hard limits even if the model continues requesting actions.

---

# [x] M9g — Execution Budgets (implemented September 21, 2026)

Implemented as configured budgets enforced in every loop entry:
`AGENT_MAX_ITERATIONS` (5), `AGENT_MAX_TOOL_STEPS` (5),
`AGENT_MAX_TURN_DURATION_MS` (900000), persisted per run in
`limits` and shown in the planning block. Exhaustion forces a text
answer with `budget_exhausted`. Token usage/cost deliberately not
tracked (provider usage ignored by design); elapsed time derives
from row timestamps. Evidence:
`milestone-9g-evidence-budgets.md`.

Introduce bounded execution controls.

At minimum support configurable:

- maximum iterations,
- maximum tool invocations,
- maximum execution duration.

Where practical, also track:

- model token usage,
- tool execution time,
- approximate model/tool cost.

Budget exhaustion must produce an explicit agent state and termination reason.

Example:

```text
iteration limit reached
→ agent state = budget_exhausted
→ no additional tool execution
```

Do not silently truncate the run and present it as successful completion.

---

# [x] M9h — Approval-Aware Planning (implemented September 21, 2026)

Implemented as bounded resume continuation: the resolved result (or
mirrored denial, never invented) re-enters planning against the
run's remaining budget; re-parked mutations need a new approval;
duplicate resumes converge on the last step's durable answer with no
new writes. `resume` accepts `skipFinal`, mirroring `consume`.
Evidence: `milestone-9h-evidence-approval-planning.md`.

Approval becomes part of the agent lifecycle.

When the model proposes an approval-gated action:

```text
reason
 ↓
action proposed
 ↓
M8 requires approval
 ↓
agent = waiting_for_approval
```

The run must pause without consuming additional planning iterations unnecessarily.

When approval is granted:

```text
waiting_for_approval
 ↓
approved invocation
 ↓
M8 execution
 ↓
observation
 ↓
reason again
```

When rejected:

```text
waiting_for_approval
 ↓
rejected
 ↓
observation
 ↓
agent decides whether another approach is possible
```

The agent must not bypass approval by reformulating the same mutation through another path.

Approval authorizes the specific M8 invocation, not the general goal.

---

# [x] M9i — Failure and Recovery (implemented September 21, 2026)

Implemented as validation-failure feedback: rejected proposals
return to the model as its raw calls plus one error response each
(the ledger's verdict), and all four loops continue within budget;
bound exhaustion still fails closed with zero executions. Executed
failures and unknown outcomes already flowed as themselves (M9d);
rejections already reconsidered (M9h). Evidence:
`milestone-9i-evidence-failure-recovery.md`.

M9 must distinguish between:

### Tool failure

The tool executed and reported failure.

The agent may decide whether another approach is appropriate.

### Validation failure

The proposed action was invalid.

The tool must not execute.

The model may receive the validation failure and correct its arguments.

### Approval rejection

The requested action was not authorized.

The agent may reconsider its plan, but must not retry the same unauthorized mutation without a new authorization decision.

### Unknown execution outcome

M8 reports that execution may have occurred but its final outcome cannot be established.

The agent must not blindly retry a potentially mutating action.

This state should be treated as an observation requiring appropriate reasoning rather than automatically classified as failure.

### Model/provider failure

If the model fails after a tool has executed:

- the M8 invocation/result remains authoritative,
- the agent run must preserve its state,
- recovery must not automatically rerun the completed invocation.

---

# [x] M9j — Repetition and Loop Protection (implemented September 22, 2026)

Implemented as pre-validation skip: identical single calls (name +
deep-equal args) return a `repeated_call` error observation with no
ledger row, no execution, no approval, in all four loops; skipped
steps still record their request id. Fan-out still fails closed.
Unrestricted repetition terminates at the step bound. Evidence:
`milestone-9j-evidence-loop-protection.md`.

The agent should detect obvious pathological repetition.

At minimum, instrument and expose:

- repeated identical tool calls,
- repeated failed calls,
- repeated calls with unchanged arguments,
- repeated cycles between the same actions.

M9 does not need sophisticated loop detection yet.

However, the architecture should make it possible to identify:

```text
search(A)
→ search(A)
→ search(A)
→ search(A)
```

and terminate or surface the condition rather than allowing unrestricted execution.

This is both a safety mechanism and an important experimental signal.

---

# [x] M9k — Agent Context Construction (implemented September 22, 2026)

Implemented as per-round assembly: `prepareTurn` splits the static
system base from the rest; every proposal round rebuilds via
`assembleStep` with a fresh planning block carrying progress (steps
used, remaining, prior actions, approval state). Skill bodies stay
frozen per turn; prompt/catalog refresh. No epistemic memory.
Evidence: `milestone-9k-evidence-context.md`.

Construct the model context required for each reasoning step.

The model should receive enough information to understand:

- the original goal,
- relevant conversation context,
- available tools,
- actions already attempted,
- actual tool results,
- failures,
- approval state,
- remaining execution budget.

Avoid blindly replaying the entire agent history forever.

The context mechanism should remain compatible with the existing session/context infrastructure and leave room for later memory-aware context construction in M11.

M9 should not implement epistemic memory.

---

# [ ] M9l — Cancellation and Restart

Agent runs must have truthful behavior across cancellation and restart.

### Cancellation

A cancelled run must not initiate additional actions.

If an invocation is already executing, its final execution outcome remains governed by M8.

Cancellation of the agent does not retroactively cancel an external operation unless the tool explicitly supports cancellation.

### Restart

After process restart, ICOS should be able to reconstruct:

- the agent run,
- completed invocations,
- actual observations,
- pending approval,
- current lifecycle state,
- termination/budget state.

It must not rerun an invocation merely because the process stopped before the next model response.

---

# [x] M9m — Verification (implemented September 21, 2026)

Implemented as coverage, not new behavior: every agent-level
invariant (planning, loop, approval, termination, recovery) maps to
a named test that would fail if it broke, closing four gaps found by
audit — chained-step identity, park-no-execution, and both restart
recoveries. Evidence (with coverage map):
`milestone-9m-evidence-verification.md`.

Verification should focus on **agent-level invariants**, building on the M8 execution tests.

## Planning invariants

Verify that:

- the model can select an appropriate permitted tool,
- tool arguments are passed through the M8 validation path,
- the model receives actual tool results,
- the next decision can depend on the previous result,
- the model can stop without using a tool when appropriate.

## Loop invariants

Verify that:

- multiple sequential tool calls are possible,
- each invocation has a distinct durable identity,
- each result is associated with the correct invocation,
- results are not fabricated,
- the agent does not automatically repeat completed invocations.

## Approval invariants

Verify that:

- approval-gated actions pause the run,
- approval resumes the correct invocation,
- rejection becomes an observation/state the agent can reason about,
- duplicate approval does not duplicate execution,
- the planner cannot bypass approval.

## Termination invariants

Verify that:

- successful completion terminates the run,
- iteration limits terminate the run,
- tool-call limits terminate the run,
- cancellation terminates further planning,
- provider failure does not cause completed tools to rerun,
- pathological repetition cannot continue indefinitely.

## Recovery invariants

Verify:

```text
tool executes
→ provider fails
→ process restarts
→ agent recovers
→ existing result remains authoritative
→ invocation is not rerun
```

Also verify:

```text
agent waiting for approval
→ process restarts
→ approval state survives
→ run resumes correctly
```

---

# [ ] M9n — End-to-End Demonstrations

M9 should produce several small but meaningful demonstrations.

## Single-step agent

```text
User request
→ model selects session.search
→ M8 executes
→ actual result returned
→ agent produces final response
```

## Multi-step agent

```text
User request
→ search
→ observe
→ reason
→ second search
→ observe
→ final response
```

## Approval-gated agent

```text
User request
→ determine rename is required
→ propose session.rename
→ wait for approval
→ approve
→ execute
→ observe result
→ final response
```

## Recovery

```text
User request
→ tool executes
→ provider failure
→ restart
→ recover agent state
→ preserve tool result
→ continue without duplicate execution
```

## Bounded failure

```text
agent repeatedly fails to make progress
→ budget/loop protection triggers
→ explicit termination
→ truthful final state
```

---

# Scope Boundary

Keep the following **out of M9**:

- epistemic memory,
- memory consolidation,
- autonomous background operation,
- scheduling,
- external event triggers,
- parallel tool execution,
- subagents,
- MCP,
- sensory input,
- external communications,
- unrestricted code/shell execution,
- long-running autonomous jobs,
- complex symbolic planning,
- sophisticated reflection systems,
- persistent persona maintenance.

These belong to later milestones.

M9 should establish the basic orchestration primitive on top of M8.

---

# Relationship to Future Milestones

M9 should deliberately establish interfaces that later milestones can extend.

### M10–M12 — Epistemic memory

Later memory systems can provide better context and observations without changing the fundamental agent loop.

### M13 — MCP

MCP should expand the available tool ecosystem without changing the core orchestration model.

### M14 — Persistent persona

Persona maintenance can influence planning/context without becoming part of the M9 execution mechanism.

### M15 — Drift and hallucination mitigation

Verification and monitoring can evaluate model decisions and tool-use behavior.

### M16 — Communications

Email, Discord, and SMS become additional interaction/action surfaces.

### M17 — Autonomous agency

The M9 loop becomes capable of being initiated without an immediate conversational request and operating against a broader action registry.

### M18 — Sensory reintegration

External observations can become another source of agent observations.

### M19 — Subagents

The orchestration architecture can later support delegated agent runs.

### M20 — Reactionary events

External events can initiate agent runs without requiring a conversational turn.

---

# Definition of Done

M9 is complete when ICOS can demonstrate:

> Given a user goal, the model can select and execute multiple permitted actions sequentially through the M8 execution substrate, observe their actual results, use those observations to determine subsequent actions, pause for required approval, recover from bounded failures, enforce execution limits, and terminate with a truthful persisted state.

The milestone should establish a clean separation:

```text
M8
Reliable execution of an action.

M9
Reasoning and orchestration over actions.

M10–12
Durable epistemic knowledge informing that reasoning.

M13+
Increasingly broad interfaces, autonomy, and environmental interaction.
```

Do not solve later milestones while implementing M9.
