# ICOS v3 — Milestone 10: Epistemic Memory

## Objective

M10 should prove the first complete **evidence-to-belief pipeline**.

M4 established a durable evidence ledger (memory candidates with
provenance, extraction metadata, and failure isolation). M9
established an agent loop that can act, observe, and terminate
truthfully. M10 adds the layer that turns observations into
maintainable beliefs: a claim model, a promotion pipeline with
hybrid authority, durable claim storage, and a read path — without
yet feeding beliefs back into agent context (that is M11) and
without belief dynamics (that is M12).

### Research question

> Given a ledger of extracted observations, can ICOS derive stable,
> provenance-traced beliefs, revise them when evidence changes, and
> retrieve them for inspection — without conflating what was
> observed with what is believed?

The fundamental pipeline is:

```text
memory_candidates (M4 ledger, read-only)
    ↓
promotion (hybrid authority)
    ↓
Claim (belief record with provenance + confidence)
    ↓
RuVector substrate (durable claim store)
    ↓
read API (inspection only — no context injection until M11)
```

---

# Architectural Boundary

## M4 owns evidence

M4 remains responsible for:

- candidate extraction,
- deterministic candidate validation,
- the `memory_candidates` ledger,
- extraction provenance and metadata,
- failure isolation.

M10 reads candidates. It never writes, amends, or reinterprets
ledger rows. A belief references its evidence; it never edits it.

## M8/M9 own action

Promotion executes no tools, parks no approvals of its own except
through the existing approval system (see M10c), and changes no
conversation behavior. Agent turns do not consult beliefs until M11.

## Web-client is out of scope

A parallel effort owns `web-client/`. M10 touches `core/` and
`.reference/` only. Any future belief UI lands after M10 through
the read API defined here.

---

# Deferred scope (decided, not forgotten)

The memory notes (`memory-system.md`) promise more than M10 delivers.
The feedback document (`memory-system-feedback.md`) demands each gap
be resolved or cut. Resolution for M10:

- **Working / reflexive memory**: cut. Neither is a stored class in
  M10. If a future milestone needs them, it defines them then.
- **Graph / hypergraph edges**: cut. Claims store flat entity lists
  (inherited from candidates). No edge table, no traversal, no
  "dynamic graph" claim in M10.
- **Holographic reconstruction**: cut. Retrieval is lookup, not
  reconstruction. The notes' layer-4 stays aspirational.
- **Decay schedules**: cut (M12 dynamics). Claims carry no decay
  timers in M10.
- **Confidence**: resolved per feedback — the extractor's number is
  stored as an *observation* (`extractorConfidence`); the engine
  maintains its own re-estimated `confidence`. The two never share
  a field.
- **Provenance**: resolved per feedback — every claim carries both
  `firstAssertedAt` (originating evidence) and `lastSurfacedAt`
  (most recent supporting evidence). Re-mining updates only the
  latter; nothing downstream may read either as "the" source.
- **Origin (user vs agent)**: resolved — see M10b. Role is stored,
  never join-derived, and mixed-origin evidence never collapses to
  a single source.

---

# [x] M10a — RuVector Evaluation Spike (complete 2026-09-23)

**Decision: RuVector as embedded library (`VectorDB` + `OnnxEmbedder`
only — never `AgenticMemory`); associative surface bespoke HRR-lite
in SQLite; container base must move alpine → glibc before M10b.**
Evidence: `.reference/plans/evidence/milestone-10a-evidence-ruvector.md`.

No RuVector code exists in the tree; the M4 plan names it only as
the future substrate. Standing preference: **lean toward RuVector
if the architecture allows** — one fewer bespoke system to maintain
and the v2 lineage already answers its operational questions. But
sovereignty matters more: Core must never hard-depend on a
third-party store for basic function. If RuVector cannot answer the
questions below cleanly, M10 proceeds on the bespoke SQLite path
(FTS5 + structured tables, same patterns as M4) with no apology,
and RuVector becomes an M13-style integration. The remaining slices
must not assume the outcome — write them against a repository
boundary (`ClaimRepository`), not a backend.

- What is RuVector here — library, sidecar service, or separate
  store? Exact integration surface and deployment shape.
- Can it run inside the existing Docker composition next to Core,
  or does it force new infrastructure?
