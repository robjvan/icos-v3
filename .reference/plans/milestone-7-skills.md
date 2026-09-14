# Milestone 7 — Skills (Capability Acquisition)

## Status

Draft rev.3 (2026-09-13). Implements README question **M7 → *Can it acquire capabilities?***

Rev.2 correction: the original draft treated **explicit per-session
activation** (`/skills use <name>`) as the primary skill mechanism. That is
too restrictive. Skills are **on-demand procedural knowledge**, not
persistent memory — ICOS must be able to discover and load a relevant skill
when the current conversation makes it useful, without requiring the user to
activate it first. Explicit activation remains as a **control mechanism**
(session-pinned inclusion), not the fundamental architecture.

Rev.3 addition: a third loading path alongside automatic contextual
discovery and session-pinned activation — **explicit one-shot retrieval**.
A request such as "pull your persona-anchor skill before we get started"
must resolve and load a named skill for the current turn only, without
pinning it to the session.

## Objective

> **M7 — Skill discovery, retrieval, activation, and context injection**

M7 establishes skills as filesystem-backed procedural knowledge that ICOS can:

1. discover,
2. inspect,
3. load on demand,
4. inject into model context,
5. explicitly activate/deactivate when the user wants persistent session-level inclusion,
6. retrieve a named skill for the current turn only, without pinning it
   (one-shot explicit retrieval).

M7 is **prompt injection, not execution**. It answers:

> "What procedures does ICOS know how to follow, and which ones help right now?"

It does **not** answer (M8/M9):

> "What did ICOS actually do with tools in the world?"

Conceptually:

```text
M7 — skill catalog + discovery + on-demand loading + context injection (no tools)
M8 — tool calling / capability execution (skills can then name tools)
M9 — autonomous agent loop (skills + tools + approvals + clarifications)
```

Target behavior:

```text
User:
"Today we're working on the ICOS v3 stack. Let's clean up the memory architecture."

        ↓

Skill discovery

        ↓

icos-v3-stack identified as relevant

        ↓

SKILL.md loaded from ~/.icos/skills/icos-v3-stack/

        ↓

skill injected into model context

        ↓

LLM responds with ICOS v3 architectural context available
```

The goal is the smallest skill system that later milestones can rely upon for:

* procedural knowledge (`daily-journal`, `comments-pass`, …)
* user-defined workflows (`new-idea-deconstruction`, `capture-idea`, …)
* stack/project context skills (`icos-v3-stack`, …)
* plugin-provided skills (see `.reference/notes/integrations-and-plugins.md`)
* tool-adjacent procedures that M8 will make executable
* memory-adjacent procedures that M10–M12 will learn from

Reference inputs:

```text
.reference/notes/skill-samples.md          — seed catalog (raw idea list)
.reference/notes/slash-commands.md         — /skills, /context (Skills tokens)
.reference/notes/integrations-and-plugins.md — SKILLS → TOOLS/SUBAGENTS hierarchy
.reference/notes/core.md                   — Context Construction, Tools and Capabilities
.reference/notes/overview.md               — Skills owned by core
.reference/status.md                       — intended catalog location: ~/.icos/skills/
```

> **Path note:** the request named `.references/plans/milestone-7-skills.md`
> (plural). The repo convention is `.reference/plans/` (singular, see
> `INDEX.md` / `AGENTS.md`). This plan lives at the singular path.

---

# Architectural Principle

Separate the things M7 is routinely conflated with:

### 1. Skills ≠ tools

```text
Skill:  KNOWLEDGE of how to do something (prompt text)
Tool:   ABILITY to do something in the world (code execution)
```

M7 ships skills. M8 ships tools. A skill body may *describe* a procedure
that will later map to tools, but M7 executes nothing.

### 2. Skills ≠ memory

```text
Session history:    "What actually happened?"        (M3, SQLite)
Memory candidates:  "What might be worth retaining?" (M4, evidence ledger)
Epistemic memory:   "What does ICOS believe?"        (M10+, RuVector)
Skill:              "How do I perform this procedure?" (M7, filesystem)
```

Skills are **not** transcript history, memory candidates, epistemic claims,
beliefs, embeddings, learned facts, or user preferences. The filesystem is
the canonical source of truth:

```text
~/.icos/skills/
    icos-v3-stack/
        SKILL.md
    daily-journal/
        SKILL.md
    capture-idea/
        SKILL.md
```

ICOS may read a skill whenever required. The fact that a skill exists does
not need to be recorded in epistemic memory. Loading a skill does not
constitute a memory event. Do not build skill storage on the
memory-candidate ledger, and do not route skill loads through M4 extraction.

### 3. Skills ≠ plugins

Per `integrations-and-plugins.md`:

```text
                    ICOS CORE
                       │
                     SKILLS
                       │
                 ┌─────┴─────┐
                 ▼           ▼
               TOOLS     SUBAGENTS
```

A plugin *may provide* skills, but M7 does not build the plugin lifecycle
(manifest / connect / sync / events). M7 builds the **skill layer only**,
with a directory layout a future plugin installer can drop files into.

### 4. Discovery ≠ activation

```text
Discovery:   "Which skills might help with this?"  (per-turn, stateless)
Activation:  "Keep this skill in session context." (explicit, persistent)
```

Discovery returns candidates. It must not itself mutate runtime state.

### 5. Relevance ≠ action

There is an important difference between:

> "This skill is relevant to the current conversation."

and:

> "I have decided to perform an external action."

M7 provides procedural context only. Automatic discovery does not move
autonomy into M7. The progression remains:

```text
M7
Skills:
"I know how to approach this."

M8
Tools:
"I can actually do something."

M9
Agent loop:
"I can decide when to do something."
```

The critical rule for M7:

```text
Skills       → versioned prompt bundles on disk, discovered + loaded on demand
Tools        → NOT in M7 (M8)
Autonomy     → NOT in M7 (M9)
Learning     → NOT in M7 (M10–M12)
```

---

# M7 Decomposition

