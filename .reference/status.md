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
  - [x] `LlmClient.chatStream` parses upstream SSE with 502/504 mapping and abort support
  - [x] Test client renders tokens live; history stored on clean completion only
  - [x] `POST /core/conversation/stream` emits meta/token/done/error events

- [x] M3: Persistent Session Store + FTS5
  - [x] Session persistence in sqlite store
  - [x] Session sidebar in chat ui
  - [x] SQLite transcript store (sessions/messages) with FTS5 index, triggers, rebuild
  - [x] Async `SessionStore` over a repository boundary; `MAX_HISTORY` is context-only
  - [x] `GET /core/sessions` and `GET /core/sessions/search` (phrase fallback for raw FTS errors)

- [x] M4: Memory Candidate Extraction
  - [x] LLM extractor with deterministic validation and message-level provenance
  - [x] `memory_candidates` ledger in SQLite
  - [x] Fire-and-forget enrichment that never blocks or fails conversation
  - [x] Separate `MEMORY_LLM_*` model role behind the generic `LlmClient` boundary
  - [x] `GET /core/memory-candidates` inspection endpoint

- [x] M5: External Providers
  - [x] Request contract carries conversation sessionId explicitly to `LlmClient`
  - [x] Composable headers: `base + Bearer + static extras + UA + opencode-family` session affinity
  - [x] Provider/model/headers/UA config with full `MEMORY_*` mirror, all env-driven
  - [x] Provider-tagged errors, secrets-audited; zero provider branches in Core layers

## Designed

-

## Planned

- [ ] M6: Interaction protocol
  - [ ] M6a: slash commands
    - notes: `.reference/notes/slash-commands.md`
  - [ ] M6b: approvals
  - [ ] M6c: clarifying and questions
- [ ] M7: Skill usage
  - intended skills catalog location: `~/.icos/skills/`
- [ ] M8: Tools integration
- [ ] M9: First complete agent loop
- [ ] M10: Build the epistemic memory
  - [ ] M10a: Epistemic Claim Model
  - [ ] M10b: Evidence → Claim processing
  - [ ] M10c: Contradiction / reinforcement
  - [ ] M10d: RuVector substrate
- [ ] M11: Memory retrieval / application
  - [ ] M11a: Contextual recall
  - [ ] M11b: Memory ranking
  - [ ] M11c: Cross-memory comparison
  - [ ] M11d: Memory-aware context construction
- [ ] M12: Memory dynamics
  - [ ] M12a: Consolidation
  - [ ] M12b: Supersession
  - [ ] M12c: Decay/forgetting
  - [ ] M12d: Temporal reasoning
  - [ ] M12e: Belief revision

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