- Does its record model fit the claim schema in M10b, or does the
  schema bend toward it?
- What happens when it is down — does Core degrade (claims
  unreadable) or refuse (turns fail)? Core must degrade; the
  transcript and ledger are the system of record, never RuVector.

Time-box this slice.

## Associative surface (HRR lineage)

Semantic search finds what *means* similar; v2's HRR store found
what *feels linked* (partial-match resonance: `exact wording`
nudging up `quote preservation`). That surface is worth keeping —
and it was SQLite-backed in v2, so it's portable with no new
infrastructure. M10a therefore decides **two** things: the semantic
backend (RuVector vs bespoke embeddings) and the associative
mechanism (ported HRR-style store vs equivalent). Either path must
yield three recall surfaces for M11: lexical, semantic,
associative. If any surface doesn't land, M11 proceeds without it —
degraded, declared, not silent.

---

# [x] M10b — Claim Model (complete 2026-09-23)

Evidence: `.reference/plans/evidence/milestone-10b-evidence-claim-model.md`.

Define the belief record. Minimum fields:

```text
Claim
├── id
├── subject / predicate / object (normalized — see identity)
├── category: fact | preference | relationship | procedure
│   (stored in M10 from candidate kind where available;
│   per-category lifecycles are M12 — uniform handling until then)
├── status: candidate | active | contradicted | retired
├── extractorConfidence (observation, never re-estimated)
├── confidence (engine estimate, re-estimated on evidence change)
├── firstAssertedAt (originating evidence ref)
├── lastSurfacedAt (latest supporting evidence ref)
├── origin: 'user' | 'agent' (role of first-asserted evidence)
├── sourceType (reserved — M12 source reliability populates:
│   direct_statement | inference | speculation | ...)
├── summary (reserved — short label for inspection lists)
├── evidence[] (candidate refs with per-item origin — never copies)
├── related[] (reserved — claim ids touched by the same promotion;
│   stored, unused; M11 traversal substrate)
├── entities[] (flat, inherited — no graph claim)
├── timesObserved (counter; M12 owns the compounding rule)
├── accessCount / lastAccessedAt (M11 writes, M12 interprets)
├── activation (reserved — M12 salience, see M12d)
├── locked (reserved — M12 certainty lock)
├── emotional (reserved block, v2 lineage — valence / arousal /
│   dominance / frustration + primaryEmotion; never populated in M10)
├── promotion (auto | approved:<approval-id>)
└── createdAt / updatedAt
```

## Schema reservation discipline (v2 lesson)

v2 taught that every "we'll add it later" field costs a migration
if the schema doesn't reserve it. Fields marked `reserved` above
exist in M10, read as null/zero, are never defaulted into meaning,
and have exactly one future owner each. M10 populates and uses only
the unreserved fields. Verification asserts the reserved fields
stay untouched (see M10f).

## Origin: user vs agent

The agent must always be able to tell whether a fact came from the
user or from itself — including agent-stated facts the extractor
later mines. Origin is **stored, never join-derived**:

- Candidate `source` gains `role: 'user' | 'assistant'`,
  denormalized from the message row at extraction time. Joining
  back to `messages` is fragile (exclusions, `/undo`, forks), so
  the role is stamped when observed. Pre-M10 ledger rows lack it
  and read as `unknown` — never defaulted.
- Each evidence entry carries `{ candidateId, role }` inherited
  from its candidate. A belief synthesized from mixed evidence
  keeps the full mix; nothing collapses it.
- Claim-level `origin` is derived, not asserted: the role of the
  `firstAssertedAt` evidence (`mixed` is never a claim-level
  value — a claim originates from one side even when later
  evidence comes from both). Consumers needing the full mix read
  the evidence list.
- Agent-stated facts mined from assistant messages are first-class
  evidence with `role: 'assistant'` — the pipeline must never
  launder them into user facts.

## Claim identity and deduplication

Identity is the normalized `(subject, predicate, object)` triple.
Normalization rules (case, whitespace, trivial morphology) live in
one tested function. A second candidate for an existing triple does
not create a claim — it becomes evidence on it (`REINFORCE`) or a
contradiction against it (M10e).

## Status lifecycle (provisional — M12 owns dynamics)

