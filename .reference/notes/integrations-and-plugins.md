# ICOS v3 Plugin & Integration System

## Purpose

The ICOS Plugin and Integration System provides a controlled mechanism for extending ICOS with external capabilities, information sources, services, applications, devices, and physical systems.

The system is intended to support both ordinary software capabilities and eventually embodied environments containing sensors, appliances, robots, and other physical systems.

The architecture must allow external systems to participate in ICOS in two fundamentally different ways:

1. **Capabilities** — things ICOS can actively use or invoke.
2. **Knowledge sources** — things that continuously provide observations or state to ICOS memory.

A single extension may provide either or both.

---

# Conceptual Model

ICOS extensions are divided conceptually into two categories.

## Plugins

Plugins primarily extend the **software capabilities** of ICOS.

Examples:

* Calendar
* Email
* Web search
* Task management
* GitHub
* Documentation systems
* Development tools
* Communication platforms
* Research services
* Specialized software
* Data processing services

A plugin generally exists to give ICOS an additional software capability or information source.

Examples:

```text
Calendar Plugin
Email Plugin
GitHub Plugin
Web Plugin
Research Plugin
Development Plugin
```

---

## Integrations

Integrations primarily connect ICOS to **external systems and the physical world**.

Examples:

* Smart appliances
* Washing machines
* Kitchen appliances
* Cameras
* Microphones
* Smart home systems
* Industrial equipment
* Robot arms
* Mobile robots
* Environmental sensors
* Motors and actuators
* Vehicle systems
* Other embodied hardware

Examples:

```text
Washing Machine Integration
Kitchen Robot Integration
Camera Integration
Home Assistant Integration
Robot Arm Integration
Mobile Robot Integration
```

An integration may expose software APIs, but its defining characteristic is that it represents an external system or environment that exists independently of ICOS.

---

# Plugins and Integrations Are Not Mutually Exclusive

The distinction between plugins and integrations is primarily conceptual and organizational rather than a requirement for two completely separate technical frameworks.

Both should conform to a common extension model where practical.

```text
                    ICOS
                     │
              Extension System
                     │
           ┌─────────┴─────────┐
           │                   │
        Plugins           Integrations
           │                   │
      software-first       world-first
```

A plugin may consume an integration.

For example:

```text
Kitchen Planning Plugin
        │
        ├── Calendar
        ├── Recipe Knowledge
        ├── Pantry Data
        └── Kitchen Robot Integration
```

The plugin determines **what should be prepared**.

The integration determines **how the physical kitchen equipment is observed or controlled**.

---

# Extension Model

Every extension should expose a manifest describing what it provides.

Conceptually:

```typescript
interface ICOSPlugin {

    manifest(): PluginManifest;

    capabilities(): Capability[];

    connect(): Promise<void>;

    disconnect(): Promise<void>;

    onEvent?(
        event: PluginEvent
    ): Promise<void>;

    sync?(): Promise<SyncResult>;
}
```

The exact interface is subject to implementation refinement.

The important principle is that an extension explicitly declares its capabilities and available data flows rather than requiring Core to understand implementation-specific details.

---

# Plugin Manifest

A manifest describes an extension to the runtime.

Conceptually:

```typescript
interface PluginManifest {

    id: string;

    name: string;

    version: string;

    type: "plugin" | "integration";

    capabilities: CapabilityDefinition[];

    knowledgeSources?: KnowledgeSourceDefinition[];

    configuration?: ConfigurationSchema;

}
```

Example:

```yaml
id: calendar
name: Calendar
type: plugin

capabilities:
  - calendar.read
  - calendar.create
  - calendar.modify
  - calendar.delete

knowledgeSources:
  - calendar.events
```

A physical integration might look like:

```yaml
id: washing-machine
name: Smart Washing Machine
type: integration

capabilities:
  - appliance.status
  - appliance.start
  - appliance.stop

knowledgeSources:
  - appliance.state
  - appliance.events
```

---

# Capabilities

A capability represents something ICOS can actively perform.

Examples:

```text
calendar.read
calendar.create
calendar.modify

email.read
email.send

web.search

filesystem.read

washing-machine.status
washing-machine.start

kitchen-arm.move
kitchen-arm.grab
kitchen-arm.cook

robot.navigate
robot.speak
robot.observe
```

