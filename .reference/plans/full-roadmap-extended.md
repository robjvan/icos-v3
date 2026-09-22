# Full Roadmap

> _Note: There is a really important conceptual jump around M22–M26._

**M1–M9: Can we make an agent?**

- Runtime, memory primitives, tools, execution, orchestration.

**M10–M15: Can we make an agent that knows things reliably?**

- Epistemic memory, retrieval, revision, provenance, drift, verification.

**M16–M21: Can we put that agent into an environment?**

- Communication, actions, sensors, events, subagents, KB stewardship.

**M22–M26: Can the agent observe and improve its own operation?**

- That's where things get genuinely research-y.

- Not _"give the LLM permission to modify itself"_, rather:

  ```text
  observe → measure → hypothesize → experiment → evaluate → propose change → verify → deploy/rollback.
  ```

**M27 onward starts asking the really nasty questions:**

- _Does cognition have to belong to one model?_
- _Does an agent have to live on one machine?_
- _Can an agent maintain goals over very long periods?_
- _What happens when the environment is physical rather than textual?_
- _Can experience become knowledge?_
- _Can knowledge gaps generate research?_
- _What exactly constitutes continuity when the model, hardware, software, and even instance change?_

---

## Build Milestones

- [x] ~~**M1: Build core**~~
  - [x] ~~Minimum conversation loop~~
  - [x] ~~No memory, skills, tools, etc.~~
  - [x] ~~Generic OpenAI-compatible LLM client (Ollama/vLLM) with 502/504 mapping~~
  - [x] ~~In-memory sessions, context builder, REST conversation endpoints~~
  - [x] ~~Minimum slice chat client served same-origin at `/`~~

- [x] ~~**M2: Streaming**~~
  - [x] ~~`LlmClient.chatStream` parses upstream SSE with 502/504 mapping and abort support~~
  - [x] ~~Test client renders tokens live; history stored on clean completion only~~
  - [x] ~~`POST /core/conversation/stream` emits meta/token/done/error events~~

- [x] ~~**M3: Persistent Session Store + FTS5**~~
  - [x] ~~Session persistence in SQLite store~~
  - [x] ~~Session sidebar in chat UI~~
  - [x] ~~SQLite transcript store (sessions/messages) with FTS5 index, triggers, rebuild~~
  - [x] ~~Async `SessionStore` over a repository boundary; `MAX_HISTORY` is context-only~~
  - [x] ~~`GET /core/sessions` and `GET /core/sessions/search` (phrase fallback for raw FTS errors)~~

- [x] ~~**M4: Memory Candidate Extraction**~~
  - [x] ~~LLM extractor with deterministic validation and message-level provenance~~
  - [x] ~~`memory_candidates` ledger in SQLite~~
  - [x] ~~Fire-and-forget enrichment that never blocks or fails conversation~~
  - [x] ~~Separate `MEMORY_LLM_*` model role behind the generic `LlmClient` boundary~~
  - [x] ~~`GET /core/memory-candidates` inspection endpoint~~

- [x] ~~**M5: External Providers**~~
  - [x] ~~Request contract carries conversation `sessionId` explicitly to `LlmClient`~~
  - [x] ~~Composable headers: `base + Bearer + static extras + UA + opencode-family` session affinity~~
  - [x] ~~Provider/model/headers/UA config with full `MEMORY_*` mirror, all env-driven~~
  - [x] ~~Provider-tagged errors, secrets-audited; zero provider branches in Core layers~~

- [x] ~~**M6: Interaction Protocol**~~
  - [x] ~~Deterministic slash commands (`/status /new /health /export /rename /thinking /timestamps /undo /fork /restart-runtime`)~~
  - [x] ~~Parser + registry/dispatch; commands bypass the LLM with structured `CommandResult`~~
  - [x] ~~Commands write no transcript rows and trigger no memory extraction~~
  - [x] ~~Structured approvals with explicit IDs and lifecycle (`pending → approved/rejected/expired/cancelled`)~~
  - [x] ~~UI approve/reject; LLM text can never approve; invalid transitions rejected~~
  - [x] ~~Clarifications/questions — free-form + structured choices, answer/cancel, resume semantics~~
  - [x] ~~Approval/clarification events isolated from the session transcript~~

- [x] ~~**M7: Skills — Discovery, Retrieval, Activation, Context Injection**~~
  - [x] ~~Filesystem catalog (`SKILL.md`, fail-closed validation, `~/.icos/skills/`)~~
  - [x] ~~Deterministic discovery + `/skills suggest` (no embeddings)~~
  - [x] ~~Three scopes — session-pinned, one-shot, turn-contextual — delimited injection, observability~~
  - [x] ~~Evidence: `milestone-7a/7b/7c-evidence-skills.md`; live Isabel discovers `icos-v3-stack`~~

