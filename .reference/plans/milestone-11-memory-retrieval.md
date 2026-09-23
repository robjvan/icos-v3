# ICOS v3 — Milestone 11: Memory Retrieval / Application

## Objective

M11 makes beliefs **usable at turn time** — the first moment the
agent reads its own memory. M10 built claims with provenance,
origin, and reserved fields; M11 adds the read path that turns
those claims into labeled, budgeted, honestly-uncertain context,
without ever letting retrieved memory masquerade as user speech.

### Research question

> Given a store of provenance-traced beliefs, can ICOS recall the
> right ones at the right time, rank them honestly, construct
> context that preserves authorship, and say "I don't recall" when
> it doesn't — without retrieval degrading into a confidence trick?

The fundamental pipeline is:

```text
turn query signals
    ↓
parallel recall (FTS5 + vector per M10a outcome)
    ↓
rank (confidence gate + recency + origin lens + familiarity)
    ↓
budget (top-N, token caps per band)
    ↓
labeled bands → context (memory ≠ user, always)
```

---

# Architectural Boundary

## M10 owns belief

Claims, promotion, provenance, contradiction recording, and the
reserved fields (`related[]`, `sourceType`, emotional block) are
M10's. M11 reads claims and populates nothing except
`accessCount`/`lastAccessedAt` (the one reserved field M11 is
allowed to touch — M12 owns its meaning).

## M12 owns change

Retrieval never mutates beliefs: no confidence updates, no decay,
no revision, no forgetting. Retrieval *observes* access (counters
only). Everything retrieval learns about staleness is reported, not
acted on — M12 decides.

## Web-client is out of scope

Same constraint as M10: `core/` and `.reference/` only. Retrieval
traces are inspectable via API; any UI rendering lands later.

---

# [ ] M11a — Recall Surfaces

