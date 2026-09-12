# ICOS v3

<center>

![Status](https://img.shields.io/badge/Status-WIP-orange)
![Updated](https://img.shields.io/badge/Updated-2026/09/10-CBA701)
![Tests](https://img.shields.io/badge/Tests-Passing-brightgreen)

![Node.js](https://img.shields.io/badge/Node.js-24.13.0-red)
![NPM](https://img.shields.io/badge/npm-11.6.2-CB0200?logo=npm&logoColor=CB0200)
![NestJS](https://img.shields.io/badge/NestJS-11.0.1-EA2F59?logo=nestjs&logoColor=EA2F59)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7.3-blue?logo=typescript)

![REST](https://img.shields.io/badge/REST-API-lavender)
![SSE](https://img.shields.io/badge/Streaming-SSE-lavender)
![OpenAI Compatible](https://img.shields.io/badge/OpenAI-Compatible-steelblue?logo=openaigym)
![Providers](https://img.shields.io/badge/LLM-Provider--Independent-blueviolet?logo=lmstudio)

![SQLite](https://img.shields.io/badge/SQLite-FTS5-90D4F4?logo=sqlite&logoColor=90D4F4)
![Memory](https://img.shields.io/badge/Memory-Epistemic%20%7C%20Experimental-purple)

![Github](https://img.shields.io/badge/Coffees-Many-88502A?logo=coffeescript&logoColor=white)
</center>

---
## Description

ICOS (**I**SABEL **C**ognitive **O**perating **S**ystem) **v3** is a from-scratch cognitive agent runtime built to answer one question: *what is the minimum architecture required to give an agent real epistemic memory and agency?*

Unlike a wrapper around an existing agent framework, v3 *is* the harness — the runtime and the cognitive stack are a single piece, with no seam between them. It speaks OpenAI-compatible endpoints, so the model backend (ollama, llama.cpp, opencode, openrouter) is swappable without re-plumbing.

It is an experimental platform, not a product. It exists to serve one user's actual needs — my own — and to test whether the load-bearing parts of an agent (memory, persistence, interaction, autonomy) can be built small and understood completely. Every milestone is tracked in `.reference/plans/`, with verified evidence (unit + e2e + live runs) committed to `.reference/plans/evidence/`.

**Status:** M1–M6 complete — a working conversation loop with token streaming, persistent SQLite sessions with FTS5 recall, memory-candidate extraction with an evidence ledger, a provider-agnostic LLM boundary, and a deterministic interaction layer (slash commands, structured human approvals, structured clarifications). Next: M7 (skill usage).

## License

Free for noncommercial use under the [PolyForm Noncommercial License 1.0.0](./LICENSE). Commercial use requires a separate license — see [COMMERCIAL-LICENSE.md](./COMMERCIAL-LICENSE.md).

## Features and Capabilities

## Subsystem Documents

- `docs/readme-core.md` - outlines the ICOS core agent runtime
- `docs/readme-memory.md` - outlines the ICOS memory subsystems
- `docs/readme-sentinel.md` - outlines the ICOS model sentinel subsystem

## Milestones

- **M1 →** *Can it talk?*
- **M2 →** *Can it stream?*
- **M3 →** *Can it remember what happened?*
- **M4 →** *Can it notice potentially meaningful things?*
- **M5 →** *Can I change its brain without changing its body?*
- **M6 →** *Can a human interact with it properly?*
- **M7 →** *Can it acquire capabilities?*
- **M8 →** *Can it actually use those capabilities?*
- **M9 →** *Can it autonomously complete a task?*
- **M10 →** *Can it form knowledge?*
- **M11 →** *Can it retrieve/use that knowledge?*
- **M12 →** *Can that knowledge evolve?*