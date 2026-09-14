# Milestone 6a — Slash Commands Evidence

Date: 2026-09-11
Scope: deterministic command layer only (M6b approvals + M6c clarifications deferred).

## Design decisions (user-confirmed)

- Ingress: auto-detect in `POST /core/conversation` and `/stream`. Leading-`/` input routes to the dispatcher before any LLM processing; a command can never reach the LLM.
- UI: repo has no dedicated client; `apps/core/test-client.html` (served at `/`) renders command results. All results are structured (`kind`/`text`/`data`) for future Web/Desktop clients.
- `/rename`: new nullable `sessions.title` column + idempotent migration. Title preferred over computed preview in listings.
- `/undo`: reversible `messages.excluded_from_context` flag. Transcript never loses rows; context queries filter; history flags.
- `/thinking`: M6a display-visibility toggle only. Becomes the `/variant` alias when model reasoning control lands (per notes).
- Display prefs (`/thinking`, `/timestamps`) are ephemeral in-memory per-session state. Stored timestamps untouched.
- Commands never auto-create sessions: unknown ids → 404, no side effects.
- `/restart-runtime` reports unavailable (no supervisor); never wired to LLM invocation.
- `/health` does no network probing: LLM row reports `configured` + `reachability unknown` rather than claiming health from config alone.

## Verification

- Unit: 139 passed (43 new: parser, registry, 10 commands, service short-circuit, repo methods, column migration).
- E2E: 19 passed (6 new: no-LLM/no-transcript/no-extraction proof, 404/400 paths, streamed command shape, rename→listing, undo context-vs-history split with exact LLM payload assertion).
- `tsc` clean, `eslint` clean.
- Live (OpenRouter, real backend): chat turn → `/rename` → `/status` (fields verified) → `/undo` (history 4 rows / 2 flagged, context narrowed) → `/fork` (copy, source intact) → `/export` (Markdown, no secrets) → streamed `/health` (`done`, zero `token` events). Unknown `/nope` → 404.
- `/health` host section live on macOS (dev): OS via `sw_vers`, arch, uptime, 2-sample CPU %, load avg, memory via `vm_stat` active+wired+compressed (Activity-Monitor semantics — `os.freemem()` reads ~98% on idle Macs), disk via `/System/Volumes/Data` (`/` is a snapshot volume), GPU `n/a` without `nvidia-smi`. Linux path: `/etc/os-release`, `df /`, `nvidia-smi` single-query for name/memory/temp. Every probe guarded → `n/a`, never a failed `/health`.
- Regression: M1–M5 suites green; commands create no memory candidates; no fake assistant messages; provider switching untouched.

## Deferred / future-client work

- Test client does not render timestamps yet (history payload now includes `createdAt` for future clients).
- `/redo` (clear exclusion flags) noted as the reversibility counterpart; not implemented.
- M6b (approvals) + M6c (clarifications): persistence decision already taken (SQLite tables in sessions DB); implementation pending.