`candidate → active → contradicted → retired`. M10 implements
`candidate → active` (promotion) and `active → contradicted`
(M10e). `retired` exists in the schema but has no writer until M12.

---

# [ ] M10c — Promotion Pipeline

The centerpiece: the step that turns candidates into beliefs, with
hybrid authority (decided: human approval by default, automatic
only when explicitly opted in).

## Derivation operations

Every promotion is exactly one of:

```text
NEW         — no claim shares the triple; create it (candidate state)
REINFORCE   — triple exists; append evidence, touch lastSurfacedAt,
              re-estimate confidence upward
CONTRADICT  — triple conflicts with an active claim; mark the old
              claim contradicted, create the new one (see M10e)
```

## Authority policy (default: human-in-the-loop)

Until auto-assimilation is proven, **every promotion requires human
approval** through the existing `approvals` system (action
`memory.promote`, bound to the candidate id). Grant executes exactly
once; denial leaves the candidate unpromoted with no retry loop.

The automatic path is implemented but **default-off**: `NEW` claims
below a risk threshold *may* self-promote only when explicitly
opted in (config: risk kinds + threshold, default admits nothing).
Auto-promotion writes claims but never touches the ledger and never
notifies beyond the ledger. Flip the default only with evidence
that assimilation behaves — not before.

## Promotion journal (exactly-once across restart)

"Grant executes exactly once" is a promise that needs machinery —
v2's ingestion journal proved the pattern. Promotion runs through a
small journal, not bare writes:

```text
proposed → approved/denied → promoting → committed
```

- The approval id is the idempotency key: a unique constraint on
  the derivation means a retried grant converges instead of
  duplicating.
- A crash between grant and claim-write recovers on startup
  (`promoting` entries replay; `committed` entries skip).
- The journal is inspectable (pending promotions are visible, not
  silent), and survives restart like pending approvals do.

## Failure semantics

- Promotion reads candidates; a missing candidate aborts, never
  invents.
- Concurrent promotion of the same triple converges (unique
  identity constraint wins; the loser becomes evidence).
- Promotion never blocks or fails conversation (fire-and-forget
  like extraction, or an explicit offline job — decide in slice).

---

# [ ] M10d — Claim Storage and Read API

Persist claims behind a `ClaimRepository` boundary (SQLite first
unless M10a lands RuVector). Read paths for inspection and
verification only:

```text
GET /core/claims?status=&kind=&category=&limit=
GET /core/claims/:id  (claim + evidence refs + history)
GET /core/prospective (clarification queue — see M10e)
GET /core/promotions/pending (journal inspection — see M10c)
```

No context injection: agent turns must not see claims until M11.
Enforce this by code review, not just intent — the conversation
service gains no claim dependency in M10. (M11 is granted one
write: `accessCount`/`lastAccessedAt` counters. Nothing else.)

---

# [ ] M10e — Contradiction Handling

Define what conflict means narrowly (same subject+predicate,
different object — plus an explicit same-triple negation marker,
not model vibes). On `CONTRADICT`:

```text
old claim → contradicted (kept, with losing evidence intact)
new claim → candidate/active per authority policy
both keep full evidence lists (nothing rewritten)
```

Contradiction is recorded, not resolved: M10 does not pick winners
beyond recency + authority. Belief revision proper is M12.

## Clarification surfacing

A recorded contradiction with no follow-up path is a dead end —
v2's `needs_clarification → prospective item → focused question`
loop is the other half of contestation handling. M10 implements the
storage half:

- When a contradiction drops a claim's confidence below a
  configured threshold, or the same triple is contested twice,
  promotion writes a `prospective_items` entry: the conflicting
  values, their origins, confidence levels, and a suggested
  question phrasing.
- Prospective items are served by the read API (see M10d) for
  inspection. Upstream surfacing — as an agent question, a UI
  element, a turn-time behavior — is explicitly later work, not M10.
- Denial/ignore leaves the item parked; nothing retries, nothing
  nags. The item is evidence that a question exists, not a demand.

---

# [ ] M10f — Verification

Verification focuses on **epistemic invariants**:

## Promotion invariants

- every claim traces to ≥1 ledger candidate id,
- no claim exists without a recorded derivation (`NEW` /
  `REINFORCE` / approval id),
