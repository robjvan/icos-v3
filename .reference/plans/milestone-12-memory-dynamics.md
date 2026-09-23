# ICOS v3 — Milestone 12: Memory Dynamics

## Objective

M12 makes beliefs **alive over time** — the milestone where memory
stops being an append-only museum and starts behaving like memory:
strengthened by use, weakened by neglect, revised by evidence,
forgotten on purpose. M10 built claims; M11 read them; M12 owns
every mutation after birth.

### Research question

> Given a working belief store with a live recall path, can ICOS
> keep its beliefs calibrated — reinforcing what's re-observed,
> decaying what's neglected, revising what's contradicted, retiring
> what's dead, and tracking *salience* separately from *truth* —
> without silent rewriting and without the ledger ever moving?

The fundamental loop is:

```text
access / time / new evidence
    ↓
maintenance pass (async, never blocks turns)
    ↓
reinforce | decay | revise | retire  (exactly one per record per pass)
    ↓
history preserved (nothing rewritten, ever)
```

---

# Architectural Boundary

## M10 owns birth, M11 owns reading, M12 owns aging

- Claims are still created only through M10 promotion. M12 never
  invents beliefs.
- M11's recall path is untouched except as a *signal source*:
  `accessCount`/`lastAccessedAt` (which M11 writes, M12 interprets).
- The M4 ledger remains read-only. Maintenance touches claims and
  its own history tables only.

## Maintenance is async and boring

All dynamics run in a background pass (configurable cadence,
default hourly-ish). Nothing here blocks, fails, or slows a
conversation turn. A skipped or crashed pass is retried, never
half-applied — one record, one transition, one history row per pass.

## Web-client is out of scope

Same constraint as M10/M11: `core/` and `.reference/` only.

---

# [ ] M12a — Reinforcement (Consolidation)