```text
M7a — Skill storage, validation, loading, and registry (descriptors + explicit body load)
M7b — Skill discovery (deterministic name/description matching, candidates not state)
M7c — On-demand loading + injection (session-pinned vs turn-contextual vs turn-explicit) + surfacing
```

Each slice is independently testable and shippable. M7b depends on M7a.
M7c depends on M7a+M7b.

---

# M7a — Storage, Format, Loader, Registry

## Objective

A deterministic skill catalog backed by the filesystem. No LLM contact.
No transcript writes. No memory extraction. Follows the M6a pattern:
parse → validate → register → dispatch deterministically.

Conceptually:

```text
~/.icos/skills/<skill-name>/SKILL.md
        ↓
   SkillLoader (scan + parse + validate)
        ↓
   SkillRegistry (descriptors in memory, bodies on explicit load)
        ↓
   /skills (deterministic slash commands)
```

## 1. Filesystem Layout

Live-instance canonical location (per `.reference/status.md`):

```text
~/.icos/skills/
├── icos-v3-stack/
│   └── SKILL.md
├── daily-journal/
│   └── SKILL.md
├── comments-pass/
│   └── SKILL.md
└── capture-idea/
    └── SKILL.md
```

Rules:

* One directory per skill. Directory name **must equal** the skill `name`
  declared in frontmatter (mismatch → skill rejected with reason).
* Exactly one entry file per skill directory: `SKILL.md` (case-sensitive).
* Extra files inside the skill directory (e.g. `references.md`,
  `template.md`) are **ignored in M7** — never loaded, never injected.
  (Progressive disclosure of bundled resources is a post-M9 optimization.)
* Hidden directories (`.`-prefixed), broken symlinks, and symlinks escaping
  `SKILLS_DIR` are skipped with a counted warning, never followed.
* Empty catalog (directory missing or zero valid skills) is a **valid state**:
  Core boots, `/skills` reports empty, conversation works unchanged.

## 2. Skill File Format

`SKILL.md` = YAML frontmatter + Markdown body. Deliberately close to the
Claude/opencode `SKILL.md` convention so future imports are trivial.

```markdown
---
name: daily-journal
description: Capture the day's events as a structured journal entry.
version: 0.1.0
---

# Daily Journal

Interview the user about today's events, then produce a journal entry with
sections: Highlights, Work, People, Open loops.

Ask one question at a time. Do not invent events the user did not mention.
```

Frontmatter schema (M7 — keep small):

```ts
interface SkillFrontmatter {
  /** kebab-case, ^[a-z0-9-]{1,64}$, must equal directory name. */
  name: string;
  /** One-line capability summary, 1–500 chars. Shown in catalog context. */
  description: string;
  /** Optional semver-ish label, informational only. Defaults to "0.0.0". */
  version?: string;
}
```

Body rules:

* Body is Markdown-as-prompt-text, 1–12_000 chars after trimming.
* Body must not be empty.
* Unknown frontmatter keys are **rejected** (fail closed — catches typos
  like `descripton:` rather than silently ignoring them).
* No executable semantics in M7. Frontmatter keys such as `exec`,
  `script`, `hooks`, `tools`, `permissions` are **rejected as unknown**.
  (Tool bindings arrive in M8 through an explicit allowlist, not by
  smuggling keys into this format now.)

Validation failures never crash boot. The skill is skipped, counted, and
reported via `/skills` and boot log with a machine-readable reason
(`bad-name`, `name-mismatch`, `missing-description`, `body-too-large`,
`bad-frontmatter`, `unreadable`, …).

## 3. Loader (descriptors now, bodies on demand)

The registry must expose enough metadata for discovery **without loading
every skill body unnecessarily**. Scanning is therefore two-phase:

```ts
interface SkillDescriptor {
  name: string;
  description: string;
  version: string;
}

interface LoadedSkill extends SkillDescriptor {
  /** Raw Markdown body (trimmed). Injected verbatim when in context. */
  body: string;
  /** Approx. size for budgeting (char length; token estimate derived). */
  bodyChars: number;
}

interface SkillLoadReport {
  dir: string;
  scanned: number;
  loaded: number;
  skipped: Array<{ name: string; reason: string }>;
}

interface SkillLoader {
  /** Phase 1: read directory entries + frontmatter only. Cheap, always runs. */
  scan(): Promise<SkillLoadReport>;
  /** Metadata for discovery/catalog — never touches bodies. */
  listDescriptors(): SkillDescriptor[];
  /** Phase 2: read + validate the canonical SKILL.md body. Explicit op. */
  loadBody(name: string): Promise<LoadedSkill>;
}
```

Requirements:

* `scan()` parses frontmatter for every candidate directory but defers
  body reads. Bodies load through `loadBody()` with a small in-memory cache
  keyed by name; `/skills refresh` (re-scan) invalidates the cache.
* No new native dependencies. Frontmatter parsing: implement a **minimal**
  `---`-delimited parser for the three known keys, or add `js-yaml` iff
  the parser exceeds ~60 lines. Prefer the smaller diff.
* `scan()` is idempotent: rebuilds descriptor state from disk, replacing it.
* Loader never contacts the LLM, never touches SQLite, never writes to
  `SKILLS_DIR`.

## 4. Registry

In-memory `Map<string, SkillDescriptor>`, keyed by lowercased name, plus a
body cache. No SQLite table in M7 — skills are content-addressed by the
filesystem, and the evidence for "what happened" stays in the session
transcript.

* Duplicate names (case-insensitive): first wins deterministically
  (sorted directory order), remainder reported as `duplicate` skips.
* Registry exposes `listDescriptors()` sorted alphabetically — deterministic
  output for `/skills`, discovery, and catalog-context construction.
* Registry is owned by a `SkillService` (`@Injectable`, in
  `core/src/skills/`), following the `DisplayPreferenceStore` /
  `HostHealthProvider` provider pattern — not a controller, not middleware.

## 5. Configuration

