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

# [ ] M9e — Iterative Execution

> Status (September 19, 2026): the loop mechanics below are implemented
> and verified, but M9a–M9d are still open — there is no persisted run
> record, no lifecycle states, and no persisted termination. What exists
> is tool chaining inside a conversation turn, not an agent run yet, so
> this slice is not claimed.

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

# [ ] M9f — Termination and Completion

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

# [ ] M9g — Execution Budgets

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

# [ ] M9h — Approval-Aware Planning

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

# [ ] M9i — Failure and Recovery

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

# [ ] M9j — Repetition and Loop Protection

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

# [ ] M9k — Agent Context Construction

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

# [ ] M9m — Verification

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
