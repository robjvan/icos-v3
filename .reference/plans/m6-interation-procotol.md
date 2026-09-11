# Milestone 6 — Interaction Protocol

## Objective

Build the minimum interaction protocol required for ICOS to support meaningful human ↔ runtime interaction beyond ordinary conversational messages.

M6 consists of three related but distinct capabilities:

```text
M6a — Slash commands
M6b — Approvals
M6c — Clarification / questions
```

The goal is **not** to build a sophisticated UI framework.

The goal is to establish the interaction primitives that later milestones can rely upon for:

* skills
* tools
* autonomous actions
* model selection
* memory inspection
* runtime control
* human approval
* missing-information requests
* long-running agent tasks

---

# Architectural Principle

Separate three classes of interaction.

### 1. Deterministic commands

```text
/status
/health
/new
/model
```

These are interpreted directly by Core.

They do **not** go through the LLM.

### 2. Agent interaction requests

```text
approval required
clarification required
question required
```

These are structured runtime states produced by the agent.

They do **not** become ordinary assistant text.

### 3. Ordinary conversation

```text
user message
    ↓
cognition
    ↓
LLM
    ↓
assistant response
```

The system must preserve this distinction.

---

# M6a — Slash Commands

## Objective

Implement a deterministic command layer for runtime/session control.

Commands should be recognized before ordinary conversation processing.

Conceptually:

```text
HTTP request
    ↓
Core ingress
    ↓
Command parser
    ├── command → command handler
    │
    └── ordinary message → ConversationService
```

A slash command must never accidentally reach the LLM as a normal user message.

---

# Initial Command Catalog

Implement the following initial commands.

```text
/status
/new
/health
/export
/rename
/thinking
/timestamps
/undo
/fork
/restart-runtime
```

Reference:

```text
.reference/notes/slash-commands.md
```

The implementation should consult the notes before making command-level design decisions.

---

# Command Parser

Create a small deterministic parser.

It should identify:

```text
/command
/command arguments...
```

and return a structured representation.

Conceptually:

```ts
interface SlashCommand {
  name: string;
  args: string[];
  raw: string;
}
```

The parser should:

* recognize leading `/`
* normalize command names consistently
* preserve argument boundaries
* reject malformed commands cleanly
* distinguish commands from ordinary messages

Do not create a general-purpose natural-language command interpreter.

---

# Command Registry

Use a simple registry/dispatch mechanism.

Conceptually:

```ts
interface SlashCommandHandler {
  name: string;
  aliases?: string[];
  execute(context, args): Promise<CommandResult>;
}
```

Keep the registry small.

Do not build a plugin marketplace or command dependency framework.

Future commands should be addable without modifying a giant `switch` statement, but the abstraction should remain lightweight.

---

# Command Results

Commands should return structured results rather than pretending to be ordinary LLM messages.

Conceptually:

```ts
interface CommandResult {
  type: "message" | "data" | "session" | "error";
  ...
}
```

The existing UI can render these appropriately.

Do not persist command output as assistant-generated conversation unless there is a demonstrated reason to do so.

---

# `/status`

Display current session/runtime state.

Initial information:

* session ID
* model
* provider
* context/history usage
* configured context limit if available
* message count
* session creation/update timestamps
* streaming state if relevant
* runtime version

Example conceptual response:

```text
Session: 6f...
Provider: OpenRouter
Model: deepseek/...
Messages: 14
Context: 6,821 / 16,384
Streaming: idle
```

Do not ask the LLM to generate this information.

All values should come from Core/runtime state.

---

# `/new`

Create a new ICOS conversation session.

Behavior:

1. create session
2. establish new session ID
3. switch current UI session
4. clear displayed conversation state
5. preserve existing sessions

Do not delete the previous session.

---

# `/health`

Return deterministic runtime health.

Initial checks may include:

* Core process
* SQLite/session store
* memory candidate store if separated
* LLM provider configuration
* provider reachability if an active health check exists

Do not perform expensive LLM generation simply to determine health.

Distinguish:

```text
configured
reachable
healthy
```

where possible.

Do not claim a provider is healthy merely because configuration exists.