Extend `CoreConfig` (`core/src/config.ts`) with env-driven values,
mirroring the M5 `MEMORY_*` fallback style (explicit boundary, zero-config
default):

```text
SKILLS_DIR_PATH=~/.icos/skills/     # resolved with existing ~/ expansion
SKILLS_ENABLED=true                  # kill-switch; false = loader idle, /skills reports disabled
SKILLS_MAX_BODY_CHARS=12000          # per-skill body cap
SKILLS_MAX_CATALOG_ITEMS=50          # cap on catalog block injected into context
SKILLS_MAX_ACTIVE_PER_SESSION=5      # cap on explicitly activated skills per session
SKILLS_MAX_AUTO_LOADED_PER_TURN=2    # cap on contextually loaded skills per turn (provisional)
SKILLS_MAX_CONTEXT_CHARS=8000        # cap on total skill-body chars per turn (provisional)
```

* `SKILLS_DIR_PATH` reuses the existing `resolvePath` helper (same `~/`
  semantics as `SESSION_DB_PATH` / `MEMORY_DB_PATH`).
* Document all seven in `core/.env.sample` with the defaults above.
* `SKILLS_ENABLED=false` must make the system behave exactly as pre-M7:
  no loader scan, no catalog block, no discovery, `/skills*` returns a
  deterministic "skills disabled" message, conversation byte-identical.
* The two `AUTO/CONTEXT` caps are provisional — exact values determined
  during implementation against live context-window behavior and recorded
  in evidence. The invariant is fixed: **bounded, never unbounded**.

## 6. `/skills` Commands (M7a slice)

Build on the existing `CommandDispatcher` / `CommandRegistry` — register new
handlers, touch no giant switch. All deterministic, all bypass the LLM, none
persist transcript or trigger extraction (M6 invariant preserved).

```text
/skills                      — list catalog: name, version, description (alphabetical)
/skills show <name>          — load + render full body of one skill (truncated to body cap)
/skills refresh              — re-scan SKILLS_DIR, report loaded/skipped counts, drop body cache
```

* Unknown skill → deterministic 404-style command error (same pattern as
  unknown session / unknown approval — never LLM).
* `/skills refresh` is the M7 cache-invalidation story. No file watcher in
  M7 (watchers are a reliability liability; explicit refresh is testable).
* Output through the existing `CommandResult` contract (`kind: "data"` +
  human-readable `text`); the test client renders it as a system notice,
  same as other command results.

Activation commands (`use`/`drop`/`active`), one-shot retrieval (`pull`),
and `suggest` arrive in M7b/M7c. Registering M7a stubs returning "not yet available" is acceptable,
full behavior lands with its slice.

---

# M7b — Skill Discovery

## Objective

A first-class, deliberately simple discovery mechanism: given conversation
input, return ranked skill **candidates** without mutating runtime state.

Do NOT introduce embeddings, vector search, semantic memory, or an
LLM-based skill router in this milestone. Match deterministically against
skill **name** and **description** only.

Example:

```text
Input:
"we're working on the ICOS v3 stack"

Potential match:
icos-v3-stack
```

## 1. Discovery Contract

```ts
interface SkillMatch {
  skill: SkillDescriptor;
  score: number;
  matchedOn: Array<"name" | "description">;
}

interface SkillDiscovery {
  discoverSkills(input: string, limit?: number): SkillMatch[];
}
```

* Discovery operates on **descriptors only** — it never reads bodies.
* Malformed/skipped skills are excluded (they are not in the registry).
* Empty/blank input → zero matches (never "match everything").
* Result count bounded by caller-supplied `limit` (default 5).
* Ranking deterministic: name hits score above description hits;
  alphabetical tiebreak on skill name. Same input + same catalog ⇒ same
  output, byte for byte.
* `SKILLS_ENABLED=false` → discovery returns empty, always.

The exact scoring weights stay simple (e.g. name-substring = 2,
description-substring = 1, multi-token partial credit). Document the
formula in code comments and evidence. Sophistication belongs to M11
(semantic retrieval), model-assisted selection, or learned ranking — all
explicitly deferred.

## 2. Selection Interface (evolvability seam)

Turn-scoped loading (M7c) consumes discovery through a narrow selector
interface so the policy can evolve without re-plumbing:

```ts
interface SkillSelector {
  /** Pick which discovered candidates actually load this turn. */
  select(matches: SkillMatch[], budget: SelectionBudget): SkillDescriptor[];
}

interface SelectionBudget {
  maxSkills: number; // SKILLS_MAX_AUTO_LOADED_PER_TURN
  maxChars: number;  // SKILLS_MAX_CONTEXT_CHARS
}
```

M7 ships one implementation: deterministic top-N above score zero,
fill-to-budget in rank order, alphabetical tiebreak. Future selectors
(semantic, model-assisted, learned) implement the same interface.

## 3. `/skills suggest` (human-visible discovery)

```text
/skills suggest <free text>   — ranked candidates from the same engine, top 5
```

* The same `discoverSkills()` call the automatic path uses — this is the
  observability/debugging surface for "what does ICOS think is relevant?"
* Returns names (+ matched-on reason) only — never activates, never injects
  bodies.
* Deterministic; testable against a fixture catalog.

## 4. Discovery ≠ Activation (hard boundary)

* `discoverSkills()` is pure: input + registry ⇒ matches. No session
  writes, no active-set mutation, no transcript writes, no LLM calls.
* A discovered skill is **not** an active skill until either the user
  explicitly activates it (`/skills use`) or the turn-scoped loader (M7c)
  admits it for the current turn only.
* The model cannot invoke discovery or promote a match by emitting text —
  same invariant as M6b approvals: *LLM text never changes runtime state*.

---

# M7c — On-Demand Loading + Context Injection

## Objective

Load discovered skills into model context for the current interaction —
bounded, observable, and scoped — while retaining explicit session
activation as the persistence mechanism.

Conceptually:

```text
conversation input
        ↓
skill discovery (M7b — candidates, no state change)
        ↓
candidate selection (selector + budget)
        ↓
load skill bodies (explicit loader op)
        ↓
context builder (system-delimited, bounded, ordered)
```

## 1. Three Scopes: Session-Pinned, Turn-Contextual, Turn-Explicit

M7 supports three distinct skill scopes. Do not conflate them.

### Explicit session activation (control mechanism)

```text
/skills use icos-v3-stack
        ↓
activate (session-pinned)
        ↓
context (every subsequent turn until dropped)
```

* `/skills use <name>` adds to the session's explicit active set;
  `/skills drop <name>` removes; `/skills active` inspects both scopes
  (see §M7c.4).
* Active set lives in `SkillService` memory: `Map<sessionId, Set<string>>`.
  No SQLite migration in M7 (session-metadata persistence is an M8/M9
  concern alongside execution state). Document the limitation: active sets
  clear on restart; transcript is unaffected.
* Cap: `SKILLS_MAX_ACTIVE_PER_SESSION` (default 5). Exceeding → deterministic
  command error naming the cap and suggesting `/skills drop`.
* Activating an unknown / skipped / disabled skill → deterministic error.
  Activation is case-insensitive but stores the canonical name.
* Session lifecycle inherits M6 semantics:
  * `/new` → fresh session, empty active set.
  * `/fork` → copied transcript **and** copied explicit active set
    (documented; fork is "continue from here", so pinned procedures carry
    over). Turn-scoped contextual state is never copied — it is recomputed.
  * `/undo` → touches neither scope (undo is transcript/context surgery,
    not procedure state).
  * Unknown/deleted sessionId → activation commands fail deterministically.

Explicit activation means:

> "Keep this skill active for this session until I remove it."

It does NOT mean "this is the only way ICOS can use a skill."

### Automatic contextual loading (default path)

```text
User message
    ↓
discovery (candidates)
    ↓
selection (budgeted, deterministic)
    ↓
skill loaded for this turn/context only
```

* Contextual skills are resolved **per turn** from the current user message
  (plus, if cheap, the pending-session title — never the full transcript).
* A contextually loaded skill does **not** enter the explicit active set.
  Example:

```text
Session explicit active skills:
    daily-journal

Current message:
    "Let's work on ICOS memory."

Automatically loaded (this turn only):
    icos-v3-stack

Session explicit active set afterwards (unchanged):
    daily-journal
```

* This prevents automatic discovery from gradually filling a session with
  accumulated skills: yesterday's relevance never leaks into today's
  context unless the user pinned it.

### Explicit one-shot retrieval (turn-explicit)

```text
/skills pull persona-anchor
        ↓
named resolution (deterministic, case-insensitive)
        ↓
staged for the next turn only
        ↓
current-turn context (then discarded)
```

This is distinct from both other paths:

```text
/skills use persona-anchor   → keep active for the session (session-pinned)

conversation → discoverSkills() → candidate → load for current turn (turn-contextual)

/skills pull persona-anchor  → load for the next turn only (turn-explicit)
```

* `/skills pull <name>` resolves `<name>` against the canonical registry
  (deterministic, case-insensitive; unknown / skipped / disabled / invalid
  names → deterministic runtime error, same pattern as `use`) and stages
  the skill for the **next** conversation turn in that session — without
  touching the explicit active set. An explicitly requested skill must
  never silently become session-pinned.
* Staging is per-session pending state, consumed by the next
  `converse`/`converseStream` call and cleared whether or not the turn
  succeeds. A pulled skill therefore affects exactly one turn:

```text
User: "Pull your persona-anchor skill before we start."
  → staged (deterministic command result, no LLM contact)

Next turn: persona-anchor injected with scope="turn-explicit"

Following unrelated turn: persona-anchor gone
  (unless separately pinned via /skills use persona-anchor)
```

* Requested skills bypass the auto-load count cap (the user explicitly
  asked) but still obey `SKILLS_MAX_CONTEXT_CHARS`: if the body cannot fit
  alongside explicit skills, `/skills pull` fails fast with a deterministic
  budget error naming the cap, rather than silently dropping. Placement
  order: explicit → requested → contextual fills the remainder.
* The model cannot stage or pin skills by emitting text — no code path
  exists (same invariant as approvals). Only the command/runtime path
  (`SkillService.stageOneShot(sessionId, name)`) mutates pending state.
* Do not build a full natural-language intent parser in M7. Recognizing
  free-text phrases like "pull your persona-anchor skill" stays a later
  model-assisted or deterministic interaction-layer concern. M7 builds the
  primitive (`loadBody(name)`) plus the command/runtime path
  (`/skills pull`). The architectural invariant is simply: **a named skill
  can be explicitly retrieved for the current turn without becoming
  persistent session state.**
* Lifecycle: `/new` clears pending; `/fork` does not copy pending
  (turn-scoped by definition); `/undo` ignores it.

## 2. Conservative Automatic-Loading Policy

Be conservative. The first implementation does not need a sophisticated
autonomous skill-selection system — deterministic relevance with a small N:

```text
0–N automatically loaded skills per turn (N = SKILLS_MAX_AUTO_LOADED_PER_TURN)
```

* Selection: selector admits top-ranked matches while `maxChars`
  (`SKILLS_MAX_CONTEXT_CHARS`) holds, skipping bodies that would overflow
  (continue to the next smaller candidate rather than failing the turn).
* Explicitly active skills take budget priority, requested (turn-explicit)
  skills second: contextual loading uses whatever body budget remains after
  both are placed. Requested skills bypass the selector entirely — the user
  named them — but still obey the char budget (enforced fail-fast at
  `/skills pull` time). Explicit skills themselves are never truncated or
  evicted by contextual ones — overflow there surfaces as today (provider
  error under normal 502/504 mapping), recorded in evidence if observed live.
* No silent failure modes: when a discovered candidate is admitted or
  budget-rejected, the decision is recorded in the per-turn report (§M7c.4).