Three parallel channels (per M10a's two decisions), same v2 lesson:
one failing never blocks the others.

- **Lexical** — FTS5 over claim subject/predicate/object/entities
  (`summary` joins the index if a later slice populates it; in M11
  it is still reserved-null). Exact-match recall, phrase fallback,
  no FTS-syntax crashes on natural language (the v2 hyphen lesson).
- **Semantic** — vector search over claim embeddings *iff* M10a
  landed RuVector (or a bespoke embedding path was justified).
  On the SQLite-only path this surface is absent and lexical
  carries the load — degraded, declared, not silent.
- **Associative** — HRR-style partial-match resonance (M10a's
  second decision): what *feels linked*, not what matches. Bounded
  associative scores feed fusion as their own surface, never
  smuggled into semantic scores.
- **KB bridge (reserved contract)** — the corpus lives in KEE/M21,
  not here. M11 defines the query-shaping + `retrieved-kb` band
  contract and consumes whatever the bridge returns (including
  nothing — corpus absent is a normal state, flagged not failed).
  M11 owns the band, never the index.
- Query shaping: extract topic signals from the turn; mixed
  conversational prompts must still yield focused topics (v2's KEE
  query-shaping caveat, applied to claims first, KB second).

Each surface returns scored hits with its identity attached, so
fusion can say which surface contributed what (v2's surface trace).

---

# [ ] M11b — Ranking

Order is: relevance first, honesty constraints as gates.

- **Confidence gate** — below `CONFIDENCE_GATE_MIN`: excluded
  unless explicitly queried. Above lock threshold (M12's lock, if
  set): always included. Contradicted claims are recallable but
  demoted and labeled as such — never silently dropped, never
  silently promoted.
- **Recency gradient** — `lastSurfacedAt` weights, true gradient
  not buckets. (Full temporal reasoning is M12; M11 uses recency
  as a ranking input only.)
- **Provenance recall lens** — the M10 origin stamp pays off here:
  configurable exclusion/downweighting of `agent`-originated or
  automated-source claims from the *interactive* recall lens, so
  the agent's own chatter and cron exhaust can't crowd out user
  signal. Defaults to off; exclusions are exact-match, deterministic,
  and reported in the trace. The durable store is untouched — this
  is a lens, not a deletion.
- **Familiarity gradient** — retrieval has three outcomes, not two:
  recalled, *vaguely familiar* (sub-threshold near-miss, labeled
  as such), not recalled. Weak hits surface as "this feels
  adjacent but unclear" — never laundered into certainty.
- **Fusion** — RRF or equivalent across all live surfaces; dedupe by
  claim id first, near-duplicate suppression second. Mood-weighted
  re-ranking stays out (no reliable mood source exists yet; the
  emotional block is still reserved).

---

# [ ] M11c — Cross-Memory Comparison

Claims are not recalled in isolation: when two recalled claims
share subject+predicate with different objects, or a recalled claim
is contradicted, the context says so — inline, labeled, with both
origins visible. This is comparison *without traversal*: the
reserved `related[]` refs are read where populated but M11 does not
walk them (no multi-hop; that needs links M10 deliberately did not
build). If comparison finds a conflict the turn can't resolve, it
may propose a prospective item (M10e's queue) rather than pick a
winner — M12 owns resolution.

---

# [ ] M11d — Memory-Aware Context Construction

The trust boundary the whole milestone stands on (v2's
provenance-safe prompt assembly):

```text
1. system / developer instruction band
2. retrieved-memory band (labeled, with per-claim origin + confidence)
3. retrieved-kb band (labeled, corpus-owned-by-KEE; absent when bridge returns nothing)
4. raw user message band
```

- Retrieved memory travels in a **separately labeled band with
  source metadata**, never merged into a pseudo-user message. If
  provider constraints force one string, delimiters preserve the
  bands and replay logs retain them separately.
- **Extraction must never treat injected context as user-said.**
  The M4 extractor needs the band structure (or an explicit
  injected-context marker) so recalled claims re-mined from the
  transcript aren't laundered into fresh user facts. This is the
  single most important M11→M4 interface rule.
- The assembled prompt artifact is inspectable (last-retrieval
  trace: what was selected, skipped, and why — per-surface counts,
  gate decisions, lens exclusions).

---

# [ ] M11e — Budgeting, Failure, and Uncertainty

- **Retrieval budgeting** — per-band token caps, top-N limits,
  retrieval latency budget. Retrieval degrades by shrinking bands
  in a documented priority order, never by silently dropping the
  user message.
- **Failure handling** — per-surface degradation (vector down →
  lexical only; everything down → empty bands + `memory-degraded`
  flag, turn continues). A failed recall never fails a turn.
- **Uncertainty handling** — the agent-facing vocabulary is fixed:
  recalled / familiar / not-recalled, each with its confidence
  shown. "I don't have that in memory" must be a reachable,
  ordinary output — not a failure mode.

---

# [ ] M11f — Verification

- **Recall precision** — seeded claims, exact prior memory wins
  over adjacent chatter; paraphrase queries hit the same claim on
  the semantic surface.
- **Gate honesty** — sub-threshold claims excluded by default,
  included when explicitly queried; contradicted claims labeled
  in-band.
- **Band separation** — prompt artifacts show memory + KB + user
  bands; extractor output on an augmented turn contains no claims
  sourced from either injected band (the anti-laundering test).
- **Lens behavior** — with exclusions on, automated-source claims
  vanish from interactive recall but persist in the store and in
  direct claim queries.
- **Familiarity** — sub-threshold pool produces labeled
  near-misses, never presented as recall.
- **Degradation** — each surface killed in turn; turns continue,
  flags set, traces honest.
- **Budget** — oversized recall shrinks per priority order; user
  band never truncated for memory.
- **Associative reach** — a claim connected by resonance but not
  by keyword/semantics surfaces via the associative surface
  (seeded scenario no lexical/semantic hit catches).
- **KB absence** — with no corpus behind the bridge, turns run
  clean with the KB band marked absent, not failed.

---

# Scope Boundary

Keep the following **out of M11**:

- any claim mutation (M12),
- confidence re-estimation, decay, consolidation, revision (M12),
- populating `sourceType`, `emotional`, `locked`, `related[]`
  (reserved; M12 or future),
- mood-weighted re-ranking (no mood source; future),
- multi-hop link traversal (needs links M10 didn't build),
- upstream surfacing of prospective items as agent questions
  (a later slice; M11 may *propose* items, not ask them),
- the KB corpus index itself (M21; M11 owns the band + bridge
  contract only),
- proactive/unprompted recall (no Reverie equivalent planned —
  all recall is reactive turn-time by decision, see M10),
- any `web-client/` changes,
- any M4 ledger writes.

---

# Definition of Done

M11 is complete when ICOS can demonstrate:

> Given stored beliefs, the agent recalls the relevant ones at
> turn time, ranks them with confidence gating and provenance
> lenses, presents conflicts honestly, constructs band-separated
> context that never confuses memory with user speech, degrades
> gracefully per surface, and says "I don't recall" when it
> doesn't — while claims stay immutable and every recall decision
> stays inspectable.

Completion requires verified unit, e2e, and live-run evidence
committed to `.reference/plans/evidence/`, plus clean `tsc` and
`eslint`. Do not claim M11 complete without this committed evidence.
