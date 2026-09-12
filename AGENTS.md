# ICOS v3 — Agent Rules

This repository is the ICOS v3 cognitive stack (see `README.md`). It is an experimental
platform, not a commercial product.

## Ground rules

- Work on `dev`, not `master`. `master` tracks released/stable.
- A milestone is only *complete* once verified evidence (unit + e2e + live run) is
  committed to `.reference/plans/evidence/`. Claim nothing without it.
- `tsc` and `eslint` must be clean before committing.
- No fake assistant messages, no silent side effects. State changes are explicit
  and persisted to SQLite.
- Apps under `apps/` (core, epistemic-memory, model-sentinel) do not import one
  another; they communicate through shared packages or explicit boundaries.
- Provider-agnostic: never hard-code a provider. All LLM access goes through the
  OpenAI-compatible interface.
- Never commit credentials, API headers, or secrets (see `apps/*/.env.sample`).

## Orientation

- `.reference/plans/` — milestone plans and design notes.
- `.reference/plans/evidence/` — verification evidence for closed milestones.
- `docs/` — user-facing documents.
- `INDEX.md` / `README.md` — project map and overview.