Conceptually:

```typescript
interface Capability {

    name: string;

    description: string;

    schema: CapabilitySchema;

    execute(
        request: CapabilityRequest
    ): Promise<CapabilityResult>;

}
```

Capabilities are invoked by Core.

The extension is responsible for performing the operation.

Core remains responsible for deciding whether and why the capability should be used.

---

# Knowledge Sources

A knowledge source provides information about the world to ICOS.

This is distinct from an active capability.

For example:

```text
calendar.read
```

is a capability.

```text
calendar.events
```

is a knowledge source.

Likewise:

```text
washing-machine.start
```

is a capability.

```text
washing-machine.state
```

is a knowledge source.

A single extension can provide both.

---

# Knowledge Feed

Knowledge sources should be capable of feeding information directly into the ICOS memory system.

The goal is to avoid requiring every interaction to query an external system through live RAG.

Instead, external state can become part of ICOS's continuously maintained knowledge.

```text
External System
      │
      │ change / event / polling
      ▼
   Extension
      │
      ▼
  Observation
      │
      ▼
epistemic-memory
      │
      ├── semantic knowledge
      ├── episodic history
      ├── temporal state
      ├── relationships
      └── provenance
              │
              ▼
           RuVector
```

This allows ICOS to reason over information that originated outside the system without necessarily contacting the external system during every cognitive cycle.

---

# Knowledge Source Contract

Conceptually:

```typescript
interface KnowledgeSource {

    id: string;

    sync(): Promise<KnowledgeChanges>;

    subscribe?(
        handler: (
            change: KnowledgeChange
        ) => Promise<void>
    ): Promise<void>;

}
```

A source may support one or more synchronization strategies.

```text
Webhook / Push
Polling
Scheduled Sync
Event Stream
Manual Sync
```

---

# Synchronization Strategies

Different sources have different requirements for freshness.

The extension should declare its preferred synchronization strategy.

Examples:

```yaml
sync:
  strategy: webhook
  fallback_interval: 1h
```

```yaml
sync:
  strategy: polling
  interval: 15m
```

```yaml
sync:
  strategy: event
```

```yaml
sync:
  strategy: manual
```

Core's scheduler and event system should coordinate synchronization where appropriate.

The extension should not require Core to understand the source's internal synchronization mechanism.

---

# Change Processing

Extensions should preferably emit **changes**, rather than repeatedly replacing entire datasets.

Conceptually:

```typescript
interface KnowledgeChange {

    source: string;

    type: "created" | "updated" | "deleted";

    entityType: string;

    entityId: string;

    data: unknown;

    timestamp: Date;

    provenance: Provenance;
}
```

Example:

```text
Calendar
  │
  │ Event modified
  ▼
Calendar Plugin
  │
  ▼
KnowledgeChange
  │
  ├── entity: calendar.event
  ├── id: event-123
  ├── type: updated
  └── timestamp: ...
  │
  ▼
epistemic-memory
```

Memory can then update its representation without treating the external system as a new unrelated document.

---

# Source of Truth

Persistent memory does not necessarily replace the external system as the authoritative source.

External systems remain authoritative where appropriate.

For example:

```text
Calendar
   │
   ├── authoritative current event state
   │
   └── knowledge feed → ICOS memory
```

This creates two complementary paths.

### Persistent Knowledge

Used for:

* Historical context
* Relationships
* Patterns
* Planning
* Association
* General reasoning
* Understanding the user's environment

### Live Capability

Used when exact current state is required.

For example:

> "Is my 2 PM meeting still happening?"

Core may retrieve the remembered event and then invoke:

```text
calendar.read
```

to verify the authoritative current state.

---

# Knowledge vs Live Retrieval

The architecture should distinguish between:

```text
"What do I know?"
```

and:

```text
"What is true right now?"
```

Memory answers the first.

A live capability can answer the second.

Core can use either or both depending on context.

```text
                     Query
                       │
                      CORE
                       │
              ┌────────┴────────┐
              ▼                 ▼
           MEMORY           LIVE TOOL
              │                 │
        known context      current state
              │                 │
              └────────┬────────┘
                       ▼
                     MODEL
```

This avoids both extremes:

* depending entirely on slow live retrieval
* assuming cached memory is always current

---

# Observations

