# Milestone 3 — Persistent Session Store + FTS5

Status: planned
Scope: `apps/core/` only. No changes to epistemic memory, Sentinel, tools, plugins, or model-provider architecture.

## 1. Goal

Replace the current in-memory session store with a persistent SQLite-backed session store.

The system must:

* preserve conversations across Core restarts;
* allow users to list and reopen previous sessions;
* preserve complete message history;
* provide full-text search across historical conversation content;
* retain the existing Core conversation API behavior;
* keep the session store conceptually separate from future epistemic memory.

This milestone is **historical transcript persistence**, not cognitive/epistemic memory.

### Important distinction

The session store answers:

> "What did we actually say?"

Future `epistemic-memory` answers:

> "What does ICOS know or believe based on what happened?"

The transcript database is the underlying evidence record. Do not introduce semantic embeddings, vector search, memory classification, consolidation, provenance scoring, or RuVector in this milestone.

---

## 2. Agreed decisions

### Storage

* SQLite.
* One persistent database file for Core.
* Database location configured by environment variable.
* Default development location: `./data/core.sqlite`.
* Create the parent directory automatically if required.

### Search

* SQLite FTS5.
* Index user and assistant message content.
* Search returns references to actual stored messages.
* FTS5 is lexical/full-text retrieval, not semantic memory.
* Use SQLite/FTS5 ranking for initial result ordering.

### Sessions

Sessions survive Core restarts.

Existing `sessionId` behavior remains unchanged.

A session consists of:

```text
Session
├── id
├── createdAt
├── updatedAt
└── messages
    ├── user
    ├── assistant
    ├── user
    └── assistant
```

### Message history

Store every conversation message.

Do not trim persisted history to `MAX_HISTORY`.

`MAX_HISTORY` remains a **context-construction limit**, not a storage limit.

For example:

```text
Database:
    2,000 historical messages

LLM context:
    most recent 50 messages
```

This distinction is important.

---

## 3. Current state

Milestone 2 currently has:

```text
ConversationService
    ↓
SessionStore
    ↓
in-memory Map<string, ChatMessage[]>
```

The browser can communicate with Core and streaming works.

The current `SessionStore` loses all sessions when Core stops.

Milestone 3 replaces only the persistence mechanism.

The rest of Core should remain conceptually unchanged:

```text
HTTP / UI
    ↓
ConversationService
    ↓
SessionStore
    ↓
ContextBuilder
    ↓
LlmClient
```

---

# 4. Database schema

Use a small schema.

## sessions

```sql
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

Do not add speculative metadata yet.

Potential future fields such as title, summary, model, profile, tags, etc. are deferred unless required by the existing implementation.

## messages

```sql
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,

    FOREIGN KEY (session_id)
        REFERENCES sessions(id)
        ON DELETE CASCADE
);

CREATE INDEX idx_messages_session_id
ON messages(session_id);

CREATE INDEX idx_messages_session_created
ON messages(session_id, created_at);
```

`role` is initially constrained at the application layer to the existing supported roles:

```text
user
assistant
```

Do not introduce system/tool/developer message persistence unless the current Core implementation already requires it.

---

# 5. FTS5 index

Create an FTS5 virtual table over message content.

Preferred initial design:

```sql
CREATE VIRTUAL TABLE messages_fts
USING fts5(
    content,
    content='messages',
    content_rowid='id'
);
```

Use triggers or equivalent repository logic to keep the FTS index synchronized with `messages`.

The search index must not become the source of truth.

```text
messages
    ↓
canonical transcript

messages_fts
    ↓
search index
```

If the FTS index is ever lost or corrupted, it must be possible to rebuild it from `messages`.

SQLite FTS5 supports full-text queries, phrase queries, prefix queries, boolean combinations, and relevance ranking, which is sufficient for this milestone.

---

# 6. Session repository

Replace the current Map-backed persistence with a repository abstraction.

Create:

```text
session/
├── session.store.ts
├── session.repository.ts
└── ...
```

The repository should expose only the operations Core actually needs.

Suggested interface:

```typescript
interface SessionRepository {

    createSession(id: string): Promise<void>;

    getSession(id: string): Promise<Session | null>;

    appendMessage(
        sessionId: string,
        message: ChatMessage
    ): Promise<void>;

    getMessages(
        sessionId: string,
        options?: {
            limit?: number;
            before?: string;
        }
    ): Promise<ChatMessage[]>;

