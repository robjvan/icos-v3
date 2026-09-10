# ICOS v3 — Milestone 4: Memory Candidate Extraction

## Status

Planned.

## Objective

Introduce the first cognitive-memory boundary into ICOS Core.

The system must be able to examine a completed conversation turn and identify **potentially durable knowledge** without relying on rigid regex/rule-based extraction.

Milestone 4 does **not** implement the full epistemic memory system.

It implements a narrow, inspectable pipeline:

```text
conversation turn
      ↓
memory candidate extractor
      ↓
structured candidates
      ↓
deterministic validation
      ↓
candidate persistence
```

The output is **candidate knowledge**, not committed memory.

The system must not yet perform semantic/vector retrieval, contradiction resolution, consolidation, decay, or automatic belief mutation.

---

# 1. Architectural Principle

ICOS must distinguish three things:

### Session history

> What actually happened?

Owned by the Core Session Store.

### Memory candidates

> What information from what happened might be worth retaining?

Owned by the Memory Candidate Extraction subsystem.

### Epistemic memory

> What does ICOS currently retain, believe, know, or consider relevant?

Owned by the future Epistemic Memory subsystem.

The architecture should therefore remain:

```text
                         CORE
                          │
             ┌────────────┴────────────┐
             │                         │
       SESSION STORE            MEMORY EXTRACTION
             │                         │
          SQLite                    LLM
             │                         │
      raw conversation        candidate knowledge
             │                         │
             └────────────┬────────────┘
                          │
                          ▼
                  FUTURE EPISTEMIC
                      MEMORY
                       RuVector
```

Do not collapse these layers.

---

# 2. Scope

### Included

* memory candidate extraction
* structured LLM output
* candidate schema
* candidate validation
* candidate persistence
* provenance linking candidates to source messages
* configurable extraction model/settings
* extraction after completed conversation turns
* tests
* basic inspection/debug endpoint or CLI output

### Explicitly excluded

* RuVector
* embeddings
* vector search
* semantic retrieval
* graph storage
* contradiction resolution
* reinforcement
* consolidation
* decay
* forgetting
* belief revision
* automatic memory promotion
* memory summarization
* autonomous background cognition
* complex ontology
* memory deletion UI
* multi-user memory

Do not prematurely implement these.

---

# 3. Core Concept: Candidate Knowledge

A candidate is an observation produced by the extraction model.

Example:

User:

> "I've decided to use SQLite for Core sessions."

Candidate:

```json
{
  "kind": "decision",
  "subject": "user",
  "predicate": "selected",
  "object": "SQLite for Core session persistence",
  "confidence": 0.98,
  "importance": 0.86,
  "stability": 0.91
}
```

Another example:

> "I really prefer building with TypeScript."

```json
{
  "kind": "preference",
  "subject": "user",
  "predicate": "prefers",
  "object": "TypeScript",
  "confidence": 0.94,
  "importance": 0.72,
  "stability": 0.88
}
```

Another:

> "My current project is ICOS v3."

```json
{
  "kind": "project",
  "subject": "user",
  "predicate": "working_on",
  "object": "ICOS v3",
  "confidence": 0.99,
  "importance": 0.91,
  "stability": 0.95
}
```

The extractor describes what was observed.

It does **not** decide whether the candidate becomes durable epistemic memory.

---

# 4. Extraction Must Be LLM-Based

Do not implement memory extraction using a large collection of regexes or keyword rules.

Natural language is too varied.

The extractor should receive a bounded conversation context and return structured JSON conforming to a defined schema.

The LLM is responsible for:

* identifying potentially durable information
* interpreting natural language
* determining candidate type
* identifying subject/object relationships
* estimating confidence
* estimating importance
* estimating likely stability
* distinguishing explicit statements from weak implications

Deterministic application code is responsible for:

* schema validation
* required fields
* length limits
* enum validation where appropriate
* provenance
* persistence
* malformed-response handling
* duplicate candidate handling within the extraction result

---

# 5. Extraction Prompt

The extractor should be instructed approximately as follows:

```text
You are the memory candidate extractor for ICOS.

Review the supplied conversation turn and identify information that may
be useful to retain as durable knowledge.

Do not extract ordinary conversational filler.

Prefer explicit statements over speculation.

Look for information about:
- the user
- people and relationships
- projects
- work
- skills
- hobbies
- interests
- preferences
- likes and dislikes
- goals
- decisions
- recurring activities
- important context
- persistent facts
- significant events
- facts about ICOS itself
- facts established during the conversation

Do not invent information.

Do not infer sensitive personal attributes unless explicitly stated and
appropriate for the memory system.

Return only structured JSON matching the supplied schema.

A candidate is an observation worth considering for memory, not a final
memory commitment.
```

The exact prompt should be refined empirically.

Do not over-engineer the prompt before observing real extraction behavior.

---

# 6. Initial Candidate Schema

Start with a deliberately small schema.

```typescript
interface MemoryCandidate {
  id: string;

  kind: MemoryCandidateKind;

  subject: string;

  predicate: string;

  object: string;

  confidence: number;

  importance: number;

  stability: number;

  source: {
    sessionId: string;
    messageId: number;
  };

  extractedAt: string;
}
```

Initial kinds:

```typescript
type MemoryCandidateKind =
  | 'fact'
  | 'preference'
  | 'person'
  | 'relationship'
  | 'project'
  | 'work'
  | 'skill'
  | 'hobby'
  | 'interest'
  | 'goal'
  | 'decision'
  | 'event'
  | 'observation';
```

Do not create a separate database table for every kind.

These are semantic classifications, not storage architectures.

The ontology can evolve later.

---

# 7. Why Subject / Predicate / Object

Prefer a normalized claim structure:

```text
subject → predicate → object
```

rather than storing every memory as arbitrary prose.

Examples:

```text
user → prefers → TypeScript

user → working_on → ICOS v3

user → selected → SQLite

user → enjoys → bass-heavy music

person:A → related_to → user

project:ICOS → uses → RuVector
```

The human-readable claim can always be reconstructed.

This structure will later make contradiction and reinforcement substantially easier.

For example:

```text
user → prefers → SQLite

user → prefers → PostgreSQL
```

can become two competing claims about the same subject/predicate relationship.

That is much harder to reason about if memory is merely a collection of paragraphs.

---

# 8. Candidate Persistence

Persist candidates separately from the session transcript.

Suggested SQLite table:

```sql
CREATE TABLE memory_candidates (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,

  kind TEXT NOT NULL,

  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,

  confidence REAL NOT NULL,
  importance REAL NOT NULL,
  stability REAL NOT NULL,

  extracted_at TEXT NOT NULL,

  FOREIGN KEY (session_id)
    REFERENCES sessions(id)
    ON DELETE CASCADE,

  FOREIGN KEY (message_id)
    REFERENCES messages(id)
    ON DELETE CASCADE
);

CREATE INDEX idx_memory_candidates_session
  ON memory_candidates(session_id);

CREATE INDEX idx_memory_candidates_message
  ON memory_candidates(message_id);

CREATE INDEX idx_memory_candidates_kind
  ON memory_candidates(kind);
```

The candidate store is **not epistemic memory**.

It is an intermediate/evidence layer.

This distinction must remain explicit in the code and documentation.

---

# 9. Provenance Is Mandatory

Every candidate must point back to the exact source message.

Do not create candidate memories without provenance.

Example:

```text
candidate
   │
   ├── sessionId
   └── messageId
             │
             ▼
        original message
```

Later ICOS should be able to answer:

> Why do you think this?

and trace the claim back to the conversation that produced it.

---

# 10. Extraction Timing

For the first implementation, extraction occurs after a successful completed assistant response.

Current flow:

```text
POST conversation
       │
       ▼
resolve session
       │
       ▼
persist user message
       │
       ▼
build context
       │
       ▼
LLM response
       │
       ▼
persist assistant message
       │
       ▼
return response
       │
       ▼
memory candidate extraction
```

The extraction operation must not block the user response initially.

If practical, run it asynchronously after the turn is persisted.

A failed extraction must **not** cause the conversation itself to fail.

This is important because memory extraction is currently an enrichment process, not a prerequisite for conversation.

---

# 11. What Gets Sent to the Extractor

Do not send the entire lifetime conversation.

For M4, provide:

* the current user message
* the current assistant response
* enough immediate context to interpret references

A small bounded window is sufficient.

Example:

```text
Previous context:
...

User:
"I've decided to use SQLite for this."

Assistant:
"That makes sense..."

Extract candidates from the completed turn.
```

Future versions may use relevant existing memories to improve extraction and detect changes.

That is intentionally outside the first slice.

---

