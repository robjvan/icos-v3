# Milestone 7c Evidence — On-Demand Loading + Context Injection

## 1. Title + Date + App

- **Milestone:** M7c — On-demand loading + injection, three scopes,
  observability (plan: `.reference/plans/milestone-7-skills.md`, rev.3;
  closes M7)
- **Date:** 2026-09-13
- **App:** `core/` (NestJS), port `3100` (main run) + `3101`
  (budget drill)
- **LLM config:** stock local `.env` — OpenRouter,
  `deepseek/deepseek-v4-flash-0731`. Only `PORT`, `SESSION/MEMORY_DB_PATH`,
  `CORE_DB_PATH`, `SKILLS_*` overridden. A handful of short flash turns;
  M5-precedented model.
- **DBs (isolated):** `/tmp/icos-m7c/sessions.sqlite`,
  `/tmp/icos-m7c/memories.sqlite`,
  `CORE_DB_PATH=/tmp/icos-m7c/legacy-missing.sqlite` (missing on purpose —
  migration count 0, pristine session list)
- **Skills dir (isolated):** `/tmp/icos-m7c/skills` ← verbatim copies of
  the five `docs/skills/*/SKILL.md` seed fixtures

## 2. Commands

```bash
npm run build
mkdir -p /tmp/icos-m7c/skills
cp -r docs/skills/icos-v3-stack docs/skills/persona-anchor \
  docs/skills/daily-journal docs/skills/comments-pass \
  docs/skills/capture-idea /tmp/icos-m7c/skills/
PORT=3100 SESSION_DB_PATH=/tmp/icos-m7c/sessions.sqlite \
  MEMORY_DB_PATH=/tmp/icos-m7c/memories.sqlite \
  CORE_DB_PATH=/tmp/icos-m7c/legacy-missing.sqlite \
  SKILLS_DIR_PATH=/tmp/icos-m7c/skills node dist/main
```

Turns (all `POST /core/conversation`, session pinned from turn 1):

1. `"Today we are working on the ICOS v3 stack. Can core import epistemic-memory directly? Answer yes or no first, then at most ten more words."`
2. `"What is the current architecture? Twenty words or fewer."`
3. `"Sourdough starter ratios. Reply BREAD, nothing else."`
4. `/skills use daily-journal`, then the bread message again
5. `/status`, `/skills drop daily-journal`, `/skills pull persona-anchor`,
   bread message, bread message again, `/skills active`
6. `GET /core/skills/active?sessionId=…`, `GET /core/conversation/:id`,
   `GET /core/sessions/search?q=demo`
7. Malformed drill: add `bad-dir/`, `/skills refresh`

Budget drill (second boot, `SKILLS_MAX_AUTO_LOADED_PER_TURN=1`, port 3101):

8. `"We are working on the ICOS v3 stack today."` +
   `GET /core/skills/active?sessionId=…`

## 3. Live observations (verbatim, abridged to the load-bearing parts)

`/skills` lists all five seeds:

```text
Skills (5):
- capture-idea v0.1.0 — Capture an idea in the knowledge base.
- comments-pass v0.1.0 — Swagger and JSDoc comment pass over a file or codebase.
- daily-journal v0.1.0 — Capture the day's events as a structured journal entry.
- icos-v3-stack v0.1.0 — Architecture and conventions of the ICOS v3 stack.
- persona-anchor v0.1.0 — Persona anchor — identity and interaction ground rules for Isabel.
```

Turn 1 — discovery with a decisive reply proof. The reply's second
sentence is verbatim skill-body knowledge ("Apps never import one
another" appears in `icos-v3-stack/SKILL.md` and nowhere in prior
history — the session started with this turn):

```json
{"reply":"No. Apps never import one another; all LLM access goes through the OpenAI-compatible interface.","model":"deepseek/deepseek-v4-flash-0731"}
```

`/skills active` after turn 1:

```text
explicit (pinned): none
requested (staged for next turn): none
last turn: explicit [] + requested [] + contextual [icos-v3-stack, persona-anchor]
```