    listSessions(
        options?: {
            limit?: number;
            offset?: number;
        }
    ): Promise<SessionSummary[]>;

    searchMessages(
        query: string,
        options?: {
            limit?: number;
            sessionId?: string;
        }
    ): Promise<SessionSearchResult[]>;
}
```

The exact interface may be adjusted to fit the existing code.

Do not build a generic database abstraction framework.

Do not introduce repositories/factories for hypothetical future databases.

SQLite is the implementation.

---

# 7. SessionStore responsibility

`SessionStore` should remain the Core-facing abstraction.

The important distinction is:

```text
ConversationService
        ↓
   SessionStore
        ↓
SessionRepository
        ↓
     SQLite
```

`ConversationService` should not know SQL exists.

It should continue to perform operations such as:

```typescript
const session = await sessions.resolve(sessionId);

await sessions.append(session.id, {
    role: "user",
    content: input
});
```

The persistence implementation should remain below that boundary.

---

# 8. Conversation flow

The existing conversation flow becomes:

```text
POST /core/conversation
        │
        ▼
resolve session
        │
        ├── existing → load persisted history
        │
        └── missing → create session
        │
        ▼
build context
        │
        ▼
LLM
        │
        ▼
append assistant response
        │
        ▼
return response
```

Both user and assistant messages must be persisted.

The database write should occur before the response is considered successfully completed.

---

# 9. Context construction

Do not send the entire persisted session to the LLM.

The existing `MAX_HISTORY` behavior remains.

Example:

```text
SQLite
│
├── message 1
├── message 2
├── ...
├── message 998
├── message 999
└── message 1000
          │
          ▼
   SessionStore.getMessages()
          │
          ▼
     MAX_HISTORY
          │
          ▼
    ContextBuilder
          │
          ▼
         LLM
```

Persistence is unlimited for practical purposes.

Context remains bounded.

This prevents the database architecture from becoming coupled to context-window size.

---

# 10. New HTTP endpoints

Keep the existing endpoints working.

## Existing

```http
POST /core/conversation
GET /core/conversation/:id
```

## Add

### List sessions

```http
GET /core/sessions
```

Response:

```json
{
    "sessions": [
        {
            "sessionId": "ae703989-d311-4f09-b6c4-79f7b5f9a130",
            "createdAt": "2026-09-10T...",
            "updatedAt": "2026-09-10T..."
        }
    ]
}
```

Order newest activity first.

Add a reasonable default limit.

Do not implement infinite pagination yet.

### Search sessions

```http
GET /core/sessions/search?q=phi-4
```

Example response:

```json
{
    "results": [
        {
            "sessionId": "ae703989-d311-4f09-b6c4-79f7b5f9a130",
            "messageId": 42,
            "role": "assistant",
            "content": "The reasoning model...",
            "createdAt": "2026-09-10T..."
        }
    ]
}
```

Search must return actual stored messages, not only FTS index rows.

---

# 11. Existing GET history endpoint

Continue supporting:

```http
GET /core/conversation/:id
```

It must now retrieve history from SQLite.

Expected behavior remains:

```json
{
    "sessionId": "...",
    "messages": [
        {
            "role": "user",
            "content": "Hello"
        },
        {
            "role": "assistant",
            "content": "Hello!"
        }
    ]
}
```

No API break should be introduced solely because storage changed.

---

# 12. Database initialization

Core should initialize the SQLite database on startup.

Startup should:

1. create the data directory if required;
2. open the database;
3. create required tables;
4. create indexes;
5. create/configure FTS5;
6. verify the schema;
7. then start accepting requests.

For this milestone, a lightweight schema initialization mechanism is sufficient.

Do not introduce a large migration framework unless the existing project already has one.

However, schema changes must be deterministic and repeatable.

---

# 13. Failure behavior

Database failures must not be silently swallowed.

Examples:

```text
database cannot open
    → Core fails startup

database write fails
    → conversation request fails

database read fails
    → request fails

FTS search fails
    → search endpoint returns an appropriate server error