---

# `/export`

Export the current session transcript.

Initial scope:

* export complete transcript
* preserve message order
* preserve timestamps
* preserve roles
* preserve session ID
* produce a deterministic downloadable representation

Do not include internal credentials, headers, or runtime secrets.

Possible initial format:

```text
Markdown
```

or another format already supported by the UI.

Do not build a generalized export framework.

---

# `/rename`

Rename the current session.

Behavior:

```text
/rename ICOS architecture discussion
```

should update session metadata.

Session rename must not modify transcript contents.

If the session currently has no explicit title, this establishes one.

The title belongs to the session store, not the LLM.

---

# `/thinking`

Provide control over reasoning/thinking visibility.

Initial behavior should match the current model/provider capability.

This command may:

* toggle display of thinking events
* show/hide thinking in the UI
* expose current thinking visibility state

Do not assume all providers/models emit reasoning in the same format.

Do not parse provider-specific `<think>` markup inside Core if it can be avoided.

The normalized LlmClient stream should remain provider-neutral.

---

# `/timestamps`

Toggle timestamp visibility in the UI.

This is primarily presentation state.

Do not modify stored message timestamps.

Stored timestamps remain canonical regardless of display preference.

---

# `/undo`

Undo the previous user message/turn.

This requires careful separation between:

```text
display state
transcript evidence
LLM context
```

Initial implementation should **not physically delete historical transcript evidence** unless the existing session-store design explicitly supports safe deletion.

Prefer a reversible or derived-context approach.

Before implementation, inspect the existing M3 persistence model and determine exactly what "undo" can safely mean.

Possible initial behavior:

```text
visible/context state
    ↓
remove most recent turn from active conversation
```

while preserving the underlying transcript.

If true deletion is eventually desired, that should be an explicit persistence operation with tests and provenance implications.

Do not silently destroy evidence.

---

# `/fork`

Create a new session derived from the current session.

Initial behavior:

```text
current session
      ↓
     fork
      ↓
new session
```

The new session should contain enough transcript state to continue from the fork point.

The original session remains untouched.

The implementation must define whether the fork:

1. copies the entire transcript, or
2. references/carries forward history.

For M6, prefer the simplest correct implementation.

A copied transcript is acceptable if it keeps the session model comprehensible.

Do not implement branching DAG semantics unless required.

---

# `/restart-runtime`

Request a Core/runtime restart.

This is inherently operational.

Implement only if the current runtime environment provides a safe restart mechanism.

If Core cannot safely restart itself in the current development environment:

```text
/restart-runtime
```

should return a clear deterministic response explaining that runtime restart is unavailable.

Do not build process supervisors into ICOS.

Do not allow an LLM-generated command to invoke arbitrary process termination through this command.

---

# Planned Commands

Do not necessarily implement these during M6a unless the notes indicate they are already required.

```text
/skills
/mcps
/memory
/compact
/model
/variant
/reasoning
/thinking
/temperature
/temp
```

M6a should establish the command infrastructure so these can be added later.

---

# Command Aliases

Support aliases where explicitly defined.

Initial planned examples:

```text
/variant
/reasoning → /variant
/thinking → /variant
```

and:

```text
/temperature
/temp → /temperature
```

Do not create aliases merely for symmetry.

---

# M6b — Approvals

## Objective

Establish a structured mechanism through which ICOS can request human approval before performing an action.

This becomes essential before M8 tools and M9 autonomous execution.

The interaction should be modeled as a runtime state, not as ordinary chat text.

Conceptually:

```text
agent wants action
       ↓
approval required
       ↓
runtime creates approval request
       ↓
UI presents request
       ↓
user approves/rejects
       ↓
runtime resumes
```

---

# Approval Request Model

Create a minimal structured model.

Conceptually:

```ts
interface ApprovalRequest {
  id: string;
  sessionId: string;

  action: string;
  description: string;

  createdAt: string;

  status:
    | "pending"
    | "approved"
    | "rejected"
    | "expired"
    | "cancelled";
}
```

The exact fields should follow the existing architecture rather than being copied blindly.

---