## 3. Context Construction (three skill tiers)

Retain the original tiered concept, now with four tiers (catalog, explicit,
requested, contextual). All tiers flow through `buildContext()` so streaming
and non-streaming stay identical.

```text
System prompt
    ↓
Skill catalog (if enabled — names + descriptions only)
    ↓
Explicitly active skills (session-pinned bodies)
    ↓
Explicitly requested skill (one-shot body, if staged)
    ↓
Contextually discovered skills (this-turn-only bodies)
    ↓
Conversation history
    ↓
Current user input
```

**Tier 1 — catalog block (always on when skills exist and are enabled):**

```text
<available_skills>
- daily-journal: Capture the day's events as a structured journal entry.
- icos-v3-stack: Architecture and conventions of the ICOS v3 stack.
To follow a procedure, the user may activate it with /skills use <name>.
Relevant skills may also load automatically for the current turn.
</available_skills>
```

* Bounded by `SKILLS_MAX_CATALOG_ITEMS` (default 50, alphabetical). Overflow
  appends `(and N more — see /skills)`.
* Empty catalog or `SKILLS_ENABLED=false` → block omitted entirely
  (byte-identical context to pre-M7 — regression-test this).
* Names + descriptions only, never bodies (the `core.md` "smallest useful
  representation" rule).

**Tier 2+3+4 — skill bodies (explicit, then requested, then contextual):**

Each loaded skill becomes one additional `system`-role message **after**
the base system prompt and **before** history:

```text
messages[0] = { role: "system", content: systemPrompt + catalogBlock }
messages[1] = { role: "system", content: <skill name="daily-journal" scope="explicit">\n<body>\n</skill> }
messages[2] = { role: "system", content: <skill name="persona-anchor" scope="turn-explicit">\n<body>\n</skill> }
messages[3] = { role: "system", content: <skill name="icos-v3-stack" scope="contextual">\n<body>\n</skill> }
messages[4..] = history (bounded by maxHistory) + current input
```

* Delimiters mandatory, now carrying `scope` so the model — and the
  evidence log — can distinguish pinned procedures from turn-scoped ones.
  Skill bodies containing "ignore previous instructions" remain visibly
  quoted data.
* Order deterministic: explicit skills alphabetical, then requested skills
  alphabetical (pending set is usually one), then contextual skills in
  selector rank order (alphabetical tiebreak) — identical across runs and
  providers.
* Bodies injected verbatim (no templating, no variable interpolation in M7).
* Skill content is never inserted as `user` or `assistant` roles.

`buildContext()` signature evolves minimally:

```ts
buildContext(
  systemPrompt: string,
  history: ChatMessage[],
  input: string,
  maxHistory: number,
  skills?: {
    catalog: string;
    explicit: LoadedSkill[];
    requested: LoadedSkill[];
    contextual: LoadedSkill[];
  },
): ChatMessage[];
```

Keep the existing 4-arg call working (optional param) so the unit-test
blast radius is small.

## 4. Observability (no silent injection)

Automatic skill use must be visible. `SkillService` records a per-session
last-turn report (memory only, cleared on restart alongside active sets):

```ts
interface TurnSkillReport {
  sessionId: string;
  explicit: string[];       // session-pinned names injected
  contextual: string[];     // automatically discovered names injected
  requested: string[];      // explicitly requested one-shot names injected
  considered: SkillMatch[]; // discovery candidates admitted or budget-rejected
}
```

Surfaced through:

```text
/skills active               — explicit set + pending one-shot + last-turn
                               contextual/requested sets, each labeled
/context (or /status)        — Skills: line with explicit/contextual/requested
                               token split + per-skill breakdown on detail view
GET /core/skills/active?sessionId= — { sessionId, explicit: [], requested: [], contextual: [] }
```

At minimum an operator can always answer "which skills shaped that reply,
and why." `/skills suggest` remains the pre-turn "what would match?" probe.

## 5. `/context` Skills Section

`slash-commands.md` already reserves the shape:

```text
System:          2,341 tokens
History:         4,821 tokens
Skills:            642 tokens
Memory:              0 tokens
Current input:     117 tokens
```

M7c implements the `Skills:` line split by scope
(`explicit 400 + requested 150 + contextual 242`) with per-skill breakdown on detail view,
using the same estimator as the other lines. If `/context` is not otherwise
built by M7 time, the split skills line ships as part of `/status` instead —
one of the two must report skill token cost. Do not ship M7 without *some*
deterministic token-visibility for injected skills.

## 6. Seed Skills (filesystem fixtures, not code)

Convert **five** entries into real `SKILL.md` files shipped as
**documentation fixtures** (not auto-installed into `~/.icos/skills/` —
installation is an explicit operator copy step documented in evidence):

```text
docs/skills/icos-v3-stack/SKILL.md  ← discovery-demo skill (project context)
docs/skills/persona-anchor/SKILL.md ← one-shot retrieval demo skill
docs/skills/daily-journal/SKILL.md  ← Personal / daily-journal
docs/skills/comments-pass/SKILL.md  ← Development / comments-pass
docs/skills/capture-idea/SKILL.md   ← Idea/Project Work / capture-idea
```

Each seed body stays small (<2KB) and follows the M7a format. The
`icos-v3-stack` seed exists specifically to demonstrate discovery: its
name/description must match inputs like "working on the ICOS v3
stack" under the M7b scorer (assert this in tests). The `persona-anchor`
seed supports the turn-explicit live demo (§Verification step 3). The seeds serve as:
(a) format conformance examples, (b) e2e/live-test fixtures, (c) the
starting point for the operator's real `~/.icos/skills/` catalog.

Do not implement the full `skill-samples.md` wishlist (`bounty-hunter`,
`comfyui-image`, `employment-search`, …) — those need tools/network (M8).

## 7. Test-client affordance (minimal)

Render `/skills*` command results through the existing system-notice path
(no new UI framework). If cheap, add explicit + last-turn contextual skill
names to the session header line
(`session abc123 · skills: daily-journal +req: persona-anchor +ctx: icos-v3-stack`).
No skill editor, no file browser, no settings page in M7.

## 8. What Skills Must Never Do (M7 invariants)

* Never reach the LLM as `user` or `assistant` roles — `system` only.
* Never persisted as transcript messages (`sessions`/`messages` tables
  untouched; FTS indexes unchanged).
* Never fed to the M4 extractor as independent records — extraction input
  remains `{ userMessage, assistantMessage, bounded context }` as today;
  skill scaffolding and skill loads are not candidate provenance, and a
  skill load is not a memory event.
* Never able to change runtime state (no activation, approval, session, or
  config mutation via skill text; discovery is pure).
* Never logged with secrets; never transmitted except as part of the normal
  provider request body the operator already configured.
* Automatic discovery weakens none of these: content comes only from the
  configured skill directory, validated before registration, symlinks
  contained, no code execution, no tool invocation, no memory writes.
* Provider neutrality preserved: `ConversationService`, `SessionStore`,
  `MemoryCandidateExtractor`, and streaming contain **zero skill-format
  branches** — they see only `ChatMessage[]`. (Grep-verifiable, M5-style.)

---

# Configuration & File Map

## New files (`core/src/skills/`)

```text
skills/skill.types.ts        — SkillDescriptor, LoadedSkill, SkillMatch,
                               SelectionBudget, TurnSkillReport interfaces
skills/skill-loader.ts       — SKILL.md scan (frontmatter) + loadBody + validate
skills/skill-discovery.ts    — discoverSkills() deterministic scorer
skills/skill-selector.ts     — SkillSelector interface + top-N budgeted default
skills/skill.service.ts      — registry + explicit active-set + per-turn
                               contextual resolution + catalog-block builder
                               + last-turn report
skills/skills.controller.ts  — GET /core/skills, GET /core/skills/:name,
                               GET /core/skills/active?sessionId=,
                               GET /core/skills/discover?q=
                               (read-only inspection mirrors candidates.controller.ts)
skills/command-adapter.ts    — /skills* handler registration (used by CommandDispatcher)
```

## Modified

```text
config.ts                    — SKILLS_* env ( §M7a.5 )
.env.sample                  — document SKILLS_*
conversation/context.builder.ts       — optional skills param (§M7c.3)
conversation/conversation.service.ts  — per-turn discover → select → load → buildContext
                                          (both converse + converseStream paths,
                                           identical message arrays)
commands/command-dispatcher.ts        — register skill commands
core/controller surface               — inspection endpoints (read-only)
test-client.html                      — render command results (existing path)
docs/skills/*/SKILL.md                — five seed fixtures (§M7c.6)
```

## Inspection API (read-only, mirrors `GET /core/memory-candidates`)

```text
GET /core/skills                    → { skills: [{ name, description, version }], skipped: [...] }
GET /core/skills/:name              → { name, description, version, body }
GET /core/skills/active?sessionId=  → { sessionId, explicit: [names], requested: [names], contextual: [names] }
GET /core/skills/discover?q=...     → { matches: [{ name, score, matchedOn }] }
```

No POST/PUT/DELETE for skill content in M7 — the filesystem is the writer.
Explicit activation changes flow through `/skills use|drop` (slash
commands); contextual loading is recomputed per turn and exposed read-only.
This keeps the M6 "commands are deterministic, conversation is LLM" split
intact.

---

# Testing

## M7a tests

* Loader: valid skill loads; missing frontmatter rejected; bad name
  rejected; name-mismatch rejected; missing description rejected; unknown
  frontmatter key rejected; empty body rejected; oversize body rejected;
  dotfile/symlink-escape skipped; duplicate names deterministic.
* Descriptor/body split: `listDescriptors()` performs no body reads
  (assert via fs spy); `loadBody()` reads canonical path, caches, fails
  cleanly on missing; refresh invalidates cache.
* Registry: alphabetical descriptors; case-insensitive lookup; `scan()`
  idempotent; empty dir valid.
* Config: defaults resolve (`~/.icos/skills/` etc.); `SKILLS_ENABLED=false`
  disables loader + commands deterministically.
* Commands: `/skills` empty catalog; `/skills show` happy path + unknown
  404-path; `/skills refresh` counts; none trigger LLM calls (mock
  `LlmClient`, assert zero invocations — M6a-style).
* Inspection endpoints: list/get shapes; unknown name 404.

## M7b tests (discovery)

* Name matching; description matching; case-insensitivity.
* Deterministic ranking: name-beats-description, alphabetical tiebreak,
  byte-identical output across runs on fixture catalog.
* Ties; no-match → empty (never everything); blank input → empty.
* Bounded result count (`limit` honored, default 5).
* Malformed/skipped skills excluded from matches.
* Disabled mode → always empty.
* `suggest` returns the same ranking as `discoverSkills()` on the same
  input; never mutates active sets, never injects bodies.
* `icos-v3-stack` seed matches "working on the ICOS v3 stack" (regression
  anchor for the M7 demo).

## M7c tests (loading + injection)

* Relevant skill injected for a matching turn; irrelevant skill not
  injected (bread-probe: message about an unrelated topic injects nothing
  previously relevant).
* `SKILLS_MAX_AUTO_LOADED_PER_TURN` enforced; `SKILLS_MAX_CONTEXT_CHARS`
  enforced (overflow candidates skipped for smaller ones, turn succeeds).
* Contextual skills do not enter the explicit active set (assert set
  unchanged after auto-loaded turns).
* Contextual skills do not persist into transcript, FTS, or extractor
  input (assert on repository contents + extractor mock args).
* Multiple contextual skills ordered deterministically (selector rank,
  alphabetical tiebreak); explicit → requested → contextual placement.
* Explicit one-shot retrieval (`/skills pull`): stages the named skill for
  exactly the next turn; injected once with `scope="turn-explicit"`, then
  gone; never enters the explicit set; unknown/skipped/disabled names and
  char-budget overflow fail fast with deterministic command errors; staged
  state cleared by `/new`, not copied by `/fork`, ignored by `/undo`;
  LLM-emitted text can neither stage nor pin (no code path exists).
* Explicit activation: use/drop/active round-trip; unknown skill error;
  cap enforcement; case-insensitivity; `/new` clears explicit set;
  `/fork` copies explicit set only; `/undo` preserves both;
  LLM text cannot activate or discover-promote (no code path exists).
* Service-level: `converse` and `converseStream` pass identical message
  arrays given the same turn input + explicit set (capture mock args,
  diff); history appended on clean completion only (M2 invariant intact).
* `buildContext`: no-skills call byte-identical to pre-M7 output
  (regression); catalog capped with overflow notice; `scope` delimiters
  present; disabled mode strips everything.
* Observability: last-turn report records explicit/contextual/considered;
  `/skills active` and inspection endpoint reflect it.
* `/context` or `/status` skills-token split matches estimator output.
* Seed fixtures parse clean under the M7a validator.

## Regression requirements (all green)

```text
M1 conversation      — unchanged message flow, error mapping intact
M2 streaming         — meta/token/done/error events unchanged
M3 persistence       — transcript + FTS unaffected by skills
M4 extraction        — fire-and-forget enrichment, failure isolation intact
M5 providers         — zero provider branches in new code (grep-verified)
M6a/b/c              — commands bypass LLM; approvals/clarifications intact;
                       slash commands still never trigger memory extraction
```

Particular checks:

* skills disabled → context byte-identical to pre-M7 (snapshot test).
* commands (`/skills*` included) create no transcript rows, no candidates.
* no secrets in skill paths/bodies reach logs or API error payloads.
* `tsc` + `eslint` clean before evidence is accepted (AGENTS.md).

---

# Verification (live)

1. `npm install && npm test && npm run test:e2e` green in `core/`.
2. Seed a live catalog:
   ```bash
   mkdir -p ~/.icos/skills
   cp -r docs/skills/icos-v3-stack ~/.icos/skills/
   cp -r docs/skills/daily-journal ~/.icos/skills/
   cp -r docs/skills/persona-anchor ~/.icos/skills/
   ```
3. Boot Core, `POST /core/conversation/stream` via test client:
   * `/skills` lists both; `/skills show icos-v3-stack` renders body.
   * Discovery demo (the M7 behavioral proof):
     ```text
     User: "Today we're working on the ICOS v3 stack."
       → ICOS discovers icos-v3-stack, loads it, answers with stack context.
     User: "What's the current architecture?"
       → still relevant; skill loads again for this turn (recomputed, not pinned).
     User: "Now let's talk about bread."
       → icos-v3-stack NOT injected (no lingering relevance).
     ```
     Verify each turn's injection via `/skills active` (explicit vs
     contextual) and the outgoing-`messages[]` debug log.
   * Explicit control: `/skills use daily-journal` → pinned across turns
     (including unrelated ones); `/skills drop daily-journal` → reverts.
     Auto-discovery never mutates the explicit set (assert before/after).
   * One-shot retrieval (the turn-explicit proof, using `persona-anchor`):
     ```text
     User (command): /skills pull persona-anchor
       → deterministic staged result, no LLM contact.
     Next turn: any message
       → persona-anchor injected once with scope="turn-explicit"
          (visible in /skills active + outgoing messages[]).
     Following turn: unrelated message
       → persona-anchor absent; explicit set untouched throughout.
     ```
   * `/skills suggest "working on ICOS v3"` returns `icos-v3-stack`
     without activating or injecting anything.