Repeated observation strengthens — with a ceiling, not a ratchet
to certainty (v2's capped compounding):

- `REINFORCE` events (M10c derivation) increment `timesObserved`;
  the maintenance pass compounds a bounded boost
  (`+boost × min(cap, timesObserved)`, capped, never exceeding 1).
- **Gist formation** — N≥3 sufficiently similar episodes (same
  subject+predicate family, distinct evidence) may propose a
  generalized claim whose evidence is the episode set. The episodes
  stay; the gist references them. Generalization goes through the
  same HITL-default authority as M10 promotion.
- **Anti-decay-on-access** (v2's `mark_accessed`, re-adopted) —
  retrieval access raises resistance to the next decay pass. Being
  remembered protects memory. This is distinct from reinforcement:
  access without corroboration slows decay but never raises
  confidence.
- Cross-link maintenance: populate `related[]` where promotion
  touched shared triples (the traversal substrate M11 was promised).

---

# [ ] M12b — Decay and Forgetting

Forgetting is a first-class operation with two modes — passive and
chosen (v2's retrieval-shaped-forgetting lineage):

- **Passive decay** — exponential half-life on `confidence` for
  records unaccessed past a grace period. Category-scoped rates
  (a relationship edge decays differently than a preference —
  the v2 categorical-lifecycle lesson, using M10's `category`
  field). Floors per category; decay never deletes.
- **Deliberate retirement** — records unretrieved over a long
  window *and* below importance floors may be retired, explicitly,
  through an endpoint (`retired` finally gets its writer). Retirement
  is a status transition with history, not a delete. An explicit
  "forget this" instruction takes the same path with HITL authority.
- **Retrieval-shaped suppression** (gentle default) — on a
  successful recall, near-miss competitors within a similarity band
  lose *activation* (see M12d), not confidence. Recalling sharpens
  the target; it doesn't punish its neighbors' truth.
- Raw evidence is never decayed. The ledger doesn't move.

---

# [ ] M12c — Revision and Supersession

M10 recorded contradiction; M12 resolves it — slowly, visibly,
reversibly:

- **Winner-picking policy** (documented, fixed order): recency +
  authority + corroboration count. No model vibes. The losing claim
  goes `contradicted` with history intact (M10e behavior kept).
- **Supersession chain** — a revising claim links its predecessor;
  chains are walkable (`supersedes`/`supersededBy`). Chains never
  branch silently: one active head per identity triple.
- **Evidence invalidation** — the M10-deferred case: a source
  retracted (not merely hidden by `/undo` — true retraction, e.g.
  a correction turn or an invalidated session). Invalidation marks
  dependent claims for review (prospective items, M10e's queue)
  and decays their confidence by rule — never deletes them.
- **Clarification loop completion** — prospective items resolved
  by answer close with the outcome recorded (confirmed / corrected /
  dismissed); a correction is a revision with full provenance, not
  an edit.
- **Source reliability** — populate the reserved `sourceType`
  (direct_statement / inference / speculation / …) and track
  per-source reliability over time. Sources that repeatedly lose
  revisions decay in influence. Includes the v2 dampening rule:
  agent-output-derived claims carry a fixed dampening factor
  (configurable, default conservative) so the agent's own
  statements never inflate by self-echo.
- **Certainty lock** — the reserved `locked` field: claims above a
  high corroboration bar lock against decay (not against revision —
  evidence still wins). Unlock is itself a history event.

---

# [ ] M12d — Activation (Salience ≠ Truth)

The v2 idea with no other home: a per-claim `activation` dimension,
orthogonal to `confidence`, so the system can hold "I keep hearing
this, but it's wrong" (ACT-R lineage):

- `activation` decays with disuse on its own schedule, independent
  of confidence decay. Loud-but-wrong and quiet-but-right are both
  representable states.
- Retrieval spreads activation along `related[]` links,
  fan-capped so over-connected claims don't dominate (M11 feeds
  the walk; M12 owns the numbers).
- **Divergence signal** — activation persistently high while
  confidence decays is the "lurking wrong-but-loud" pattern: a
  candidate for explicit review (prospective item). This is the
  self-correction mechanism the whole dynamics milestone builds
  toward.
- Activation never gates recall alone and never promotes: it
  re-scores, it doesn't decide. (M11 ranking consumes it as one
  input among gates.)

---

# [ ] M12e — Temporal Reasoning

Claims have timestamps (M10); M12 navigates them:

- **Timeline index** — recall along *when*, not just *what*:
  "around time T", "before/after event E", "what else held during
  period P". A first-class query axis over claims + ledger refs.
- **Time-anchored cross-links** — when a revision lands, the
  co-occurring context around it is linked (the "I remember this
  because it was the X conversation" mechanism).
- **Temporal adjacency in ranking** — co-temporal claims boost
  each other at recall (consumed by M11 ranking as weights, owned
  here as data).
- Temporal queries are served through the read API alongside
  M10d/M11 endpoints; no new write paths.
- **Dependency note** — the timeline index works on stored
  timestamps regardless, but richer temporal anchoring ("during
  the X conversation," lived-time navigation) wants a dedicated
  time-perception source, which is not planned in M10–M12 (v2
  placed it in EE). M12e must not be designed against a source
  that doesn't exist yet; if temporal perception later lands,
  this slice is its first consumer.

---

# [ ] M12f — Verification

Dynamics are slow and easy to fake — verification is longitudinal:

- **Reinforcement bounds** — N observations approach the cap
  asymptotically, never exceed 1; single observations never jump.
- **Decay honesty** — half-life math verified against elapsed
  time; floors hold; decayed claims stay queryable with history.
- **Retirement** — only below both windows/floors (or explicit
  instruction + HITL); retired claims recoverable in history.
- **Revision integrity** — one active head per triple; loser
  intact; chains walkable end to end; invalidation marks but never
  deletes.
- **Activation orthogonality** — scripted loud-but-wrong scenario:
  high activation + decayed confidence raises a review item instead
  of recalling confidently.
- **Maintenance safety** — killed mid-pass recovers cleanly; no
  half-applied transitions; ledger checksums stable across every
  pass; turns unaffected (latency evidence during a pass).
- **Source reliability** — repeatedly-losing source demonstrably
  loses influence; dampening factor applies to agent-derived claims
  in the trace.

---

# Scope Boundary

Keep the following **out of M12**:

- new claim creation paths (M10 promotion stays the only birth),
- recall-surface changes (M11; M12 feeds ranking inputs only),
- populating the `emotional` block (still reserved — needs a mood
  source that doesn't exist yet),
- mood-weighted re-ranking (future),
- multi-hop traversal as a recall primitive (links exist;
  graph reasoning is future work),
- any `web-client/` changes,
- any M4 ledger writes (unchanged since M4 — the one permanent
  invariant across all three milestones).

---

# Definition of Done

M12 is complete when ICOS can demonstrate:

> Given a live belief store, the system strengthens what's
> re-observed (bounded), decays what's neglected (per category),
> revises what's contradicted (with walkable history), retires
> what's dead (explicitly, reversibly), tracks salience apart from
> truth, navigates beliefs in time, and distrusts unreliable
> sources — while the evidence ledger stays byte-identical, turns
> stay unblocked, and no belief is ever silently rewritten.

Completion requires verified unit, e2e, and live-run evidence
committed to `.reference/plans/evidence/`, plus clean `tsc` and
`eslint`. Do not claim M12 complete without this committed evidence.
