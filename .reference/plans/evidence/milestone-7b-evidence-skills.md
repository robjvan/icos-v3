# Milestone 7b Evidence — Skill Discovery

## 1. Title + Date + App

- **Milestone:** M7b — Skill discovery (plan:
  `.reference/plans/milestone-7-skills.md`, rev.3)
- **Date:** 2026-09-13
- **App:** `core/` (NestJS), port `3100`
- **LLM config:** `LLM_MODEL=m7b-no-server` (no LLM server exists;
  discovery is pure ranking and needs none)
- **DBs (isolated):** `SESSION_DB_PATH=/tmp/icos-m7b/sessions.sqlite`,
  `MEMORY_DB_PATH=/tmp/icos-m7b/memories.sqlite`,
  `CORE_DB_PATH=/tmp/icos-m7b/legacy-missing.sqlite` (missing on purpose —
  no legacy migration; migration count 0)
- **Skills dir (isolated):** `SKILLS_DIR_PATH=/tmp/icos-m7b/skills` with
  three fixtures: `icos-v3-stack/` (valid),
  `daily-journal/` (valid), `bad-dir/` (name-mismatch decoy for the
  exclusion proof)

## 2. Commands

Rebuild from the M7b tree, then boot (fixtures pre-seeded, so the boot
scan itself is observed):

```bash
npm run build
mkdir -p /tmp/icos-m7b/skills/icos-v3-stack /tmp/icos-m7b/skills/daily-journal /tmp/icos-m7b/skills/bad-dir
printf -- '---\nname: icos-v3-stack\ndescription: Architecture and conventions of the ICOS v3 stack.\nversion: 0.1.0\n---\n\n# ICOS v3 Stack\n\nDistinguish the correct v3 service before changes begin.\n' \
  > /tmp/icos-m7b/skills/icos-v3-stack/SKILL.md
printf -- '---\nname: daily-journal\ndescription: Capture the day as a structured journal entry.\n---\n\n# Daily Journal\n\nAsk one question at a time.\n' \
  > /tmp/icos-m7b/skills/daily-journal/SKILL.md
printf -- '---\nname: wrong-name\ndescription: Mismatched.\n---\n\nBody.\n' \
  > /tmp/icos-m7b/skills/bad-dir/SKILL.md
PORT=3100 LLM_MODEL=m7b-no-server \
  SESSION_DB_PATH=/tmp/icos-m7b/sessions.sqlite \
  MEMORY_DB_PATH=/tmp/icos-m7b/memories.sqlite \
  CORE_DB_PATH=/tmp/icos-m7b/legacy-missing.sqlite \
  SKILLS_DIR_PATH=/tmp/icos-m7b/skills \
  node dist/main
```

Probes:

```bash
curl -s -X POST localhost:3100/core/conversation \
  -H 'Content-Type: application/json' -d '{"message":"/skills refresh"}'
curl -s -X POST localhost:3100/core/conversation \
  -H 'Content-Type: application/json' -d '{"message":"/skills suggest working on the ICOS v3 stack"}'
curl -s -X POST localhost:3100/core/conversation \
  -H 'Content-Type: application/json' -d '{"message":"/skills suggest sourdough"}'
curl -s "localhost:3100/core/skills/discover?q=working%20on%20the%20ICOS%20v3%20stack"
curl -s "localhost:3100/core/skills/discover"
curl -s -X POST localhost:3100/core/conversation \
  -H 'Content-Type: application/json' -d '{"message":"/skills"}'
curl -s localhost:3100/core/sessions
curl -s "localhost:3100/core/memory-candidates"
```

Disabled-mode boot (same env plus `SKILLS_ENABLED=false`), then
`/skills suggest journal` and `GET /core/skills/discover?q=journal`.

## 3. Live observations (verbatim)

Boot maps the new route (static `discover` registered before `:name`)
and the boot-time scan skips the decoy without failing:

```text
[RouterExplorer] Mapped {/core/skills/discover, GET} route
[RouterExplorer] Mapped {/core/skills/:name, GET} route
[SkillService] Skills refresh skipped 1: bad-dir (name-mismatch)
```