4. Provider swap (M5-style, lightweight): same discovery flow against
   Ollama and one cloud provider — replies differ by model, discovery +
   injection identical (inspect outgoing `messages[]`).
5. Budget drill: lower `SKILLS_MAX_AUTO_LOADED_PER_TURN=1` with two
   matching fixtures → top-1 loads, runner-up reported as
   budget-rejected in the turn report, conversation succeeds.
6. Failure drill: malformed `SKILL.md` added → `/skills refresh` reports
   skip reason, excluded from discovery, conversation unaffected;
   `SKILLS_ENABLED=false` boot → catalog block gone, discovery empty,
   `/skills` reports disabled.

Evidence committed to (M6-evidence style):

```text
.reference/plans/evidence/milestone-7-evidence-skills.md
```

containing: unit+e2e output, live transcript of the discovery demo
(stack → architecture → bread), live transcript of the one-shot demo
(pull → injected once → gone), outgoing-messages diffs proving
turn-scoped injection and non-persistence, explicit-control transcript,
budget-drill report, regression checklist, and the operator copy-step for
seed skills.

---

# M7 Non-Goals

Do NOT implement:

* tool calling, tool schemas, tool execution, MCP servers (M8)
* autonomous loops, scheduling, proactive skill invocation (M9)
* skill learning from conversation, procedural-memory promotion (M10–M12)
* vector/semantic skill retrieval, embeddings, re-ranking (M11)
* skill ranking from historical success; automatic skill creation
* skill marketplace, remote install, versioning DAG, dependency resolution
* executable skill hooks, scripts, or permission elevation
* file watcher / hot-reload (explicit `/skills refresh` suffices)
* multi-file skill bundles / progressive disclosure beyond SKILL.md
* plugin lifecycle (install/connect/sync/events) — see integrations notes
* persistent skill activation database (explicit sets stay memory-only)
* complex model-based skill routing
* subagents invoking skills independently (deferred with subagents)
* RBAC / multi-user skill scoping (single-user runtime in M7)
* model routing or provider failover based on skills