Knowledge-source changes enter ICOS as observations.

```typescript
interface Observation {

    source: string;

    type: string;

    timestamp: Date;

    data: unknown;

    confidence?: number;

    provenance?: Provenance;
}
```

Examples:

```text
Calendar:
  "Meeting added for 14:00"

Email:
  "Reply received from client"

Washing Machine:
  "Cycle completed"

Camera:
  "Person entered room"

Kitchen Robot:
  "Cooking task completed"

Robot:
  "Left wheel temperature exceeded normal range"
```

Observations are processed by `epistemic-memory` according to memory policy.

Not every observation necessarily becomes permanent memory.

---

# Memory Ingestion Policy

Knowledge sources should not blindly dump all external data into persistent memory.

The memory subsystem should determine:

* What should be retained
* What should be updated
* What should expire
* What should remain ephemeral
* What should become episodic memory
* What should become semantic knowledge
* What relationships should be created
* What confidence/provenance should be attached
* What information should be consolidated

For example, a calendar event may produce:

```text
Current state:
  Meeting scheduled tomorrow at 14:00

Historical state:
  Meeting was originally scheduled Monday

Relationship:
  Meeting ↔ Project X

Context:
  Participant ↔ Person Y
```

The source provides the observation.

`epistemic-memory` determines how that observation becomes knowledge.

---

# Temporal Knowledge

External systems frequently represent changing state.

ICOS memory must therefore support temporal validity.

For example:

```text
Washing machine:
  10:00  idle
  10:15  running
  11:42  complete
```

Rather than simply storing three unrelated facts, memory should understand that these represent changing states of the same entity.

This enables queries such as:

> "When did the laundry finish?"

or:

> "How long has the washing machine been waiting?"

Temporal state is therefore an important part of knowledge ingestion.

---

# Example: Calendar

A Calendar Plugin could provide:

```text
Capabilities
├── calendar.read
├── calendar.create
├── calendar.modify
└── calendar.delete

Knowledge Sources
└── calendar.events
```

The plugin synchronizes events into memory.

Isabel can therefore reason about:

* Upcoming events
* Past events
* Recurring commitments
* Participants
* Conflicts
* Deadlines
* Relationships to projects
* Historical scheduling patterns

When necessary, Core can query the calendar directly for authoritative state.

---

# Example: Email

An Email Plugin could provide:

```text
Capabilities
├── email.read
├── email.send
└── email.search

Knowledge Sources
└── email.communication
```

The knowledge feed can allow Isabel to know that:

* Someone requested something
* A response is outstanding
* A conversation occurred
* A deadline was mentioned
* A project discussion changed
* An attachment was received

The live email capability remains available when the exact current mailbox state is required.

---

# Example: Smart Washing Machine

A washing machine integration could provide:

```text
Capabilities
├── washing-machine.status
├── washing-machine.start
└── washing-machine.stop

Knowledge Sources
├── washing-machine.state
└── washing-machine.events
```

The machine may emit:

```text
cycle_started
cycle_progress
cycle_completed
error
door_opened
```

ICOS can ingest those as observations.

The result is that Isabel does not need to be explicitly asked to check the appliance.

She can know:

> Laundry has finished.

and potentially associate that observation with other knowledge:

```text
Laundry finished
        │
        ├── household task
        ├── time available
        ├── previous conversation
        └── current priorities
```

This creates opportunities for proactive assistance.

---

# Example: Kitchen Robot

A kitchen robot integration could expose:

```text
Capabilities
├── kitchen.observe
├── kitchen.prepare
├── kitchen.cook
├── kitchen.stop
└── kitchen.status

Knowledge Sources
├── kitchen.state
├── kitchen.inventory
├── kitchen.events
└── kitchen.observations
```

A higher-level ICOS skill could then combine:

```text
Calendar
+
Preferences
+
Recipes
+
Available ingredients
+
Kitchen state
+
Robot capabilities
```

to perform a task such as:

```text
"Prepare dinner."
```

The important architectural distinction is:

```text
Skill:
    decides what should happen

Integration:
    knows how to interact with the kitchen

Memory:
    knows what has happened before

Core:
    coordinates the cognitive process
```

---

# Example: Camera

A camera integration may provide:

```text
Capabilities
└── camera.capture

Knowledge Sources
├── camera.observation
└── camera.events
```

