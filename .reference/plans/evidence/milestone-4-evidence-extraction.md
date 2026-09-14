# Milestone 4 — Extraction Evidence (split roles, live battery)

Date: 2026-09-10
App: `core/` (NestJS, port 3100, isolated DB at `/tmp/icos-m4data2/core.sqlite`)
Conversation model: Ollama `gemma4-e4b-unc:latest` (`LLM_*`)
Extraction model: Ollama `violet:latest` (`MEMORY_LLM_*`) — different model, same provider here; config boundary supports fully separate providers.

Battery: 8 turns in one session (greeting, decision, preference+project, person/event, goal, temporary state, contradiction, chatter).

## Candidates extracted (17)

`msgN` = user-message id the candidate is stamped with:

- msg3 [preference] assistant → recommends → SQLite (0.96/0.62/0.92)
- msg3 [fact] SQLite → selected_for_core_sessions → database_system (1/0.85/0.95)
- msg5 [fact] Prisma Client → recommended_for → ICOS v3 TypeScript project (1/0.85/0.92)
- msg5 [preference] user → chooses → TypeScript (0.94/0.72/0.88)
- msg5 [fact] SQLite → suitable_for → ICOS Core Sessions (1/0.95/0.97)
- msg9 [decision] user → chose → SQLite for Core sessions (1/0.76/0.89)
- msg9 [goal] user → aiming_to_ship → milestone 4 (0.98/0.81/0.91)
- msg11 [work] user → debugging → broken_build (0.92/0.73/0.81)
- msg11 [project] ICOS_v3 → being_built_with → TypeScript_and_Sqlite (0.99/0.87/0.93)
- msg11 [person] sister:Ada → visiting → next_week (0.97/0.61/0.79)
- msg11 [preference] user → prefers → hiking_with_sister (0.96/0.64/0.82)
- msg11 [goal] user → aiming_for → shipping_milestone_4 (0.98/0.95/0.85)
- msg15 [fact] ICOS → uses_currently → SQLite as database (1/0.79/0.92)
- msg15 [observation] debugging process → common_causes_of_errors → typing mismatch, asynchronous issues, schema drift (0.81/0.73/0.85)
- msg15 [preference] user → wants_to_escalate → Milestone 4 implementation (0.92/0.88/0.89)
- msg15 [project] ICOS v3 → will_use → PostgreSQL as database (1/0.98/0.95)
- msg15 [preference] user → prefers → PostgreSQL (0.95/0.85/0.92)

(scores are confidence/importance/stability; all via `violet:latest`, version `memory-extraction-v1`)

## Observations

1. **Pipeline works end to end.** Every completed turn produced structured, validated, persisted candidates with session + message provenance, queryable at `GET /core/memory-candidates`.
2. **Greeting → zero candidates** (msg1). Chatter alone extracts nothing — when the turn itself is empty, at least.
3. **Contradiction preserved, not resolved.** Both `user → prefers → TypeScript/SQLite` and `user → prefers → PostgreSQL` sit side by side in the ledger. Correct per plan: resolution is future epistemic work.
4. **Context re-mining (main finding).** The extractor sees the turn *plus bounded context*, so it re-mines older facts and stamps them with the *current* turn's message id: the SQLite decision (turn 2) reappears under msg9; Ada (turn 4) under msg11; the PostgreSQL switch (turn 7) was mined by turn 8's extraction and stamped msg15. Provenance therefore means "the turn that surfaced this," not "the turn that first said this." Message-level attribution (which span produced the claim) is future work; the raw material to do it is all in the ledger.
5. **Cross-turn duplicates are stored, not merged** (goal under msg9 *and* msg11). Also by design — future reinforcement counting will want exactly these.
6. **Assistant content is mined too** (`assistant → recommends → SQLite`, Prisma recommendation). Reasonable: "facts established during the conversation" are in scope.
7. **Scores are generous.** Violet hands out confidence 1.0 freely. Calibration (or score skepticism downstream) is future work; raw values are preserved.
8. **Latency under single-GPU contention is real.** With conversation (gemma) and extraction (violet) sharing one Ollama GPU, two turns hit the 60s LLM timeout (504, clean error, nothing persisted, conversation structurally unaffected). This is the strongest practical argument for the addendum's local-small-model guidance *plus* a timeout/queue policy later — and a live demo that extraction failure never breaks conversation.

## Automated coverage

- `tsc` clean, `eslint` clean.
- 77 unit tests (validation rules incl. ranges/enums/dedupe, prompt shape + context window, extractor parsing incl. chatty/garbage input, repository save/list/persistence, service provenance + failure isolation + disabled flag).
- 13 e2e tests (all prior milestones unchanged, plus candidate inspection and extractor-failure isolation).

## Verdict

Pass against the §21 definition of done: conversation → persistence → LLM extraction → structured candidates → deterministic validation → independent persistence → exact (turn-level) provenance → inspection endpoint → failure isolation → no RuVector. ICOS can now answer "what potentially durable information did I notice" — and shows its work, warts included.

---