---

# Definition of Done

At the end of M7, ICOS can:

1. [ ] discover skills from `~/.icos/skills/`;
2. [ ] inspect their metadata (`/skills`, `GET /core/skills`);
3. [ ] explicitly activate a skill for a session (`/skills use`);
4. [ ] explicitly deactivate it (`/skills drop`);
5. [ ] discover relevant skills from conversation input
   (`discoverSkills()`, `/skills suggest`);
6. [ ] load relevant skills on demand (`loadBody()` per turn);
7. [ ] inject them into context without involving memory
   (system-delimited, turn-scoped);
8. [ ] distinguish explicit session skills, requested one-shot skills,
   and contextual turn-scoped skills (scopes labeled in context,
   reports, and APIs);
9. [ ] expose what skills were active/loaded for observability
   (`/skills active`, `/context` split, last-turn report);
10. [ ] enforce context and skill-count limits
    (`SKILLS_MAX_ACTIVE_PER_SESSION`, `SKILLS_MAX_AUTO_LOADED_PER_TURN`,
    `SKILLS_MAX_CONTEXT_CHARS`);
11. [ ] remain completely tool-free and non-autonomous
    (M1–M6 regressions green, provider neutrality grep-clean).
12. [ ] retrieve a named skill for the current turn without pinning it
    (`/skills pull`, `scope="turn-explicit"`, staged-once semantics).

