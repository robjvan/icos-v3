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
- The runtime lives under `core/`. There are no `apps/` sub-projects; do not
  reference `apps/*` paths.
- Deployment target is a **Docker container** (`docker-compose.yml` +
  `core/Dockerfile`). Whether it runs on localhost or on the local network is
  up to the user — never assume bare-metal deployment. Keep the compose path
  working: `docker compose up --build` should launch a healthy `icos-v3-core`.
- Provider-agnostic: never hard-code a provider. All LLM access goes through the
  OpenAI-compatible interface. Remember `localhost` inside the container is the
  container itself — document `host.docker.internal` / LAN addresses where
  relevant instead of assuming host-local URLs resolve in-container.
- Never commit credentials, API headers, or secrets (see `core/.env.sample`;
  `core/.env` is local-only and must stay uncommitted).

## Orientation

- `.reference/plans/` — milestone plans and design notes.
- `.reference/plans/evidence/` — verification evidence for closed milestones.
- `docs/` — user-facing documents.
- `docker-compose.yml` — supported launch path (`icos-v3-core` service).
- `core/Dockerfile` — dev server image used by compose.
- `core/.env.sample` — authoritative runtime configuration reference.
- `INDEX.md` / `README.md` — project map and overview.