- [ ] **M8: Tool Integration**
  - [ ] Tool contracts
  - [ ] Model tool-call protocol
  - [ ] Bounded execution
  - [ ] Approval and persistence
  - [ ] Invocation ledger
  - [ ] Durable call / result pairing
  - [ ] Idempotency and duplicate-call handling
  - [ ] Failure and unknown-outcome handling
  - [ ] Verification

- [ ] **M9: Agent Orchestration**
  - [ ] Agent run state
  - [ ] Tool selection and planning
  - [ ] Observation → action loop
  - [ ] Termination criteria
  - [ ] Execution budgets
  - [ ] Failure and recovery
  - [ ] Approval-aware planning
  - [ ] Loop / repetition protection
  - [ ] Cancellation and restart semantics
  - [ ] End-to-end verification

- [ ] **M10: Build the Epistemic Memory**
  - [ ] Epistemic claim model
  - [ ] Evidence → claim processing
  - [ ] Claim identity / deduplication
  - [ ] Provenance and evidence tracing
  - [ ] Contradiction / reinforcement
  - [ ] Epistemic storage model
  - [ ] RuVector substrate
  - [ ] Epistemic memory verification

- [ ] **M11: Memory Retrieval / Application**
  - [ ] Contextual recall
  - [ ] Memory ranking
  - [ ] Cross-memory comparison
  - [ ] Memory-aware context construction
  - [ ] Retrieval budgeting
  - [ ] Retrieval failure / uncertainty handling
  - [ ] Retrieval evaluation

- [ ] **M12: Memory Dynamics**
  - [ ] Consolidation
  - [ ] Supersession
  - [ ] Decay / forgetting
  - [ ] Temporal reasoning
  - [ ] Belief revision
  - [ ] Source reliability
  - [ ] Memory dynamics evaluation

- [ ] **M13: MCP Server Support**
  - [ ] MCP server boundary
  - [ ] Tool exposure
  - [ ] Resource / context exposure
  - [ ] MCP identity / permissions
  - [ ] Approval / execution integration
  - [ ] MCP verification

- [ ] **M14: Persistent Persona Maintenance**
  - [ ] Persona model
  - [ ] Persona provenance
  - [ ] Persona update / maintenance
  - [ ] Model-independent persona persistence
  - [ ] Persona consistency / adaptation
  - [ ] Persona recovery
  - [ ] Persona verification

- [ ] **M15: Drift Detection and Hallucination Mitigation**
  - [ ] Define observable failure modes
  - [ ] Establish behavioral / epistemic baselines
  - [ ] Distributional drift detection
    - [ ] Evaluate Wasserstein distance and simpler alternatives

  - [ ] Claim / evidence consistency checking
  - [ ] Secondary-model verification
  - [ ] Mitigation strategies
  - [ ] False-positive / false-negative analysis
  - [ ] Evaluation

- [ ] **M16: External Communication Integrations**
  - [ ] Discord integration
  - [ ] Email integration
  - [ ] SMS integration
  - [ ] Unified inbound / outbound message model
  - [ ] Identity and conversation mapping across channels
  - [ ] Channel-specific permissions and capabilities
  - [ ] Attachment / media handling
  - [ ] Rate limits, retries, and delivery state
  - [ ] Cross-channel context continuity
  - [ ] Integration verification

- [ ] **M17: Autonomous Agency and Action Execution**
  - [ ] Action registry
  - [ ] Action capability discovery
  - [ ] Action permissions and trust levels
  - [ ] Human approval policies
  - [ ] Goal → plan → action execution
  - [ ] Long-running agent runs
  - [ ] Action scheduling / deferred execution?
  - [ ] Action preconditions and postconditions
  - [ ] Action outcome verification
  - [ ] Failure, retry, and unknown-outcome handling
  - [ ] Action history and auditability
  - [ ] Agency boundaries and kill-switches

- [ ] **M18: External Sensory Reintegration**
  - [ ] Sensor abstraction layer
  - [ ] Microphone / audio input
  - [ ] Brio / camera input
  - [ ] Sensor box / environmental telemetry
  - [ ] Event-driven sensory observations
  - [ ] Multimodal observation representation
  - [ ] Sensor provenance and timestamps
  - [ ] Perception → memory integration
  - [ ] Perception → reactionary event integration
  - [ ] Continuous vs sampled observation?
  - [ ] Local preprocessing vs model inference?
  - [ ] Sensory verification and failure handling