- auto-promotion never fires above its risk threshold (kind +
  threshold matrix test),
- concurrent duplicate promotions converge to one claim,
- a granted approval replays to the same claim, never a duplicate
  (journal idempotency across restart),
- reserved schema fields (`sourceType`, `summary`, `related[]`,
  `locked`, `emotional`, `activation`) stay null
  and behavior-neutral through every M10 path.

## Provenance invariants
- re-mining touches `lastSurfacedAt` only, never
  `firstAssertedAt`,
- extractor confidence and engine confidence never share a field,
- evidence lists reference, never embed, ledger rows,
- every evidence entry carries its candidate's role; mixed-origin
  lists never collapse to a single source,
- claim `origin` always equals the role of the `firstAssertedAt`
  evidence; agent-mined facts keep `role: 'assistant'` end to end,
- pre-M10 candidates without a stamped role read as `unknown`,
  never defaulted to either side.

## Durability invariants

- claims survive restart; pending approvals survive restart;
- ledger untouched by promotion (row counts + checksums stable
  across a promotion run).

## Retrieval invariants

- status/kind/category filters return exactly the matching set,
- contradicted claims stay queryable (no silent disappearance),
- prospective items list open questions with their conflicting
  values and origins.

---

# Scope Boundary

Keep the following **out of M10**:

- context injection into agent turns (M11),
- consolidation, decay, supersession, belief revision (M12),
- working / reflexive memory classes,
- graph edges and traversal,
- holographic reconstruction,
- vector embeddings (unless M10a lands RuVector with them;
  otherwise FTS5 + structured matching),
- auto-tuning of confidence (fixed re-estimation rule, documented),
- any `web-client/` changes,
- any M4 ledger writes.

## Named homes in M11 / M12 (v2 ideas, explicitly placed)

Nothing from the v2 lineage is dropped silently. Placement:

- **M11** — cross-memory comparison (uses the reserved `related[]`
  refs; comparison without traversal until links are populated),
  provenance recall lens (origin stamp enables excluding automated
  sources from interactive recall), familiarity gradient,
  provenance-safe context bands.
- **M12** — activation (salience orthogonal to confidence, incl.
  the loud-but-wrong divergence signal), temporal reasoning
  (timeline index over claim timestamps), consolidation (incl. gist
  formation), decay / forgetting (incl. deliberate-retirement
  endpoint and anti-decay-on-access), per-category lifecycles,
  source reliability (populates `sourceType`, certainty lock,
  agent-output dampening rule), evidence invalidation.
- **Decided in M10, not deferred** — `/undo` and message exclusion
  remove transcript rows from context but never delete them, and
  the ledger is immutable, so claims are stable under undo by
  construction. True evidence *invalidation* (a source retracted,
  not merely hidden) is M12 revision.
- **Explicitly not planned** — no proactive/unprompted recall (no
  Reverie equivalent), no salience-gated enrichment. All recall is
  reactive turn-time (M11). If that ever changes, it gets its own
  milestone — it is not smuggled into M11/M12.
- **M14 (persona, coherence-owned)** — persona lives in the
  coherence layer with its own SQLite store, evolving by
  internalizing self-facts. Seam: M10 identity-category claims are
  the *feed*; the persona layer curates and internalizes them
  (v2's L2 pattern: curated subset, trust-gated), and drift
  correction flows back as revision pressure, not direct edits.
- **Temporal perception (future dependency)** — M12's timeline
  index works on stored timestamps regardless, but a dedicated
  time-perception source (v2 placed it in EE) would enrich
  temporal anchoring. Not M10–M12 scope; recorded here so M12e
  isn't designed against a source that doesn't exist yet.

---

# Definition of Done

M10 is complete when ICOS can demonstrate:

> Given ledger candidates, the system derives beliefs with traced
> provenance and calibrated confidence, routes promotion through
> human approval by default (automatic assimilation opt-in only,
> once proven), handles contradiction without rewriting history,
> persists claims durably, and serves them for inspection — while
> the evidence ledger stays byte-identical and agent turns stay
> belief-free.

Completion requires verified unit, e2e, and live-run evidence
committed to `.reference/plans/evidence/`, plus clean `tsc` and
`eslint`. Do not claim M10 complete without this committed evidence.
