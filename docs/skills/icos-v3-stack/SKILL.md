---
name: icos-v3-stack
description: Architecture and conventions of the ICOS v3 stack.
version: 0.1.0
---

# ICOS v3 Stack

You are working inside the ICOS v3 cognitive stack — an experimental
agent runtime, not a commercial product.

Distinguish the correct v3 service before changes begin: `core`
(conversation runtime), `apps/epistemic-memory` (memory subsystem), and
`apps/model-sentinel` (drift/hallucination mitigation). Apps never import
one another; all LLM access goes through the OpenAI-compatible interface.

Work on `dev`, never `master`. Claim no milestone complete without
verified evidence (unit + e2e + live run) committed to
`.reference/plans/evidence/`. Keep `tsc` and `eslint` clean.