- [ ] **M19: Subagent Support**
  - [ ] Subagent lifecycle
  - [ ] Task delegation protocol
  - [ ] Subagent capability / tool boundaries
  - [ ] Parent → child context transfer
  - [ ] Child → parent result / evidence transfer
  - [ ] Shared vs isolated memory
  - [ ] Subagent permissions and trust levels
  - [ ] Resource / token / time budgets
  - [ ] Nested delegation?
  - [ ] Parallel subagents?
  - [ ] Subagent failure / cancellation / timeout
  - [ ] Result verification and provenance

- [ ] **M20: Reactionary Events**
  - [ ] Event ingestion and normalization
  - [ ] Event registry / subscriptions
  - [ ] Event → agent run triggering
  - [ ] Event filtering and relevance evaluation
  - [ ] Event priority / urgency
  - [ ] Event deduplication and suppression
  - [ ] Reaction policies and permissions
  - [ ] Autonomous response without conversational initiation
  - [ ] Event-triggered tool / action execution
  - [ ] Event-triggered memory updates
  - [ ] Reaction cooldowns / loop prevention
  - [ ] Event provenance and audit history
  - [ ] Persistent event processing across restart
  - [ ] Continuous event streams vs discrete events?

- [ ] **M21: Knowledge-Base Stewardship**
  - [ ] Knowledge-base topology model
  - [ ] File / folder metadata extraction
  - [ ] Topological metadata maintenance
  - [ ] `INDEX.md` generation and maintenance
  - [ ] Project status generation / maintenance
  - [ ] "Last updated" / activity-based project state
  - [ ] Inbox ingestion
  - [ ] File classification and destination selection
  - [ ] Safe file moves / renames
  - [ ] Stale-file detection
  - [ ] Archive / `_prune` lifecycle
  - [ ] Duplicate / near-duplicate detection
  - [ ] Broken-link / reference detection
  - [ ] Orphaned-file detection
  - [ ] Metadata / index consistency verification
  - [ ] Stewardship change journal / audit trail
  - [ ] Human approval thresholds for destructive operations
  - [ ] Dry-run / proposed-change mode
  - [ ] Periodic autonomous stewardship runs
  - [ ] Small-model stewardship harness
  - [ ] Model-independent deterministic safeguards
  - [ ] Automatic topology reconstruction?
  - [ ] Knowledge-health scoring?
  - [ ] Cross-project knowledge relationships?

- [ ] **M22: Self-Observation and Introspection**
  - [ ] Runtime health observation
  - [ ] Agent behavior telemetry
  - [ ] Tool / action performance monitoring
  - [ ] Resource awareness
  - [ ] Execution tracing
  - [ ] Self-generated diagnostics
  - [ ] Behavioral anomaly detection
  - [ ] Internal state inspection
  - [ ] Reliable introspection boundaries?

- [ ] **M23: Self-Evaluation and Capability Assessment**
  - [ ] Capability registry
  - [ ] Capability → evidence mapping
  - [ ] Automated capability tests
  - [ ] Regression detection
  - [ ] Tool reliability measurement
  - [ ] Memory retrieval evaluation
  - [ ] Agent-loop evaluation
  - [ ] Confidence / uncertainty calibration
  - [ ] Self-generated test cases?
  - [ ] Capability-gap detection
  - [ ] Observed capability vs assumed capability

- [ ] **M24: Self-Maintenance**
  - [ ] Configuration integrity
  - [ ] Dependency / service health
  - [ ] Database maintenance
  - [ ] Index maintenance
  - [ ] Cache / artifact lifecycle
  - [ ] Failed-job recovery
  - [ ] Resource reclamation
  - [ ] Stale-process detection
  - [ ] Automated maintenance tasks
  - [ ] Maintenance approval policies
  - [ ] Repair vs modification boundaries
  - [ ] Deterministic maintenance safeguards

- [ ] **M25: Autopoiesis**
  - [ ] Self-inspection of the running codebase
  - [ ] Source / configuration / dependency inventory
  - [ ] Architecture and capability introspection
  - [ ] Detect bugs, deficiencies, inefficiencies, and capability gaps
  - [ ] Generate upgrade / optimization / feature proposals
  - [ ] Proposal → implementation plan
  - [ ] Stage proposed changes in an isolated environment
  - [ ] Automated build and test pipeline
  - [ ] Regression / behavioral verification
  - [ ] Evidence-backed change proposals
  - [ ] Human approval gate
  - [ ] Production candidate generation
  - [ ] Production candidate boot / health verification
  - [ ] Shadow / parallel execution?
  - [ ] Blue/green or generation-based deployment
  - [ ] Atomic instance promotion
  - [ ] State migration
  - [ ] Graceful instance handoff
  - [ ] Old-generation preservation
  - [ ] Automatic rollback
  - [ ] Failed-generation quarantine
  - [ ] Live-backup reconstruction
  - [ ] Versioned self-modification history
  - [ ] Complete provenance: observation → proposal → change → test → approval → deployment
  - [ ] Self-modification safety invariants
  - [ ] Operational continuity across self-generated transformations