# 12. Candidate Filtering

After LLM extraction, deterministic validation should reject:

* malformed candidates
* missing required fields
* empty subject/predicate/object
* invalid numeric ranges
* absurdly long fields
* unknown candidate kinds
* candidates with missing provenance
* duplicate candidates from the same extraction result

Example validation:

```text
confidence ∈ [0, 1]
importance  ∈ [0, 1]
stability   ∈ [0, 1]
```

Do not yet impose an aggressive "importance threshold."

Store enough information to observe extractor behavior.

The first goal is learning what the extractor produces.

---

# 13. Important: Do Not Automatically Promote Candidates

M4 must NOT do this:

```text
LLM says candidate
       ↓
SAVE TO EPISTEMIC MEMORY
```

Instead:

```text
LLM
 │
 ▼
candidate
 │
 ▼
validate
 │
 ▼
candidate store
```

Future epistemic processing will determine whether a candidate:

* becomes a memory
* reinforces an existing memory
* contradicts an existing memory
* updates an existing memory
* remains weak evidence
* expires
* is discarded
* requires additional evidence

That is future work.

---

# 14. Do Not Implement Decay Yet

Decay is deliberately postponed.

There is no reason to assume every memory should decay.

Different knowledge may have completely different temporal behavior.

For example:

```text
user → prefers → X
```

may remain useful for years.

Whereas:

```text
user → currently_working_on → project X
```

may become obsolete quickly.

And:

```text
washing_machine → state → running
```

might be useful for minutes.

The eventual memory system should therefore likely model **temporal validity and stability**, rather than applying a universal decay timer.

M4 should merely capture enough metadata to support this later.

---

# 15. Future Knowledge Ecology

Do not implement this in M4, but preserve architectural room for:

```text
                 candidate
                     │
                     ▼
              existing knowledge
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
         NEW     REINFORCE   CONTRADICT
          │          │          │
          │          │          ▼
          │          │      belief revision
          │          │
          └──────────┴──────────────┐
                                    ▼
                              consolidation
                                    │
                                    ▼
                              epistemic memory
```

This is the eventual **knowledge ecology**.

Memory is not a static RAG index.

It is an evolving collection of claims with:

* provenance
* confidence
* temporal validity
* relationships
* reinforcement
* contradiction
* replacement
* uncertainty
* potentially decay/forgetting

M4 merely creates the first organisms.

---

# 16. Service Boundary

Keep extraction behind an explicit interface.

For example:

```typescript
interface MemoryCandidateExtractor {
  extract(input: MemoryExtractionInput): Promise<MemoryCandidate[]>;
}
```

Input:

```typescript
interface MemoryExtractionInput {
  sessionId: string;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  context?: ChatMessage[];
}
```

The implementation can initially be:

```text
LlmMemoryCandidateExtractor
```

but the Core should depend on the interface rather than embedding extraction logic directly inside `ConversationService`.

---

# 17. LLM Client Consideration

Do not contaminate the generic conversational LLM client with memory-specific prompting.

The existing generic LLM boundary should remain generic.

If the current client can support structured/non-streaming generation cleanly, reuse it.

Otherwise add a narrowly scoped capability.

Do not create provider-specific memory extractors.

The extraction model must remain replaceable just like the conversation model.

Eventually ICOS may use:

```text
conversation model → model A

memory extraction → small model B

Sentinel → model C

subagent → model D
```

M4 should not hard-code this architecture, but it must not prevent it.

---

# 18. Testing

Tests must verify at minimum:

### Extraction

* explicit user preference produces a preference candidate
* explicit project statement produces a project candidate
* explicit decision produces a decision candidate
* explicit relationship produces a relationship candidate
* ordinary greeting produces zero or near-zero candidates
* ambiguous language does not become fabricated fact
* multiple candidates can be extracted from one turn

### Validation

* invalid kind rejected
* missing subject rejected
* missing predicate rejected
* missing object rejected
* confidence outside `[0,1]` rejected
* importance outside `[0,1]` rejected
* stability outside `[0,1]` rejected

### Provenance

Every persisted candidate references:

```text
sessionId
messageId
```

### Persistence

Candidates survive process/database recreation.

### Failure isolation

If extraction fails:

```text
conversation succeeds
candidate extraction fails
```

The user should still receive the assistant response.

### Provider independence

The extractor should work against the same generic OpenAI-compatible boundary already used by Core.

