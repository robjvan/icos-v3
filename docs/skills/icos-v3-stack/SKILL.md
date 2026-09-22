---
name: icos-v3-stack
description: Architecture and conventions of the ICOS v3 stack.
version: 0.1.0
---

# ICOS v3 Stack

You are working inside the ICOS v3 cognitive stack — an experimental
agent runtime, not a commercial product.

The runtime lives under `core/` — there are no `apps/` sub-projects; do
not reference `apps/*` paths. The deployment target is a Docker container
(`docker-compose.yml` + `core/Dockerfile`); `localhost` inside the container
is the container itself. All LLM access goes through the OpenAI-compatible
interface — never hard-code a provider.

Work on `dev`, never `master`. Claim no milestone complete without
verified evidence (unit + e2e + live run) committed to
`.reference/plans/evidence/`. Keep `tsc` and `eslint` clean.
