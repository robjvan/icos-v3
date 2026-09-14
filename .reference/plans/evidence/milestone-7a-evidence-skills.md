# Milestone 7a Evidence — Filesystem Skill Catalog

## 1. Title + Date + App

- **Milestone:** M7a — Skill storage, validation, loading, and registry
  (plan: `.reference/plans/milestone-7-skills.md`)
- **Date:** 2026-09-13
- **App:** `core/` (NestJS), served same-origin test client at `/`
- **Launch:** `node dist/main` (fresh `npm run build`), port `3100`
- **LLM config:** `LLM_MODEL=m7a-dummy-no-server` (explicit override).
  `LLM_BASE_URL` / `LLM_API_KEY` came from the local `.env` (OpenRouter
  endpoint + key) — this was load-bearing for observation 12, see §5 and §8.
- **DBs (isolated):** `SESSION_DB_PATH=/tmp/icos-m7a/sessions.sqlite`,
  `MEMORY_DB_PATH=/tmp/icos-m7a/memories.sqlite`,
  `CORE_DB_PATH=/tmp/icos-m7a/legacy-missing.sqlite` (missing on purpose —
  first boot without the override migrated the repo legacy DB into the
  isolated sessions file, so the run was restarted pristine; see §8).
- **Skills dir (isolated):** `SKILLS_DIR_PATH=/tmp/icos-m7a/skills`
  (starts empty; fixtures added mid-run before `/skills refresh`).

## 2. Commands

Boot (empty catalog):

```bash
PORT=3100 LLM_MODEL=m7a-dummy-no-server \
  SESSION_DB_PATH=/tmp/icos-m7a/sessions.sqlite \
  MEMORY_DB_PATH=/tmp/icos-m7a/memories.sqlite \
  CORE_DB_PATH=/tmp/icos-m7a/legacy-missing.sqlite \
  SKILLS_DIR_PATH=/tmp/icos-m7a/skills \
  node dist/main
```

Fixtures (added live, then picked up by explicit refresh — no watcher):

```bash
mkdir -p /tmp/icos-m7a/skills/demo /tmp/icos-m7a/skills/bad-dir
printf -- '---\nname: demo\ndescription: Demo skill for M7a evidence.\nversion: 0.1.0\n---\n\n# Demo\n\nDo demo things. Do not invent events.\n' \
  > /tmp/icos-m7a/skills/demo/SKILL.md
printf -- '---\nname: wrong-name\ndescription: Mismatched.\n---\n\nBody.\n' \
  > /tmp/icos-m7a/skills/bad-dir/SKILL.md
```

Probes (all against `localhost:3100`):

```bash
curl -s localhost:3100/core/skills
curl -s -X POST localhost:3100/core/conversation \
  -H 'Content-Type: application/json' -d '{"message":"/skills"}'
curl -s -X POST localhost:3100/core/conversation \
  -H 'Content-Type: application/json' -d '{"message":"/skills refresh"}'
curl -s -X POST localhost:3100/core/conversation \
  -H 'Content-Type: application/json' -d '{"message":"/skills show demo"}'
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST localhost:3100/core/conversation \
  -H 'Content-Type: application/json' -d '{"message":"/skills show nope"}'
curl -s localhost:3100/core/skills/demo
curl -s localhost:3100/core/sessions
curl -s "localhost:3100/core/memory-candidates"
curl -s -X POST localhost:3100/core/conversation/stream \
  -H 'Content-Type: application/json' -d '{"message":"/skills"}'
curl -s -X POST localhost:3100/core/conversation \
  -H 'Content-Type: application/json' -d '{"message":"hello, is anyone there?"}'
```

Disabled-mode boot (same env plus `SKILLS_ENABLED=false`), then
`POST /core/conversation {"message":"/skills"}` and `GET /core/skills`.

## 3. Live observations (verbatim)

Boot maps the new routes; scan of the empty dir logs nothing (no skips):

```text
[RoutesResolver] SkillsController {/core/skills}:
[RouterExplorer] Mapped {/core/skills, GET} route
[RouterExplorer] Mapped {/core/skills/:name, GET} route
```

`GET /core/skills` (empty dir):

```json
{"enabled":true,"skills":[],"skipped":[]}
```

`POST /core/conversation {"message":"/skills"}` (empty dir):

```json
{"sessionId":"","reply":"Skills: none (empty catalog).","model":"core","command":{"kind":"data","data":{"enabled":true,"skills":[],"skipped":[]}}}
```

`POST /core/conversation {"message":"/skills refresh"}` (after fixtures):