# Approval Lifecycle

Required state transitions:

```text
pending
   ├── approved
   ├── rejected
   ├── expired
   └── cancelled
```

Invalid transitions must be rejected.

Example:

```text
approved → rejected
```

must not silently succeed.

---

# Approval Identity

Every approval request gets a unique ID.

The request must be associated with:

```text
sessionId
```

and eventually, when tools exist:

```text
task/action/tool invocation
```

Do not rely on UI element identity as approval identity.

---

# Approval API

Provide a deterministic mechanism for:

```text
create approval
list pending approvals
approve
reject
cancel
```

The exact REST endpoints should follow existing Core conventions.

Do not require the LLM to generate an HTTP request to approve itself.

---

# Approval UI

The existing chat UI should be capable of displaying a pending approval.

Example:

```text
────────────────────────────
Approval required

Action:
Run database migration

Reason:
The requested schema change will modify persistent data.

[ Approve ] [ Reject ]
────────────────────────────
```

The UI should not infer what the action is.

It renders the structured approval request.

---

# Approval Security Boundary

The approval mechanism must be deterministic.

An LLM response such as:

```text
"Sure, you approved that."
```

must never count as an actual approval.

Only an explicit runtime/UI approval action changes:

```text
pending → approved
```

This is a critical invariant.

---

# M6c — Clarification / Questions

## Objective

Allow ICOS to explicitly request additional information when it cannot reasonably proceed.

This is different from an ordinary assistant response.

Conceptually:

```text
LLM/task
   ↓
insufficient information
   ↓
clarification request
   ↓
user answers
   ↓
runtime resumes original task
```

---

# Clarification Request Model

Minimal conceptual structure:

```ts
interface ClarificationRequest {
  id: string;
  sessionId: string;

  question: string;

  options?: string[];

  createdAt: string;

  status:
    | "pending"
    | "answered"
    | "cancelled"
    | "expired";
}
```

The model can be expanded later if actual requirements emerge.

---

# Clarification Is Not an Error

Do not represent:

```text
"I need to know which database you mean."
```

as:

```text
500 Internal Server Error
```

It is a valid interaction state.

The runtime should be able to pause and resume.

---

# Question Lifecycle

```text
pending
   ↓
answered
```

or:

```text
pending
   ├── cancelled
   └── expired
```

The answer should be associated with the original question ID and session.

---

# Question UI

The UI should support:

### Free-form question

```text
Which database should I use?

[_____________________]

[Submit]
```

### Optional structured choices

```text
Which environment?

○ Development
○ Staging
○ Production

[Submit]
```

The LLM may generate the question content, but the runtime controls the interaction state.

---

# Resume Semantics

When the user answers a clarification:

```text
ClarificationRequest
       ↓
answer
       ↓
resume pending interaction
```

Do not start an unrelated new task if a pending interaction exists.

The answer must be available to the pending task/cognition context.

---

# Conversation Persistence

Determine how approval and clarification events interact with the M3 transcript.

At minimum, preserve enough information to reconstruct the interaction:

```text
request created
request answered/rejected
request resolved
```

Do not encode structured interaction state solely as arbitrary assistant text.

If transcript representation is needed, use explicit message/event metadata rather than losing the distinction between:

```text
assistant said something
```

and:

```text
runtime requested approval
```

---

# Interaction State

M6 should establish a general concept of a pending interaction.

Conceptually:

```text
Interaction
├── approval
├── clarification
└── future interaction types
```

However, do not build a giant interaction framework.

A small common lifecycle abstraction is useful if it naturally emerges from the implementations.

Avoid speculative fields for future UI workflows.

---

# Interaction Concurrency

The implementation must define what happens if a session has a pending interaction and receives another message.

For M6, prefer a simple deterministic policy.

Recommended:

```text
pending approval/clarification
       +
new user input
       ↓
runtime determines whether input resolves
the pending interaction
```

Do not allow multiple ambiguous pending interactions in the same session without an explicit identity.

If multiple interactions are eventually required, the interaction ID provides the mechanism to disambiguate them.

---

# Error Handling

Invalid interaction operations must fail deterministically.

