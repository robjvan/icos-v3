# M3/M4 Cleanup — Database Split Evidence

Date: 2026-09-10
Change: one shared `core.sqlite` → `~/.icos/data/sessions.db` (transcript) + `~/.icos/data/memories.db` (candidate ledger).

## Why

The candidate table carried foreign keys into the transcript tables, but SQLite cannot enforce cross-database references — the constraint was a lie waiting to break. Provenance is now plain columns + insertion order, documented as convention in the schema.

## Migration

One-time, row-level (not file-level) copy preserving ids, so provenance survives: sessions/messages (+FTS via triggers) → sessions.db; memory_candidates → memories.db. The legacy file is never modified. Best-effort per file with logged warnings; targets that already exist are left alone.

Live run against the real dev database (`./data/core.sqlite`: 2 sessions, 8 messages, 4 candidates):

- `Migrated legacy transcript database to /Users/rob/.icos/data/sessions.db` logged at boot.
- sessions.db: 2 sessions, 8 messages, FTS match works; no `memory_candidates` table.
- memories.db: 4 candidates with provenance intact; no transcript tables.
- Legacy file untouched (backup at `/tmp/icos-data-backup` regardless).
- Post-migration: session list, history, candidates, FTS search, and a fresh turn all verified live; new session landed in sessions.db (3 sessions total).

## Debugging footnote

The first live attempt silently skipped migration: `CORE_DB_PATH` in `.env` pointed at a nonexistent `~/.icos/data/core.sqlite`, so the (correct) resolution found no legacy file. Two fixes resulted: migration errors are now logged as warnings instead of swallowed, and the legacy-table probe explicitly queries `legacy.sqlite_master` rather than relying on the attached main schema.

## Automated coverage

- `tsc` clean, `eslint` clean.
- 82 unit tests (split schemas, migration copy/id-preservation/skip semantics, per-file repository wiring).
- 13 e2e tests unchanged in count, all green against split temp files.