```json
{"sessionId":"","reply":"Skills refreshed: scanned 2, loaded 1, skipped 1.\n- bad-dir (name-mismatch)","model":"core","command":{"kind":"data","data":{"dir":"/tmp/icos-m7a/skills","scanned":2,"loaded":1,"skipped":[{"name":"bad-dir","reason":"name-mismatch"}]}}}
```

Boot log records the same skip server-side (warn, no crash):

```text
[SkillService] Skills refresh skipped 1: bad-dir (name-mismatch)
```

`POST /core/conversation {"message":"/skills"}` (populated):

```json
{"sessionId":"","reply":"Skills (1):\n- demo v0.1.0 — Demo skill for M7a evidence.\nSkipped (1):\n- bad-dir (name-mismatch)","model":"core","command":{"kind":"data","data":{"enabled":true,"skills":[{"name":"demo","description":"Demo skill for M7a evidence.","version":"0.1.0"}],"skipped":[{"name":"bad-dir","reason":"name-mismatch"}]}}}
```

`POST /core/conversation {"message":"/skills show demo"}`:

```json
{"sessionId":"","reply":"# demo v0.1.0\nDemo skill for M7a evidence.\n\n# Demo\n\nDo demo things. Do not invent events.","model":"core","command":{"kind":"data","data":{"name":"demo","description":"Demo skill for M7a evidence.","version":"0.1.0","body":"# Demo\n\nDo demo things. Do not invent events."}}}
```

`POST /core/conversation {"message":"/skills show nope"}` → `HTTP 404`:

```json
{"message":"Unknown skill \"nope\"","error":"Not Found","statusCode":404}
```

`POST /core/conversation {"message":"/skills show"}` → `HTTP 400`:

```json
{"message":"Usage: /skills show <name>","error":"Bad Request","statusCode":400}
```

`GET /core/skills/demo`:

```json
{"name":"demo","description":"Demo skill for M7a evidence.","version":"0.1.0","body":"# Demo\n\nDo demo things. Do not invent events."}
```

`GET /core/skills/nope` → `HTTP 404`:

```json
{"message":"Unknown skill \"nope\"","error":"Not Found","statusCode":404}
```

Transcript and evidence ledger after all command traffic:

```json
{"sessions":[]}
{"candidates":[]}
```

Stream ride for `/skills` (no `token` events, no `meta` without a session):

```text
event: done
data: {"type":"done","reply":"Skills (1):\n- demo v0.1.0 — Demo skill for M7a evidence.\nSkipped (1):\n- bad-dir (name-mismatch)","model":"core","command":{"kind":"data","data":{"enabled":true,"skills":[{"name":"demo","description":"Demo skill for M7a evidence.","version":"0.1.0"}],"skipped":[{"name":"bad-dir","reason":"name-mismatch"}]}}}
```

Disabled-mode boot (`SKILLS_ENABLED=false`):

```json
{"sessionId":"","reply":"Skills are disabled (SKILLS_ENABLED=false). Conversation works without skills.","model":"core","command":{"kind":"message","data":{"enabled":false}}}
```

```json
{"enabled":false,"skills":[],"skipped":[]}
```

## 4. Design decisions

- **Two-phase loader, fail-closed scan.** `scanSkillDir()` reads each
  `SKILL.md` once for full validation (frontmatter + body) but retains
  descriptors only; bodies are re-read on explicit `loadBody()` with a
  per-scan-generation cache. A skill invalid in any way is skipped at scan
  time, so discovery (M7b) can never see it.
- **Hand-rolled frontmatter parser, not `js-yaml`.** Three known keys fit in
  ~40 lines; unknown keys (`exec`, `tools`, …) are rejected rather than
  ignored. Recorded here per the plan's open question 3.
- **In-memory registry, no SQLite table.** Skills are content-addressed by
  the filesystem; the transcript stays the only record of what happened.
- **Disabled-as-empty.** `SKILLS_ENABLED=false` clears registry + cache and
  serves the same shapes with `enabled: false`; conversation is untouched.
- **M7b/M7c subcommands stubbed, not absent.** `/skills use|drop|active`
  and `/skills pull|suggest` return deterministic "not yet available"
  messages (kind `message`) so the catalog surface is complete early.
- **`/skills refresh` is the cache-invalidation story.** No file watcher
  (reliability liability); refresh rebuilds descriptors and drops the body
  cache.
- **Command registration follows the M6a adapter pattern**
  (`registerSkillCommands` alongside session/runtime adapters); the
  dispatcher owns no skill logic.

## 5. Negative proofs

- **Commands never touch the LLM.** Every `/skills*` reply above carries
  `"model":"core"` and `"sessionId":""` with no LLM server reachable under
  the configured model — the run's model id (`m7a-dummy-no-server`) exists
  nowhere. Contrast: ordinary conversation in the same boot failed at the
  provider boundary (below), proving the two paths diverge exactly where
  M6 requires.
