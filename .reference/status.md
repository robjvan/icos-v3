# ICOS v3 Status Tracking

> *Updated Sep 10, 2026*

## Implemented

- [x] M1: Build core
  - [x] Minimum conversation loop
  - [x] No memory, skills, tools, etc.
  - [x] Generic OpenAI-compatible LLM client (Ollama/vLLM) with 502/504 mapping
  - [x] In-memory sessions, context builder, REST conversation endpoints
  - [x] Minimum slice chat client served same-origin at `/`

- [x] M2: Streaming
  - [x] LlmClient.chatStream parses upstream SSE with 502/504 mapping and abort support
  - [x] Test client renders tokens live; history stored on clean completion only
  - [x] `POST /core/conversation/stream` emits meta/token/done/error events

- [x] M3: Persistent Session Store + FTS5
  - [x] Session persistence in sqlite store
  - [x] Session sidebar in chat ui
  - [x] SQLite transcript store (sessions/messages) with FTS5 index, triggers, rebuild
  - [x] Async SessionStore over a repository boundary; MAX_HISTORY is context-only
  - [x] `GET /core/sessions` and `GET /core/sessions/search` (phrase fallback for raw FTS errors)

- [x] M4: Memory Candidate Extraction
  - [x] LLM extractor with deterministic validation and message-level provenance
  - [x] memory_candidates ledger in SQLite
  - [x] Fire-and-forget enrichment that never blocks or fails conversation
  - [x] Separate MEMORY_LLM_* model role behind the generic LlmClient boundary
  - [x] `GET /core/memory-candidates` inspection endpoint

## Designed

-

## Planned

- [x] M3/M4 Cleanup: Split session and memory candidate DBs
  - Session store: `~/.icos/data/sessions.db`
  - Memory candidates: `~/.icos/data/memories.db`
  - One-time row-level migration from legacy `core.sqlite`, provenance preserved
- [ ] M5: External LLM Provider Compatibility (OpenRouter, Opencode Go/Zen)
```
Core
  │
  └── LlmClient
      ├── Ollama
      ├── llama.cpp
      ├── OpenRouter
      └── OpenCode/Zen/Go
```
- [ ] M6: Skill usage 
  - Skill catalog: `~/.icos/skills/`
- [ ] M7: Tools integration
- [ ] M8: First complete agent loop
- [ ] M9: Build the epistemic memory
  - [ ] M9a: Epistemic Claim Model
  - [ ] M9b: Evidence → Claim processing
  - [ ] M9c: Contradiction / reinforcement
  - [ ] M9d: RuVector substrate
- [ ] M10: Memory retrieval / application
  - [ ] M10a: Contextual recall
  - [ ] M10b: Memory ranking
  - [ ] M10c: Cross-memory comparison
  - [ ] M10d: Memory-aware context construction
- [ ] M11: Memory dynamics
  - [ ] M11a: Consolidation
  - [ ] M11b: Supersession
  - [ ] M11c: Decay/forgetting
  - [ ] M11d: Temporal reasoning
  - [ ] M11e: Belief revision

## Deferred

- [ ] Subagents
- [ ] Episodic consolidation
- [ ] Calendar integration
- [ ] Knowledge-source synchronization

## Research / Open Questions

- Holographic reconstruction
- Long-term autonomous planning
- Embodied perception

## Validation

- [x] Provider independence demonstrated
- [x] Persistence across restart
- [x] Streaming
- [x] Extraction failure isolation
- [x] Separate primary/extraction model roles
- [ ] Tool execution under provider failure (M7)
- [ ] Full agent-loop test (M8)
- [ ] Long-running session test (TBD)