Examples:

```text
approve nonexistent request → 404
approve already approved → conflict
answer nonexistent question → 404
answer already answered → conflict
wrong session → reject
malformed command → 400
unknown slash command → 400 or structured command error
```

Do not route these failures through the LLM.

---

# Testing

## M6a Tests

Test:

* command recognition
* ordinary messages remain ordinary messages
* command arguments
* aliases
* unknown commands
* malformed commands
* `/status`
* `/new`
* `/health`
* `/export`
* `/rename`
* `/thinking`
* `/timestamps`
* `/undo`
* `/fork`
* `/restart-runtime`

At minimum verify that commands do not generate LLM requests.

---

# M6b Tests

Test:

* approval creation
* unique IDs
* pending state
* approval
* rejection
* cancellation
* invalid state transitions
* nonexistent approval
* wrong session
* duplicate approval
* persistence/recovery if approvals are persisted
* explicit approval required
* LLM text cannot satisfy approval

---

# M6c Tests

Test:

* question creation
* pending state
* answer
* cancellation
* expiration if implemented
* invalid state transitions
* nonexistent question
* wrong session
* free-form answer
* structured choice answer
* pending interaction resumes correctly
* answer does not accidentally become a new unrelated task

---

# Regression Requirements

All existing milestones must remain green.

At minimum:

```text
M1 conversation
M2 streaming
M3 persistence
M4 candidate extraction
M5 provider compatibility
```

must continue working.

Particular regression checks:

* slash commands do not trigger memory extraction
* commands do not create fake assistant messages
* normal conversations still create memory candidates
* streaming still works
* provider switching still works
* OpenCode session headers remain correct
* session IDs remain stable
* command operations do not alter provider configuration
* approval/clarification state does not leak provider credentials

---

# M6 Non-Goals

Do NOT implement:

* autonomous tool execution
* tool permissions
* sophisticated policy engines
* approval policies
* role-based access control
* multi-user authorization
* workflow engines
* task DAGs
* persistent autonomous jobs
* skill execution
* MCP integration
* epistemic memory
* semantic memory
* automatic memory retrieval
* model routing
* provider failover
* complex UI framework
* command scripting language

M6 establishes primitives that later milestones can build upon.

---

# Definition of Done

## M6a

* [x] Slash command parser exists.
* [x] Command dispatch is deterministic.
* [x] Initial command catalog implemented.
* [x] Commands bypass LLM processing.
* [x] Command results are structured.
* [x] Session commands work.
* [x] Runtime commands work.
* [x] UI reflects command state where appropriate. (test-client.html; structured payloads for future clients)
* [x] Command behavior is tested.

Evidence: `.reference/plans/evidence/milestone-6a-evidence-commands.md` (2026-09-11). M6b/M6c pending.

## M6b

* [ ] Approval requests have explicit IDs and lifecycle state.
* [ ] UI can display pending approvals.
* [ ] User can approve/reject explicitly.
* [ ] Approval state is deterministic.
* [ ] LLM text cannot implicitly approve an action.
* [ ] Invalid state transitions are rejected.
* [ ] Approval behavior is tested.

## M6c

* [ ] Clarification requests have explicit IDs and lifecycle state.
* [ ] UI can display questions.
* [ ] Free-form answers work.
* [ ] Structured choices can work.
* [ ] Answer resolves the correct pending request.
* [ ] Runtime can resume after clarification.
* [ ] Invalid state transitions are rejected.
* [ ] Clarification behavior is tested.

---

# Final M6 Invariant

After M6, ICOS should have three distinct paths:

```text
                         User input
                             │
                 ┌───────────┼───────────┐
                 │           │           │
                 ↓           ↓           ↓
             /command    conversation   pending
                 │           │          interaction
                 ↓           ↓           ↓
             Core action     LLM       resolve
                                         │
                                         ↓
                                      continue
```

The critical rule:

```text
Commands       → deterministic
Approvals      → explicit human state
Clarifications → explicit interaction state
Conversation    → LLM
```

Do not collapse these into one generic "message processing" path.

M6 should make the distinction explicit in the architecture.