Camera observations can eventually become part of ICOS's environmental model.

Examples:

```text
Person detected
Object detected
Door state changed
Vehicle arrived
Robot workspace occupied
```

Vision processing itself may be performed by a specialized external service or worker.

The integration is responsible for making the resulting observations available to ICOS.

---

# Plugin-Provided Skills

Plugins may also provide higher-level skills.

For example:

```text
Calendar Plugin
└── prepare-for-meeting

Email Plugin
└── triage-inbox

Research Plugin
└── investigate-topic
```

However, plugins should not automatically own the entire cognitive process.

A plugin-provided skill is a capability available to Core.

Core remains responsible for deciding when and why to invoke it.

---

# Relationship Between Skills, Tools, Plugins, Integrations, and Memory

The conceptual hierarchy is:

```text
                    ICOS CORE
                       │
                    SKILLS
                       │
                 ┌─────┴─────┐
                 ▼           ▼
               TOOLS     SUBAGENTS
                 │
        ┌────────┴────────┐
        ▼                 ▼
     PLUGINS        INTEGRATIONS
        │                 │
        └────────┬────────┘
                 │
          External Systems
                 │
                 ▼
            OBSERVATIONS
                 │
                 ▼
        EPISTEMIC MEMORY
                 │
                 ▼
              RuVector
```

This is a conceptual relationship rather than a requirement that every implementation use exactly these layers.

---

# Events

The extension system should support asynchronous events.

Conceptually:

```typescript
interface PluginEvent {

    source: string;

    type: string;

    timestamp: Date;

    payload: unknown;

}
```

Examples:

```text
calendar.event.updated
email.received
washing-machine.completed
camera.person_detected
robot.task_completed
```

Core may route these events to:

* Memory
* Active sessions
* Skills
* Notifications
* Model Sentinel
* Autonomous cognitive cycles

---

# Proactive Cognition

An important purpose of event-driven integrations is allowing ICOS to act without waiting for a user message.

For example:

```text
Washing machine
      │
      ▼
cycle.completed
      │
      ▼
     CORE
      │
      ▼
Memory records observation
      │
      ▼
Determine relevance
      │
      ▼
Notification / action / silence
```

Likewise:

```text
Calendar
   │
   ▼
Meeting approaching
   │
   ▼
CORE
   │
   ├── Recall previous meeting
   ├── Retrieve relevant emails
   ├── Recall outstanding tasks
   └── Construct preparation context
              │
              ▼
          Isabel
```

The event does not necessarily require an immediate response.

It may simply update the agent's understanding of the world.

---

# Synchronization and Freshness

Each knowledge source should eventually expose metadata describing its freshness requirements.

Possible properties:

```typescript
interface SyncPolicy {

    strategy:
        | "event"
        | "webhook"
        | "poll"
        | "schedule"
        | "manual";

    interval?: number;

    staleAfter?: number;

}
```

Examples:

```text
Calendar:
  webhook + hourly fallback

Email:
  push/event + periodic reconciliation

Immich:
  filesystem/event sync

Washing machine:
  event stream

Camera:
  real-time observation

Historical archive:
  daily sync
```

The objective is to maintain sufficiently fresh knowledge without continuously querying external systems.

---

# Failure and Offline Behavior

External systems will occasionally be unavailable.

The extension system should therefore distinguish:

```text
Connected
Disconnected
Degraded
Synchronizing
Stale
Error
```

Cached knowledge may remain available while a source is unavailable.

Core and memory should be able to determine when knowledge is stale.

For example:

```text
Calendar unavailable
      │
      ▼
Last successful sync:
09:00
      │
      ▼
Memory:
"Calendar information may be stale."
```

This prevents cached information from being treated as authoritative when the source has not been successfully synchronized.

---

# Provenance

Knowledge originating from extensions must retain provenance.

At minimum:

```text
source
entity
timestamp
observed_at
origin
confidence
```

Example:

```text
Source:
  calendar

Entity:
  event-123

Observed:
  2026-09-09 09:42

Origin:
  Google Calendar

Confidence:
  authoritative
```

Provenance allows ICOS to distinguish between:

```text
"I remember this."
```

and:

```text
"My calendar currently says this."
```

---

# Security and Permissions

Extensions must declare their requested capabilities and permissions.