## Slice gates

### M7a

* [ ] `SKILL.md` format fixed (frontmatter schema + body limits enforced).
* [ ] Loader scans descriptors, defers bodies; skips reported with reasons.
* [ ] Registry lists descriptors deterministically; empty catalog valid.
* [ ] `SKILLS_*` config + `.env.sample` docs; disabled mode byte-identical.
* [ ] `/skills`, `/skills show`, `/skills refresh` deterministic, LLM-free.
* [ ] Read-only inspection endpoints mirror the candidates pattern.
* [ ] M7a tests green.

### M7b

* [ ] `discoverSkills()` deterministic over name+description (no embeddings).
* [ ] Discovery pure: no state mutation, no bodies, no LLM.
* [ ] `SkillSelector` seam + default top-N budgeted selector.
* [ ] `/skills suggest` exposes the same engine, activates nothing.
* [ ] M7b tests green (ranking, bounds, exclusion, disabled, seed anchor).

### M7c

* [ ] Turn-scoped contextual loading bounded by both caps.
* [ ] One-shot retrieval (`/skills pull`): named resolution, next-turn-only
  injection with `scope="turn-explicit"`, never pinned; deterministic
  errors for unknown/skipped/disabled/over-budget names.
* [ ] No NL intent parser: free-text skill requests are out of scope;
  the `loadBody(name)` primitive + command path is the M7 contract.
* [ ] Three-tier context order with `scope` delimiters (`explicit`,
  `turn-explicit`, `contextual`); stream+non-stream identical.
* [ ] Explicit scope lifecycle (`/new` clears, `/fork` copies explicit only).
* [ ] Last-turn report + `/context` split + active-endpoint scopes
  (explicit / requested / contextual).
* [ ] Five seed skills ship as `docs/skills/*/SKILL.md` fixtures.
* [ ] Live discovery demo recorded under
      `.reference/plans/evidence/milestone-7-evidence-skills.md`.
* [ ] `tsc` + `eslint` clean.

## Key behavioral demonstration

```text
User:
"Today we're working on the ICOS v3 stack."

ICOS:
[discovers icos-v3-stack]
[loads skill]
[includes it in context]

User:
"What's the current architecture?"

ICOS:
[answers with the ICOS v3 skill available]

User:
"Now let's talk about bread."

ICOS:
[does not continue injecting icos-v3-stack merely because it was
previously relevant, unless the user explicitly activated it]
```

## Final M7 invariant

After M7, the request path looks like this:

```text
                         User input
                             │
                 ┌───────────┼───────────┐
                 │           │           │
                 ↓           ↓           ↓
             /command    conversation   pending
                 │           │         interaction
                 │           ├── skills catalog (names only)
                 │           ├── explicit skills (session-pinned, system)
                 │           ├── requested skill (one-shot, system)
                 │           ├── contextual skills (turn-scoped, system)
                 │           ↓
                 │           LLM
                 ↓           ↓           ↓
             Core action  reply       resolve
                                        │
                                        ↓
                                     continue
```

And the architecture:

```text
                 ~/.icos/skills/
                       │
                       ▼
                  Skill Registry
                   (descriptors)
                       │
              ┌────────┴────────┬────────┐
              │                 │        │
        explicit use      explicit pull  discovery
              │                 │        │
              ▼                 ▼        ▼
       session-active     one-shot    contextual
                          (1 turn)     match
              │                 │        │
              └────────┬────────┴────────┘
                       ▼
                 Skill Loader
                  (bodies)
                       │
                       ▼
                 Context Builder
                  (scoped, bounded,
                   delimited, observable)
                       │
                       ▼
                      LLM
```

The rules the next milestones inherit:

```text
Skills  → on disk; discovery finds them; loading reads them;
          activation scopes them; explicit request pulls one for a turn;
          context makes them available. Memory is not involved.
Tools   → M8 (execution)
Agency  → M9 (autonomy)
Memory  → M10+ (belief)
```

Skills teach ICOS *how*. They never, by themselves, *do*.

---

# Open Questions (answer during implementation, record in evidence)

1. Catalog-block size: is 50 summaries too noisy for small-context local
   models? Measure live; lower the default only with evidence.
2. Auto-load N and char budget: do the provisional
   `SKILLS_MAX_AUTO_LOADED_PER_TURN=2` / `SKILLS_MAX_CONTEXT_CHARS=8000`
   defaults survive live turns? Adjust only with measured evidence.
3. Should `/fork` copy the explicit active set? (Plan says yes — revisit if
   fork semantics change in M8 execution-state work.)
4. Frontmatter parser: hand-rolled vs `js-yaml` — decide by diff size at
   implementation time, note the choice in evidence.
5. Explicit-set persistence (SQLite vs memory) — deferred to M8 unless
   restart behavior proves painful during M7 live runs.
6. Last-turn report retention: single last turn per session suffices for M7,
   or is a short ring buffer needed for debugging? Default to one; expand
   only on demonstrated need.