`POST /core/conversation {"message":"/skills refresh"}`:

```json
{"sessionId":"","reply":"Skills refreshed: scanned 3, loaded 2, skipped 1.\n- bad-dir (name-mismatch)","model":"core","command":{"kind":"data","data":{"dir":"/tmp/icos-m7b/skills","scanned":3,"loaded":2,"skipped":[{"name":"bad-dir","reason":"name-mismatch"}]}}}
```

`POST /core/conversation {"message":"/skills suggest working on the ICOS v3 stack"}`:

```json
{"sessionId":"","reply":"Skills matching \"working on the ICOS v3 stack\":\n- icos-v3-stack (score 8, description+name) — Architecture and conventions of the ICOS v3 stack.\n- daily-journal (score 1, description) — Capture the day as a structured journal entry.","model":"core","command":{"kind":"data","data":{"query":"working on the ICOS v3 stack","matches":[{"name":"icos-v3-stack","score":8,"matchedOn":["description","name"]},{"name":"daily-journal","score":1,"matchedOn":["description"]}]}}}
```

Score-8 anatomy (tokens: working/on/the/icos/v3/stack): `working` scores
0 — it appears in neither the name nor the description, an honest
reminder that matching is substring-based, not semantic. `on` and `the`
hit the description (+1 each, via "conventions" / "the"); `icos`, `v3`,
`stack` hit the name (+2 each). Total 8. `daily-journal` trails at 1 via
a lone `the` description hit — baseline noise, accepted for M7b (see §8).

`POST /core/conversation {"message":"/skills suggest sourdough"}`:

```json
{"sessionId":"","reply":"No skills match \"sourdough\".","model":"core","command":{"kind":"data","data":{"query":"sourdough","matches":[]}}}
```

`GET /core/skills/discover?q=working%20on%20the%20ICOS%20v3%20stack`
(same engine, same ranking as `suggest`):

```json
{"query":"working on the ICOS v3 stack","matches":[{"name":"icos-v3-stack","score":8,"matchedOn":["description","name"]},{"name":"daily-journal","score":1,"matchedOn":["description"]}]}
```

`GET /core/skills/discover` (no `q`) → `HTTP 400`:

```json
{"message":"Usage: /core/skills/discover?q=<text>","error":"Bad Request","statusCode":400}
```

Purity — catalog identical after suggesting, transcript and ledger empty:

```json
{"sessionId":"","reply":"Skills (2):\n- daily-journal v0.0.0 — Capture the day as a structured journal entry.\n- icos-v3-stack v0.1.0 — Architecture and conventions of the ICOS v3 stack.\nSkipped (1):\n- bad-dir (name-mismatch)","model":"core","command":{"kind":"data","data":{"enabled":true,"skills":[{"name":"daily-journal","description":"Capture the day as a structured journal entry.","version":"0.0.0"},{"name":"icos-v3-stack","description":"Architecture and conventions of the ICOS v3 stack.","version":"0.1.0"}],"skipped":[{"name":"bad-dir","reason":"name-mismatch"}]}}}
```

```json
{"sessions":[]}
{"candidates":[]}
```

Disabled-mode boot (`SKILLS_ENABLED=false`):

```json
{"sessionId":"","reply":"Skills are disabled (SKILLS_ENABLED=false). Conversation works without skills.","model":"core","command":{"kind":"message","data":{"enabled":false}}}
```

```json
{"query":"journal","matches":[]}
```

## 4. Design decisions

- **Documented formula, not cleverness.** Name-substring +2, description
  substring +1 per distinct token; rank score-desc/name-asc; default limit
  5. The whole scorer is ~30 lines plus comments.
- **`MIN_TOKEN_CHARS = 2`.** Single letters would match nearly every
  description; two-char tokens (`on`, `v3`) stay live. Stopword-grade
  noise (`the` → +1) is accepted at this baseline — see §8.
- **Pure function + thin service wrapper.** `discoverSkills(descriptors,
  input, limit)` is importable and side-effect-free;
  `SkillService.discover()` supplies the registry and the disabled guard.