```

Do not return an apparently successful assistant response if Core failed to persist the conversation.

The transcript is the source of truth.

---

# 14. Testing

Add tests for:

### Session persistence

```text
create session
append messages
destroy/recreate store
load session
verify messages remain
```

### Multiple sessions

Verify messages never cross session boundaries.

### Message ordering

```text
user
assistant
user
assistant
```

must remain in exact chronological order.

### Context limit

Persist 100+ messages.

Verify:

```text
database contains all messages
```

while:

```text
ContextBuilder receives only MAX_HISTORY
```

### Session listing

Verify newest `updatedAt` sessions appear first.

### FTS search

Persist:

```text
"I like teal"
"The Phi-4 test was strange"
"RuVector will come later"
```

Search:

```text
Phi-4
```

and verify the appropriate message is returned.

### Session-filtered search

Search globally.

Then search with:

```text
sessionId=<specific session>
```

Verify results are restricted correctly.

### Restart persistence

Start Core.

Create conversation.

Stop Core.

Start Core again.

Retrieve the same session.

Verify the complete history remains.

### FTS rebuild

If practical, test that the FTS index can be rebuilt from canonical message data.

---

# 15. Frontend changes

Update the existing minimal chat console only as much as necessary.

Add:

```text
New session
Previous sessions
Search
```

A minimal UI is sufficient.

Example:

```text
┌──────────────────────────────────────────┐
│ ICOS                         [+ New]      │
├──────────────┬───────────────────────────┤
│ Sessions     │                           │
│              │  conversation             │
│ Today        │                           │
│ > Phi test   │  User: hello              │
│   ICOS test  │  Isabel: hello!           │
│              │                           │
│ Yesterday    │  [message input] [Send]   │
│   ...        │                           │
└──────────────┴───────────────────────────┘
```

Do not build a frontend framework.

Do not build authentication.

Do not build account management.

Do not build rich search UI.

The purpose is simply to make persistent sessions usable.

---

# 16. Explicit non-goals

Do NOT implement:

* RuVector
* embeddings
* semantic/vector search
* memory classification
* episodic memory
* semantic memory
* procedural memory
* memory consolidation
* memory decay
* confidence scoring
* provenance graphs
* knowledge ecology
* Sentinel
* automatic summarization
* automatic session titles
* autonomous memory extraction
* Redis
* Postgres
* cloud database
* multi-user accounts
* authentication
* distributed sessions
* generic database abstraction
* generic persistence framework

Those belong to later milestones.

---

# 17. Architectural rule

The session database is **evidence storage**, not cognition.

Do not allow this milestone to evolve into:

```text
SQLite
   ↓
"memory system"
   ↓
LLM
```

The correct relationship is:

```text
                   CORE
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
   SESSION STORE       EPISTEMIC MEMORY
          │                   │
       SQLite             RuVector
          │
     raw history
          │
          └────── evidence ──────→
```

The session store knows what happened.

Epistemic Memory will eventually interpret what happened.

---

# 18. Execution order

1. [ ] Add SQLite dependency and configuration.
2. [ ] Create database initialization/schema.
3. [ ] Implement `sessions` and `messages`.
4. [ ] Implement FTS5 index.
5. [ ] Replace Map-backed `SessionStore`.
6. [ ] Verify existing conversation endpoint still works.
7. [ ] Verify streaming still works.
8. [ ] Add session listing endpoint.
9. [ ] Add session search endpoint.
10. [ ] Add restart persistence tests.
11. [ ] Update minimal frontend to browse/reopen sessions.
12. [ ] Run complete test suite.
13. [ ] Perform manual restart test with a real model.

---

# 19. Verification

Milestone 3 passes when all of the following are true:

### Persistence

```text
Conversation
    ↓
Core shutdown
    ↓
Core restart
    ↓
same session
    ↓
complete history
```

works.

### Search

A message written during an earlier session can be found through FTS5.

### Isolation

Two sessions cannot see each other's messages.

### Context

Persisted history may be arbitrarily long, while the LLM context remains bounded by `MAX_HISTORY`.

### Streaming

Milestone 2 streaming continues to work unchanged.

### Provider independence

Switching between OpenAI-compatible providers continues to work unchanged.

### Frontend

The user can:

* start a new session;
* send messages;
* close/restart Core;
* return to an old session;
* continue the conversation;
* search historical conversations.

---

# 20. Definition of done

Milestone 3 is complete when ICOS has a durable answer to:

> **"What did we actually talk about?"**

without requiring RuVector, embeddings, an LLM memory layer, or any semantic interpretation.

The result should be boring.

That is intentional.

```text
Core
 │
 ├── conversation
 │
 ├── streaming
 │
 └── sessions
       │
       ├── SQLite
       ├── complete transcripts
       └── FTS5 search
```

Nothing more.

The next milestone can then build epistemic memory **on top of a durable historical record**, rather than trying to make the memory system simultaneously serve as the chat transcript database.