Examples:

```text
calendar.read
calendar.write
email.read
email.send
camera.observe
microphone.observe
robot.control
appliance.control
```

Read and write access should be treated separately.

Physical control capabilities should eventually support stronger authorization and safety policies than ordinary information retrieval.

The extension system should provide a mechanism for Core to determine whether a capability is available before invoking it.

---

# Lifecycle

Extensions should have a defined lifecycle.

Conceptually:

```text
Install
  │
  ▼
Configure
  │
  ▼
Connect
  │
  ▼
Discover capabilities
  │
  ▼
Synchronize
  │
  ▼
Active
  │
  ├── events
  ├── sync
  ├── capability calls
  └── health checks
  │
  ▼
Disconnect
```

Extensions should be independently enableable and disableable.

ICOS should remain operational when an optional extension is unavailable.

---

# Design Principles

## 1. Extensions provide capabilities and/or knowledge

A plugin does not have to be merely a tool.

An extension may provide:

* Active capabilities
* Knowledge sources
* Events
* Skills
* Both capabilities and persistent knowledge

---

## 2. Memory is the integration point for knowledge

External systems should not need to remain in the critical path of every cognitive query.

When appropriate, their state should be continuously incorporated into epistemic memory.

---

## 3. External systems remain authoritative where appropriate

Memory represents ICOS's knowledge of the world.

The external system may remain the authoritative source for current state.

---

## 4. Live retrieval and persistent knowledge coexist

Memory provides context.

Live capabilities provide current authoritative state.

Core decides when each is appropriate.

---

## 5. Plugins and integrations should share infrastructure

The distinction between plugin and integration is primarily semantic.

Both should use the same extension lifecycle and capability mechanisms where practical.

---

## 6. Extensions should remain thin

An extension should translate between ICOS and the external system.

It should not duplicate Core's cognitive architecture.

---

## 7. Knowledge ingestion belongs with epistemic-memory

Extensions provide observations.

`epistemic-memory` decides how those observations become memory and knowledge.

---

## 8. Core owns cognition

Extensions should not independently decide what ICOS should think, remember, or do.

They provide capabilities and observations to the cognitive runtime.

---

## 9. Event-driven operation should be preferred where available

If an external system can notify ICOS when something changes, ICOS should prefer event-driven synchronization over unnecessary polling.

Polling remains an important fallback.

---

## 10. Physical integrations are first-class

The system must not assume that ICOS interacts only with software.

The same extension architecture should eventually support:

```text
Applications
Services
Appliances
Sensors
Robots
Actuators
Vehicles
```

This allows the cognitive architecture to extend from the digital environment into physical embodiment.

---

# Initial Scope

The first implementation should remain deliberately small.

### Core extension infrastructure

* Plugin manifest
* Extension lifecycle
* Capability registration
* Capability invocation
* Event handling
* Knowledge-source registration
* Scheduled synchronization
* Basic permission model

### First likely extensions

```text
Calendar
Email
Filesystem
Web
```

### Later integrations

```text
Immich
Camera
Microphone
Smart Home
Appliances
Robot Hardware
Kitchen Systems
Environmental Sensors
```

The architecture should be designed for the latter without requiring their implementation in the initial release.

---

# Long-Term Vision

The extension system ultimately allows ICOS to maintain a continuously updated model of the user's digital and physical environment.

```text
                         ICOS
                           │
                    EPISTEMIC MEMORY
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
     DIGITAL             PERSONAL           PHYSICAL
        │                  │                  │
     Calendar            Email             Appliances
     GitHub              Photos            Cameras
     Web                 Tasks             Sensors
     Files               Events            Robots
     Applications        People            Vehicles
        │                  │                  │
        └──────────────────┼──────────────────┘
                           │
                     WORLD MODEL
                           │
                    COGNITIVE LOOP
                           │
                 ┌─────────┴─────────┐
                 ▼                   ▼
              ASSIST               ACT
```

The goal is not merely to give Isabel access to more APIs.

The goal is to allow those systems to become **part of the environment Isabel understands**.

A calendar event, an unanswered email, a completed washing cycle, an approaching meeting, a robot fault, or a person entering a room can all become observations within the same cognitive architecture.

ICOS can then reason over those observations together rather than treating every external system as an isolated tool.