- **Selector seam now, wiring in M7c.** `SkillSelector` +
  deterministic top-N `TopBudgetedSelector` ship in M7b; the char budget
  (`maxChars`) is enforced downstream at injection time, where body sizes
  are known — descriptors carry no body content by design (stated in code).
- **`suggest` is the same engine, human-visible.** One code path serves
  the command and the inspection endpoint; neither activates nor injects.
- **Route order is load-bearing.** `GET discover` is declared before
  `GET :name` so the static segment wins; verified live (no `Unknown
  skill "discover"`).

## 5. Negative proofs

- **Discovery needs no LLM.** Every observation above carries
  `"model":"core"` with no LLM server in existence; ranking is string
  matching over descriptors.
- **Discovery mutates nothing.** Catalog output byte-identical before and
  after `suggest`; `sessions: []` and `candidates: []` after the full
  probe sequence — no transcript rows, no extraction, no activation, no
  body injection (injection does not exist yet; that is M7c).
- **Skipped skills are invisible to discovery.** `bad-dir` (present on
  disk, failing validation) appears in no match list; the decoy query
  class is covered at unit level (`service.discover('mismatch')` → `[]`).
- **No-match and blank inputs return empty, never everything**
  (`sourdough` → `[]` live; blank/whitespace/single-char → `[]` at unit
  level). Missing `q` → deterministic 400.
- **Disabled mode is total.** `suggest` reports disabled; `discover`
  returns empty matches; same byte-identical-conversation guarantee as M7a.
- **Provider neutrality holds.** Discovery consumes `SkillDescriptor[]`
  only; zero provider branches added (M5 grep-style invariant intact by
  construction — no LLM, no transport, no headers involved).

## 6. Automated coverage

- `tsc --noEmit`: clean.
- `eslint "src/**/*.ts" "test/**/*.ts"`: clean.
- Unit: **231 passed / 24 suites** (17 new M7b: `skill-discovery.spec`
  11 — tokenizer, anchor, ranking, multi-token scoring, tiebreak,
  determinism, emptiness, bounds, case; `skill.service.spec` +2 —
  ranked discovery, skip exclusion, purity, disabled; `skill-commands.spec`
  +2 — suggest ranking/purity, empty/blank; `skills.controller.spec` +2 —
  discover matches, blank rejection). The `icos-v3-stack` seed-anchor
  assertion from the plan is a unit test and passes.
- E2E: **29 passed** (+1: suggest/discover purity — ranked output,
  unchanged catalog, empty sessions, no LLM call).
- Regression: all M7a and prior milestone suites green, unchanged
  (command catalog, disabled mode, inspection shapes, streaming,
  persistence, extraction isolation, provider mapping).

## 7. Verdict

**Pass** for the M7b slice gates: `discoverSkills()` deterministic over
name+description with no embeddings; discovery pure (no state, no bodies,
no LLM); `SkillSelector` seam plus default top-N budgeted selector;
`/skills suggest` exposes the same engine and activates nothing; M7b
tests green. Context injection, activation, and one-shot retrieval remain
M7c.

## 8. Follow-ups / remaining testing / deferred work

- [ ] M7c: explicit activation (`use`/`drop`/`active`), one-shot retrieval
  (`pull`), three-tier injection with `scope` delimiters, last-turn
  report, `/context` token split, five seed fixtures under `docs/skills/`.
- [ ] Baseline noise: two-char common tokens (`on`, `the`) contribute
  description points (observed: lone-`the` score 1). Acceptable for the
  deterministic baseline; revisit ranking weights only with measured
  retrieval pain, or defer to M11 semantic retrieval.
- [ ] Honesty artifact: the first M7b live probe ran against a stale
  `dist/` (M7a build) and produced `Unknown skill "discover"` (404) plus
  an unrelated 500 — a harness artifact, not a code defect. Rebuilt from
  the M7b tree and re-captured everything above clean.
- [ ] Honesty artifact: one background server (first M7b boot) was found
  dead between probe calls with no error in its log; cause undetermined,
  treated as environmental (process-group reap). All observations above
  were re-captured in continuous live runs afterward.
- [ ] M7a artifacts carry over unchanged (provisional M7c caps,
  unreachable `duplicate` branch, `.env`-supplied provider base).