- **Conversation still needs the provider (contrast proof).**
  `POST /core/conversation {"message":"hello, is anyone there?"}` →
  `HTTP 502` with a provider-tagged error and no secret material (key
  values and `Authorization` absent; provider user id redacted here):
  `"[openrouter] LLM endpoint returned 400: {"error":{"message":"m7a-dummy-no-server is not a valid model ID","code":400},"user_id":"user_<redacted>"}"`.
  The 400→502 mapping is the standing M5 semantic, unchanged.
- **Commands write no transcript.** `GET /core/sessions` → `{"sessions":[]}`
  after seven command turns (the 502 conversation turn also persists
  nothing — history is appended on clean completion only, M2 invariant).
- **Commands trigger no extraction.** `GET /core/memory-candidates` →
  `{"candidates":[]}` after all command traffic.
- **Unknown/missing inputs fail deterministically.** Unknown skill → 404
  on both the command path and the inspection path; missing `show` arg and
  unknown subcommand → 400; nothing reaches the LLM in any failure case.
- **Stream parity.** `/skills` over `/core/conversation/stream` emits a
  single `done` event (no `token` events, no LLM contact). No `meta` event
  appears when there is no active session — the pre-existing M6 command
  behavior for sessionless commands, unchanged.
- **Provider neutrality.** `ConversationService`, `SessionStore`,
  `MemoryCandidateExtractor`, and streaming contain zero skill-format
  branches — new code only produces `ChatMessage`-neutral registry reads
  and `CommandResult` payloads.

## 6. Automated coverage

- `tsc --noEmit`: clean.
- `eslint "src/**/*.ts" "test/**/*.ts"`: clean (one `--fix` pass for
  prettier formatting only; no logic changes).
- Unit: **214 passed / 23 suites** (43 new M7a: `skill-loader.spec` 22 —
  11-case validation matrix plus scan/symlink/load tests;
  `skill.service.spec` 6; `skill-commands.spec` 9; `skills.controller.spec`
  4; `config.spec` +2). `config.spec` also pins all seven `SKILLS_*`
  defaults and override parsing.
- E2E: **28 passed** (3 new: empty-catalog inspection, LLM-free `/skills`
  with transcript/extraction emptiness asserts, filesystem
  refresh→show→inspect round-trip with 404).
- Regression: all prior milestone suites green, unchanged (M1 conversation,
  M2 streaming incl. command-stream shape, M3 sessions/FTS, M4 extraction
  isolation, M5 provider mapping incl. the live 502 above, M6a/b/c
  command/approval/clarification lifecycles).

## 7. Verdict

**Pass** for the M7a slice gates: `SKILL.md` format fixed and enforced;
loader scans `SKILLS_DIR_PATH` with machine-readable skip reasons;
registry lists deterministically with empty-catalog validity; `SKILLS_*`
config + `.env.sample` documented with byte-identical disabled mode;
`/skills`, `/skills show`, `/skills refresh` deterministic and LLM-free;
read-only inspection endpoints mirror the candidates pattern; M7a tests
green. Nothing in this slice executes tools, activates skills into
context, or touches memory — those are M7b/M7c.

## 8. Follow-ups / remaining testing / deferred work

- [ ] M7b: `discoverSkills()` + `/skills suggest` (stubs return "not yet
  available").
- [ ] M7c: explicit activation (`use`/`drop`/`active`), one-shot retrieval
  (`pull`), turn-scoped injection, `/context` token split, four seed
  fixtures under `docs/skills/`.
- [ ] Honesty artifact: the first live boot migrated the repo legacy DB
  (`./data/core.sqlite`) into the isolated sessions file because
  `CORE_DB_PATH` was unset; the run was discarded and rebooted pristine
  with `CORE_DB_PATH` pointed at a missing file (migration count 0,
  `sessions: []`). Future evidence runs must keep the override.
- [ ] Honesty artifact: observation 12 reached the real OpenRouter endpoint
  (base URL + key from local `.env`; only the model id was overridden),
  returning 400→502 with zero generation cost. No secret material appears
  in any payload or in this file (provider user id redacted above).
- [ ] Honesty artifact: the loader's `duplicate` skip branch is
  defense-in-depth only — it is unreachable via the filesystem on this
  slice (a second directory can never yield an equal valid name; mismatch
  fires first), so it has no dedicated test. Revisit if a future
  plugin-provided merge path makes it reachable.
- [ ] Provisional caps (`SKILLS_MAX_AUTO_LOADED_PER_TURN=2`,
  `SKILLS_MAX_CONTEXT_CHARS=8000`) are unexercised until M7c live turns;
  adjust only with measured evidence.