Full turn report (`lastTurn`): contextual `[icos-v3-stack,
persona-anchor]`, `considered` all five catalog entries ranked
(icos-v3-stack 8 via description+name; persona-anchor 4 via name —
`on` + `or` substring hits; capture-idea 2; comments-pass 1;
daily-journal 1), `chars.contextual` 1024. Selector admitted the top 2
(auto cap 2).

Turn 2 — continued relevance. The app names `epistemic-memory` and
`model-sentinel` appear nowhere in history before this turn (the user
never said them; turn 1's reply did not list them), so this reply is only
answerable from injected skill context:

```text
"Three isolated apps: core, epistemic-memory, model-sentinel; LLM access only via OpenAI-compatible interface."
```

Turn 3 — bread. Reply `BREAD`, and the report shows zero retention:

```text
last turn: explicit [] + requested [] + contextual []
```

Nothing lingers merely because it was previously relevant.

Turn 4 — explicit pin overrides irrelevance (`/skills use
daily-journal`, then the zero-match bread message). Reply `BREAD`, and
`/status` reports:

```text
Skills: enabled, catalog 5
...
Skills pinned: daily-journal
Last turn skills: explicit 257 + requested 0 + contextual 0 chars
  (daily-journal)
```

Turn 5 — one-shot (`/skills drop daily-journal`, `/skills pull
persona-anchor`, bread message). Reply `BREAD`; the inspection endpoint:

```json
{"explicit":[],"requested":[],"contextual":[],"lastTurn":{"explicit":[],"contextual":[],"requested":["persona-anchor"],"considered":[],"chars":{"explicit":0,"requested":424,"contextual":0}}}
```

Injected once (424 chars, `turn-explicit`), never pinned. The following
bread turn reports `explicit [] + requested [] + contextual []` with no
staged remainder.

Isolation — transcript holds 12 conversation messages with zero skill
scaffolding (`<skill` and `<available_skills>` both absent from
`GET /core/conversation/:id`); `GET /core/sessions/search?q=demo` →
`{"results":[]}` (skill vocabulary not in the FTS index).

Malformed drill — `bad-dir/` (missing description) added live:

```text
Skills refreshed: scanned 6, loaded 5, skipped 1.
- bad-dir (missing-description)
```

Budget drill (`SKILLS_MAX_AUTO_LOADED_PER_TURN=1`): the model answered
with stack context and even surfaced the control path unprompted
("happy to pull up the stack conventions with `/skills use
icos-v3-stack`" — it saw the name in the catalog block). Report:
contextual `[icos-v3-stack]`, `considered` four ranked hopefuls
(8 / 2 / 1 / 1) — the cap admitted exactly one and reported the rest.

## 4. Design decisions

- **Delimiter scope is `turn-explicit`, not `requested`.** The plan's
  revision mandates the literal `scope="turn-explicit"`; `SkillScope`
  follows it (`explicit | turn-explicit | contextual`) while report and
  API fields keep the `requested` name.
- **Staging is a single-turn promise.** Pending one-shots are consumed by
  the next `resolveTurnSkills` unconditionally — admitted or
  budget-dropped — never queued.
- **Budget priority is explicit → requested → contextual.**
  `pull` fails fast when the body cannot fit alongside current pins;
  contextual fills the remainder, skipping overflow for smaller
  candidates rather than failing the turn.
- **Per-skill failures prune, never 500.** A rotted file drops that skill
  for the turn (and evicts stale pins); the conversation continues.
- **Selector stays count-only; injection enforces chars.** Descriptors
  carry no body content by design, so `maxChars` gates at load time.
- **Fork copies pins; nothing else.** Pending and last-turn state are
  turn-scoped by definition. `/new` starts empty by construction (new id);
  `/undo` is transcript surgery and ignores skill state.
- **Reports record on clean completion only**, mirroring M2 history
  semantics; disabled mode records nothing at all.

## 5. Negative proofs

- **Bread non-retention (live).** After two skill-grounded turns, an
  unrelated turn injects nothing and the report shows all scopes empty —
  the plan's key behavioral demonstration, verbatim above.
- **One-shot transience (live).** `requested: [persona-anchor]` exactly
  once, then `[]` with `pending: []` — never promoted to pinned.
- **Failed turns record nothing** (unit: rejected `chat` ⇒ no report, no
  stored messages).
- **Transcript/FTS/extractor isolation (live + unit + e2e).** 12 stored
  messages contain no skill text; FTS search for skill vocabulary is
  empty; the extractor mock never receives skill scaffolding ( streamed
  and non-streamed paths send identical arrays — asserted by diffing
  mock args).
- **LLM text cannot stage or pin** — no code path exists from model output
  to `useSkill`/`stageOneShot` (command/runtime-only mutation, M6b-style
  invariant; asserted structurally in review, behaviorally by the bread
  turns never altering pin state).
- **Deterministic errors preserved:** unknown skill → 404, over-cap pin
  and over-budget pull → 400, sessionless scoping commands → 400.
- **Provider neutrality:** injection produces `ChatMessage[]` only — zero
  provider branches in new code; live single-provider replies plus
  unit-level stream/chat parity stand in for the M5-style swap (full
  multi-provider swap remains the M5-open item, unchanged by M7).

## 6. Automated coverage

- `tsc --noEmit`: clean. `eslint "src/**/*.ts" "test/**/*.ts"`: clean.
- Unit: **263 passed / 25 suites** (32 new M7c: `context.builder.spec`
  +3 — catalog block, three-tier order/scopes, alphabetical explicit;
  `skill.service.spec` +8 — pin round-trip, cap, one-shot consume-once,
  pull budget fail-fast, tier ordering with discovery exclusion, both
  budgets, fork copy, catalog caps/overflow; `skill-commands.spec` +7 net
  — session requirement, use/drop/active, cap, pull stage + budget,
  fork, undo, status lines; `skills.controller.spec` +1 — active scopes;
  `skill-loader.spec` +6 — five seed fixtures parse clean + real-seed
  discovery anchor; `conversation-skills.spec` +7 — catalog+explicit
  injection, contextual auto-load, bread non-retention, one-shot
  transience, stream/chat parity, transcript+extractor isolation, failure
  and disabled behavior).
- E2E: **30 passed** (+1 M7c full-scope flow: pin → explicit scope,
  pull → turn-explicit → gone, auto-discovery → contextual, transcript
  free of scaffolding).
- Regression: M7a/M7b and all prior milestone suites green, unchanged.

## 7. Verdict

**Pass** for every M7c slice gate and, with it, the full M7 definition of
done (12/12): discovery from `~/.icos/skills/` analogues, metadata
inspection, explicit activate/deactivate, deterministic discovery,
on-demand loading, memory-free injection, three labeled scopes,
observability (`/skills active`, `/status` split, last-turn report,
read-only endpoints), enforced count/char limits, tool-free
non-autonomy, and named one-shot retrieval without pinning. M7 —
*Can it acquire capabilities?* — is complete: skills live on disk,
discovery finds them, loading reads them, activation scopes them, and
context makes them available to the model. Memory was not involved at any
point.

## 8. Follow-ups / remaining testing / deferred work

- [ ] M8: tool calling — skills may then name tools; the `scope`
  delimiters already distinguish procedure text from principal
  instructions for that future.
- [ ] Baseline noise stands: two-char tokens (`on`, `the`, `or`) and
  name-substring accidents (`on`, `or` ⊂ `persona-anchor`) contribute
  points (observed live: persona-anchor rode along at score 4; a lone-`the`
  trailing match is routine). Accepted for the deterministic baseline;
  revisit weights only with measured pain, else M11 semantic retrieval.
- [ ] `SKILLS_MAX_CONTEXT_CHARS` was drilled at unit level only (tight
  budget ⇒ contextual `[]`, report intact); no live turn has yet hit the
  char gate. The count gate (`MAX_AUTO_LOADED_PER_TURN=1`) is live-proven.
- [ ] Catalog-block size (50 summaries) unmeasured against small-context
  local models — open question 1 carries over; lower only with evidence.
- [ ] Carried artifacts unchanged: unreachable `duplicate` branch (M7a),
  stale-`dist` probe incident + reaped background server (M7b),
  `.env`-supplied provider base with full-URL quirk (M5/M7a).
- [ ] `status.md` still lists M7 as planned — left for the owner's
  status pass; this file is the completion record.