- [ ] **M26: Experimental Learning**
  - [ ] Hypothesis representation
  - [ ] Experiment planning
  - [ ] Controlled experiment execution
  - [ ] Observation collection
  - [ ] Evidence evaluation
  - [ ] Hypothesis confirmation / rejection
  - [ ] Experimental provenance
  - [ ] Automated benchmark generation?
  - [ ] Autonomous experiment proposal?
  - [ ] Experiment → knowledge → capability improvement

- [ ] **M27: Multi-Model Cognition**
  - [ ] Model capability registry
  - [ ] Task → model selection
  - [ ] Specialist model roles
  - [ ] Cross-model verification
  - [ ] Model disagreement handling
  - [ ] Dynamic model routing
  - [ ] Local vs remote model selection
  - [ ] Model replacement without state loss
  - [ ] Cognitive ensemble vs single-primary architecture?

- [ ] **M28: Distributed ICOS**
  - [ ] Remote / redundant instances
  - [ ] Shared epistemic state
  - [ ] Instance identity
  - [ ] State synchronization
  - [ ] Distributed task delegation
  - [ ] Instance health / availability
  - [ ] Local autonomy during disconnection
  - [ ] Generation-aware state replication
  - [ ] Failover between instances
  - [ ] Federation vs centralized coordination?

- [ ] **M29: Long-Horizon Agency**
  - [ ] Persistent goals
  - [ ] Goal decomposition
  - [ ] Goal prioritization
  - [ ] Long-running plans
  - [ ] Progress tracking
  - [ ] Temporal reasoning
  - [ ] Interrupted-plan recovery
  - [ ] Goal abandonment / revision
  - [ ] Competing-goal resolution
  - [ ] Long-horizon memory integration

- [ ] **M30: Embodied Autonomy**
  - [ ] Physical action registry
  - [ ] Robot / actuator interfaces
  - [ ] Spatial state representation
  - [ ] Environmental perception
  - [ ] Navigation
  - [ ] Manipulation
  - [ ] Physical-world verification
  - [ ] Safety envelopes
  - [ ] Physical-world recovery
  - [ ] Simulated embodiment before physical deployment?

- [ ] **M31: Situated Learning**
  - [ ] Persistent environment models
  - [ ] Spatial memory
  - [ ] Sensor → event → memory pipeline
  - [ ] Action → observation feedback
  - [ ] Environmental state estimation
  - [ ] Experience-based adaptation
  - [ ] Physical affordance learning?
  - [ ] Environment-specific knowledge formation

- [ ] **M32: Open-Ended Knowledge Acquisition**
  - [ ] Source discovery
  - [ ] Source evaluation
  - [ ] Automated research tasks
  - [ ] Evidence collection
  - [ ] Claim extraction
  - [ ] Cross-source comparison
  - [ ] Contradiction discovery
  - [ ] Knowledge-gap detection
  - [ ] Research prioritization
  - [ ] Autonomous research campaigns?
  - [ ] Explicit epistemic limits

- [ ] **M33: Self-Directed Research**
  - [ ] Detect unanswered questions
  - [ ] Generate research hypotheses
  - [ ] Select research methods
  - [ ] Acquire evidence
  - [ ] Run experiments
  - [ ] Update epistemic memory
  - [ ] Revise hypotheses
  - [ ] Produce research artifacts
  - [ ] Reproducibility records
  - [ ] Human review boundaries
  - [ ] Identify questions worth investigating autonomously?

- [ ] **M34: Cognitive Continuity**
  - [ ] Runtime-independent identity state
  - [ ] Model-independent memory
  - [ ] Model replacement
  - [ ] Hardware migration
  - [ ] Instance migration
  - [ ] State reconstruction
  - [ ] Continuity verification
  - [ ] Capability changes across generations
  - [ ] Define continuity across self-modification

- [ ] **M35: ICOS Ecosystem**
  - [ ] External agents
  - [ ] External knowledge systems
  - [ ] Shared tool registries
  - [ ] Agent-to-agent protocols
  - [ ] Federated epistemic exchange
  - [ ] Trust / provenance between agents
  - [ ] Delegated authority
  - [ ] Inter-agent negotiation?
  - [ ] Multi-agent research / engineering?

- [ ] **M36: Open-Ended Research**
  - [ ] Re-evaluate architectural assumptions
  - [ ] Identify unexplained system behavior
  - [ ] Generate new research questions
  - [ ] Design experiments targeting those questions
  - [ ] Retire failed mechanisms
  - [ ] Introduce new capabilities without breaking established invariants
  - [ ] Maintain an explicit research frontier
  - [ ] Define the next generation of ICOS
