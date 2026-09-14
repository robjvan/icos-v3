# ICOS v3

<center>

![Status](https://img.shields.io/badge/Status-WIP-orange)
![Updated](https://img.shields.io/badge/Updated-2026%2F09%2F10-CBA701)
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

## What is ICOS?

**ICOS** (**I**SABEL **C**ognitive **O**perating **S**ystem) v3 is a from-scratch cognitive agent runtime built to investigate a simple question:

> **What is the minimum architecture required to give an agent persistent memory, useful knowledge, and meaningful agency?**

ICOS v3 is not a wrapper around an existing agent framework.

**The runtime is the harness.**

The agent loop, interaction layer, model boundary, session persistence, memory systems, skills, and future autonomous capabilities are being developed as parts of one deliberately small system.

The goal is not to reproduce a biological model of cognition. Instead, ICOS v3 is an experimental platform for identifying which architectural mechanisms actually produce useful changes in agent behaviour.

---

## Why v3?

ISABEL v2 explored a much more elaborate approach to cognitive architecture, incorporating biologically inspired mechanisms including persistent identity, multiple memory systems, state modulation, autonomous action selection, knowledge structures, and more.

That work was valuable, but it also exposed a problem:

**As the architecture became more complex, the architecture itself became a confounding variable.**

When an agent changed its behaviour, it became increasingly difficult to determine whether the change came from a particular mechanism or from its interaction with everything surrounding it.

ICOS v3 takes the opposite approach.

Start small.

Add capabilities deliberately.

Measure what changes.

Keep the system understandable.

> **If a capability cannot justify its complexity, it doesn't belong in the architecture yet.**

---

## Design Goals

ICOS v3 is being built around a few principles:

### Small enough to understand

The core should remain small enough that the entire agent loop can be understood without reconstructing a distributed system.

### Provider independent

The agent should not be coupled to a particular model provider.

ICOS communicates through an OpenAI-compatible interface, allowing the underlying model to be changed without rebuilding the runtime around it.

Current and planned providers include local and external model backends such as Ollama, llama.cpp, OpenCode, and OpenRouter.

### Evidence-driven

Capabilities are introduced incrementally.

Each milestone has a specific question, implementation target, and verification evidence.

The intention is to understand not only **whether something works**, but **what changed when it was introduced**.

### Experimental rather than general-purpose

ICOS is not intended to compete with general-purpose agent frameworks.

It exists primarily as a controlled environment for experimenting with agent architecture.

---

## Current Status

**M1–M7 are complete.**

The current system provides:

- A working conversation loop
- REST API
- Token streaming via SSE
- Persistent SQLite sessions
- FTS5 session recall
- Memory-candidate extraction
- An evidence ledger for extracted candidates
- Provider-independent LLM integration
- Slash commands
- Structured human approvals
- Structured clarification requests
- Standard-format skills support

The next milestone is **M8: Tools**.

Development is active and the architecture is expected to change substantially as new capabilities are introduced.

---

## Milestones

ICOS v3 is being developed as a sequence of increasingly capable experiments.

| Milestone | Question |
|---|---|
| **M1** | *Can it talk?* |
| **M2** | *Can it stream?* |
| **M3** | *Can it remember what happened?* |
| **M4** | *Can it notice potentially meaningful things?* |
| **M5** | *Can I change its brain without changing its body?* |
| **M6** | *Can a human interact with it properly?* |
| **M7** | *Can it acquire capabilities?* |
| **M8** | *Can it actually use those capabilities?* |
| **M9** | *Can it autonomously complete a task?* |
| **M10** | *Can it form knowledge?* |
| **M11** | *Can it retrieve and use that knowledge?* |
| **M12** | *Can that knowledge evolve?* |

Each milestone is tracked in:

```text
.reference/plans/
```

Verification evidence is maintained in:

```text
.reference/plans/evidence/
```

The intent is for the repository to document the development process rather than simply present the final architecture.

---

# Getting Started

## Requirements

ICOS v3 currently requires:

- **Node.js 24.13.0**
- **npm 11.6.2**
- An OpenAI-compatible LLM endpoint

The model itself does not need to run on the same machine.

Local models can be provided through software such as Ollama or llama.cpp, while remote providers can be used where appropriate.

---

## Installation

Clone the repository:

```sh
git clone https://git.exilelogic.ca/robjvan/icos-v3.git
cd icos-v3/apps/core
```

Install dependencies:

```sh
npm install
```

---

## Configuration

ICOS v3 uses environment variables for runtime configuration.

Create a local environment file from the provided example:

```sh
cp .env.example .env
```

Open `.env` and configure the LLM provider and other required settings.

For example:

```env
# LLM
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=<your-model>

# Application
PORT=3000
```

The exact variables and defaults may change as development continues, so **`.env.example` is the authoritative configuration reference**.

> **Do not commit your `.env` file.** It is intended for local configuration and may contain credentials.

---

## Run ICOS

From the repository root:

```sh
cd apps/core
npm run start
```

Once the application starts, open:

```text
http://localhost:3000
```

The development chat interface should be available there.

---

## Development Mode

For development with automatic reload:

```sh
npm run start:dev
```

Run the test suite with:

```sh
npm test
```

> Available scripts may change as the project develops. Run `npm run` to see the current project commands.

---

# Architecture

At its current stage, ICOS intentionally has a small architecture.

```text
                    ┌─────────────────────┐
                    │      User / UI      │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │ Interaction Layer   │
                    │ commands / approval │
                    │ clarification        │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │     Agent Loop      │
                    └──────────┬──────────┘
                               │
                ┌──────────────┼──────────────┐
                ▼              ▼              ▼
        ┌──────────────┐ ┌─────────────┐ ┌──────────────┐
        │   Session    │ │     LLM     │ │   Skills /   │
        │   Store      │ │   Boundary  │ │   Capabilities│
        └──────────────┘ └─────────────┘ └──────────────┘
                │
                ▼
        ┌──────────────────┐
        │ Memory Candidates│
        │ / FTS5 / SQLite  │
        └──────────────────┘
```

This diagram will evolve.

That's intentional.

The architecture should grow in response to demonstrated requirements rather than speculative future requirements.

---

# Repository Structure

The project is organized around the runtime and its experimental evidence.

```text
apps/
  core/                 # ICOS runtime

.reference/
  plans/                # Milestone plans
  plans/evidence/       # Verification and live-run evidence

.env.example            # Runtime configuration template
LICENSE                 # PolyForm Noncommercial License
COMMERCIAL-LICENSE.md   # Commercial licensing information
```

As the project grows, this section will be expanded to document significant architectural boundaries and development conventions.

---

# Research Direction

ICOS v3 is ultimately intended to support experiments around agent behaviour and architecture.

Some of the questions motivating future development include:

- Does persistent memory improve behavioural continuity?
- Does explicit epistemic memory reduce recurring errors?
- Does persistent persona remain stable across sessions and model changes?
- Does autonomous action selection produce useful agency?
- Which mechanisms improve capability versus merely increasing complexity?
- Can knowledge be maintained and evolved without requiring an increasingly complicated architecture?
- How much of an agent's behaviour can be explained by a relatively small runtime?

The architecture is therefore a means to an end.

**The interesting part is what changes when the architecture changes.**

---

# Project Status

ICOS v3 is an active personal research and software project.

It is **not production software** and should be considered experimental.

The architecture, APIs, configuration, and milestone definitions may change without maintaining backward compatibility.

The repository's milestone plans and evidence are intended to make those changes visible rather than hiding the experimental nature of the project.

---

# Contributing

ICOS v3 is primarily a personal research project and is not currently seeking additional maintainers.

That said, the project is public and feedback is welcome.

If you experiment with ICOS, find a problem, have a question about an architectural decision, or discover an interesting behavioural result, feel free to share it.

Questions are particularly useful when they challenge an assumption behind the architecture.

---

# License

ICOS v3 is available **free for noncommercial use** under the [PolyForm Noncommercial License 1.0.0](./LICENSE).

Commercial use requires a separate license.

See [COMMERCIAL-LICENSE.md](./COMMERCIAL-LICENSE.md) for details.

---

## Related Research

ICOS v3 is the continuation of research previously conducted under the ISABEL name.

The v2 work explored increasingly complex biologically inspired cognitive architecture.

ICOS v3 deliberately takes a different methodological approach: **start with a minimal architecture and reintroduce capabilities incrementally.**

The objective is not to build the most elaborate agent architecture possible.

It is to discover **which parts actually matter**.