---

# 19. Manual Verification

Create a small set of deliberately varied conversations.

Examples should include:

```text
preferences
projects
work
hobbies
people
relationships
decisions
goals
temporary states
irrelevant chatter
contradictory statements
implicit statements
multiple facts in one message
```

Inspect the raw candidate output.

Do not optimize for theoretical correctness.

Optimize for being able to **see what the system thinks is memorable**.

This will drive the next iteration of the ontology and extraction prompt.

---

# 20. Minimal Inspection Interface

Add one simple way to inspect candidates.

For example:

```text
GET /core/memory-candidates?sessionId=...
```

or an equivalent development-only endpoint.

Return:

```json
{
  "candidates": [
    {
      "id": "...",
      "kind": "preference",
      "subject": "user",
      "predicate": "prefers",
      "object": "SQLite",
      "confidence": 0.94,
      "importance": 0.72,
      "stability": 0.88,
      "source": {
        "sessionId": "...",
        "messageId": 17
      }
    }
  ]
}
```

A simple inspection endpoint is preferable to building a UI.

---

# 21. Definition of Done

M4 is complete when ICOS can:

1. conduct a normal conversation
2. persist the conversation
3. pass the completed turn through an LLM-based extractor
4. receive structured memory candidates
5. validate them deterministically
6. persist them independently from session history
7. preserve exact provenance
8. expose candidates for inspection
9. survive extractor failures without breaking conversation
10. work without RuVector or semantic memory

At the end of M4, ICOS should be able to answer:

> **"What potentially durable information did I notice in that conversation?"**

It should **not** yet claim:

> **"This is what I know."**

That distinction is the foundation for the future epistemic memory system.

# M4 Addendum — Extraction Model and Evidence Ledger

This addendum supersedes and clarifies the portions of the M4 plan concerning the extraction LLM and storage of memory candidates.

## 1. Memory Extraction Uses a Separate LLM

The memory candidate extractor must **not** use the primary conversational LLM configuration.

ICOS should treat memory extraction as a separate model role.

Example configuration:

```env
# Primary conversational model
LLM_BASE_URL=http://...
LLM_MODEL=...

# Memory extraction model
MEMORY_LLM_BASE_URL=http://localhost:11434/v1
MEMORY_LLM_MODEL=gemma4-e4b-unc:latest
MEMORY_LLM_API_KEY=
MEMORY_LLM_TIMEOUT_MS=60000
```

The memory model may be a small local model such as:

* Gemma 4 E4B
* Qwen 2.5 7B
* another locally hosted instruct model

The primary conversational model may independently be:

* a cloud model
* a local model
* a different provider
* a different model entirely

There must be no requirement that the two models share a provider, model, endpoint, or configuration.

Conceptually:

```text
                 ICOS CORE
                     │
          ┌──────────┴──────────┐
          │                     │
          ▼                     ▼
   Conversation LLM       Memory Extractor
          │                     │
     PRIMARY MODEL         MEMORY MODEL
          │                     │
   cloud / local          preferably local
```

This separation is intentional.

The memory extraction task is narrower, frequent, and potentially privacy-sensitive. It should be possible to perform it entirely locally even when the primary conversational model is hosted remotely.

The extraction subsystem should therefore have an explicit model boundary rather than implicitly reusing the primary `LLM_MODEL`.

---

## 2. Candidates Are Evidence, Not Epistemic Memory

The `memory_candidates` table introduced by M4 must **not** be considered the canonical memory store.

A candidate represents:

> "The extraction process observed this potentially durable piece of information in this conversation."

It is an intermediate evidence record.

The architectural distinction is:

```text
SESSION STORE
    │
    │ raw conversation
    ▼
MEMORY CANDIDATE
    │
    │ extracted observation
    ▼
EVIDENCE LEDGER
    │
    │ future epistemic processing
    ▼
EPISTEMIC MEMORY
    │
    ▼
RuVector
```

M4 therefore does **not** create a temporary implementation of the future RuVector memory system.

It creates a durable record of observations that can later feed that system.

---

## 3. Candidate Storage

For M4, candidates should be stored in the existing Core SQLite database alongside session history.

Example:

```text
core.sqlite

sessions
messages
memory_candidates
```

This is appropriate because SQLite is currently Core's durable local evidence store.

The candidate table should preserve provenance and extraction metadata.

Recommended fields include:

```text
id
session_id
message_id

kind
subject
predicate
object

confidence
importance
stability

extractor_model
extractor_version
extracted_at
```

`extractor_model` and `extractor_version` are important.

ICOS must be able to determine which model and extraction definition produced a candidate.

For example:

```text
candidate #1837

source:
  session_id = abc123
  message_id = 472

extractor:
  model = gemma4-e4b-unc
  version = memory-extraction-v1

claim:
  user → prefers → TypeScript
```

---

## 4. No Future Migration of Candidates Into RuVector

Do **not** design M4 as:

```text
SQLite candidates
       ↓
migration
       ↓
RuVector
```

That would incorrectly treat candidates as the canonical representation of memory.

Instead:

```text
SQLite
  │
  ├── conversations
  └── memory candidates
             │
             ▼
      future epistemic processor
             │
             ▼
          RuVector
```

SQLite retains the historical evidence.

RuVector eventually stores the **derived epistemic state**.

If the RuVector representation changes, is rebuilt, or is replaced entirely, the historical candidate/evidence records remain available.

This means the epistemic layer can theoretically reconstruct its current knowledge state from the accumulated evidence.

---

## 5. Future Knowledge Ecology

M4 does not implement contradiction, reinforcement, supersession, decay, or consolidation.

However, its data model must not prevent them.

Future processing may look conceptually like:

```text
                 EVIDENCE
                    │
          ┌─────────┼─────────┐
          ▼         ▼         ▼
         NEW    REINFORCEMENT CONTRADICTION
          │         │         │
          └─────────┼─────────┘
                    ▼
             EPISTEMIC STATE
                    │
                    ▼
                 RuVector
```

Individual observations should remain intact.

For example:

```text
Observation 1:
user → prefers → SQLite

Observation 2:
user → prefers → SQLite

Observation 3:
user → prefers → PostgreSQL
```

The future epistemic layer may determine that:

```text
user → prefers → SQLite

confidence: high
supporting evidence: 2
contradicting evidence: 1
```

or potentially determine that the apparent contradiction is contextual or temporal.

The observations themselves are not rewritten to make the current belief look clean.

**History remains history. Knowledge is derived from history.**

---

## 6. Temporal Behavior

Do not implement universal memory decay in M4.

An observation does not become false merely because it is old.

For example:

```text
user → worked_on → Project X
```

remains historically true even if the user later moves to Project Y.

The future epistemic layer may represent:

```text
Project X
  status: historical
  valid_until: ...

Project Y
  status: current
  valid_from: ...
```

Therefore M4 should preserve timestamps and avoid destructive expiration of candidates.

Decay, forgetting, temporal validity, and relevance are future properties of the **derived epistemic state**, not the evidence ledger.

---

## 7. Architectural Ownership

The resulting boundaries should remain explicit:

```text
Core Session Store
    │
    └── "What actually happened?"

Memory Candidate Extractor
    │
    └── "What potentially durable information did I notice?"

Evidence Ledger
    │
    └── "What observations have been produced, and where did they come from?"

Epistemic Memory
    │
    └── "What does ICOS currently retain, believe, or consider relevant?"

RuVector
    │
    └── substrate for the derived epistemic representation
```

Do not merge these responsibilities.

The goal is an evolving **knowledge ecology**, not merely a RAG index containing increasingly large numbers of extracted facts.

---

## 8. Revised M4 Mental Model

The complete M4 path is:

```text
                     USER
                       │
                       ▼
                PRIMARY LLM
                       │
                       ▼
                CONVERSATION
                       │
                       ▼
                 SESSION STORE
                    SQLite
                       │
                       │ completed turn
                       ▼
             MEMORY EXTRACTION LLM
                  local model
                       │
                       ▼
             STRUCTURED CANDIDATES
                       │
                       ▼
              DETERMINISTIC VALIDATION
                       │
                       ▼
                EVIDENCE LEDGER
                    SQLite
                       │
                       │
                 [future M5+]
                       │
                       ▼
              EPISTEMIC PROCESSOR
                       │
              ┌────────┼────────┐
              ▼        ▼        ▼
             NEW   REINFORCE  CONTRADICT
              │        │        │
              └────────┼────────┘
                       ▼
                   RuVector
                       │
                       ▼
              CURRENT KNOWLEDGE
```

M4 ends at the **Evidence Ledger**.

It does not attempt to build the knowledge ecology yet.
