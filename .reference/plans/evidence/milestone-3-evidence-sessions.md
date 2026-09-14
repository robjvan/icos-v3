# Milestone 3 — Sessions Evidence (SQLite + FTS5)

Date: 2026-09-10
App: `core/` (NestJS, `node dist/main`, port 3100 for the test)
LLM: Ollama, `LLM_MODEL=gemma4-e4b-unc:latest`
DB: default `./data/core.sqlite` (auto-created with `-wal`/`-shm`; gitignored)

## Boot 1 — fresh database, conversation, list, search

DB directory auto-created on startup. One turn:

```json
{"sessionId":"c8378339-5ecd-4b58-bf9b-e00dd4df6ad7","reply":"Confirmed. The vault code is teal-seven.","model":"gemma4-e4b-unc:latest"}
```

List:

```json
{"sessions":[{"sessionId":"c8378339-5ecd-4b58-bf9b-e00dd4df6ad7","createdAt":"2026-09-10T01:25:46.817Z","updatedAt":"2026-09-10T01:25:54.959Z","messageCount":2,"preview":"Remember this: the vault code is teal-seven. Confirm briefly."}]}
```

Search `vault` (rank-ordered, assistant message first):

```json
{"results":[
  {"sessionId":"c8378339-5ecd-4b58-bf9b-e00dd4df6ad7","messageId":2,"role":"assistant","content":"Confirmed. The vault code is teal-seven.","createdAt":"2026-09-10T01:25:54.959Z"},
  {"sessionId":"c8378339-5ecd-4b58-bf9b-e00dd4df6ad7","messageId":1,"role":"user","content":"Remember this: the vault code is teal-seven. Confirm briefly.","createdAt":"2026-09-10T01:25:54.957Z"}
]}
```

## Restart — process killed, rebooted against the same file

History intact:

```json
{"sessionId":"c8378339-5ecd-4b58-bf9b-e00dd4df6ad7","messages":[
  {"role":"user","content":"Remember this: the vault code is teal-seven. Confirm briefly."},
  {"role":"assistant","content":"Confirmed. The vault code is teal-seven."}
]}
```

Follow-up in the old session recalled the persisted fact (context reconstructed from SQLite):

```json
{"sessionId":"c8378339-5ecd-4b58-bf9b-e00dd4df6ad7","reply":"The vault code is teal-seven.","model":"gemma4-e4b-unc:latest"}
```

Streaming against the old session: `meta` → 5 tokens (`Te`, `al`, `-`, `seven`, `.`) → `done: Teal-seven.`

## Implementation notes

- `better-sqlite3` (SQLite 3.53.4, FTS5 confirmed) rather than stdlib `node:sqlite`, which still prints an experimental warning on this runtime.
- Raw FTS5 query first (phrase/prefix/boolean power syntax preserved); on query error, retry as a quoted literal phrase — required because ordinary text like `Phi-4` is not valid raw FTS5 (`no such column: 4`). Only `SQLITE_ERROR` takes this path; IO/corruption still propagate as 500s.
- `MAX_HISTORY` is now context-only; the transcript is unbounded. Verified: 14 persisted messages, 7 sent to the LLM.
- FTS index rebuildable from `messages` (`rebuildSearchIndex`, tested).

## Automated coverage

- `tsc` clean, `eslint` clean.
- 45 unit tests (schema init, repository CRUD/ordering/isolation/cursors, listing, search + fallback, restart via reopen, FTS rebuild, store async semantics, context bounding, service event ordering).
- 11 e2e tests (all M1/M2 cases unchanged, plus restart simulation, list ordering, search + session filter, bad-query handling).

## Verdict

Pass. ICOS now durably answers "what did we actually talk about" across restarts, with lexical search over the transcript — and nothing that could be mistaken for a memory system.
