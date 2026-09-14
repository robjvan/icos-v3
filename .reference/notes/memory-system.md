# ICOS v3 Memory Subsystem

## Description

The ICOS Memory Subsystem provides a persistent, associative memory architecture for autonomous agents.

Rather than implementing episodic, semantic, procedural, vector, and relational memory as independent storage systems, ICOS treats these as different semantic views over a unified memory substrate.

The underlying storage layer provides vector representations, structured metadata, temporal information, graph relationships, and higher-order associations. The ICOS Memory Engine determines how these representations are classified, consolidated, retrieved, evaluated, and reconstructed according to the current cognitive context.

The architecture separates **memory representation** from **memory semantics**.

A memory may simultaneously participate in multiple memory classes. For example, a single event may be represented as an episodic experience, contribute a semantic fact, update a procedural skill, and participate in a larger relational pattern.

## Features and Capabilities

### Vector Memory

Answers:

> **“What memories are similar to this?”**

Provides semantic retrieval through dense representations and similarity search.

Vector representation is treated as a retrieval mechanism rather than a distinct cognitive memory class.

### Semantic Memory

Answers:

> **“What does ISABEL believe to be true?”**

Stores facts, concepts, relationships, provenance, confidence, temporal validity, and supporting evidence.

Semantic knowledge may be derived from multiple episodic experiences and revised as evidence changes.

### Episodic Memory

Answers:

> **“What actually happened?”**

Stores temporally situated experiences, observations, actions, decisions, outcomes, and contextual state.

Episodes provide the experiential evidence from which higher-level knowledge can be constructed.

### Procedural Memory

Answers:

> **“How do I accomplish this?”**

Stores learned procedures, skills, action sequences, policies, triggers, successful strategies, and their observed outcomes.

Procedural memory may evolve through repeated execution and feedback.

### Relational Memory

Answers:

> **“How are these things connected?”**

Represents entities, concepts, events, actions, and experiences as a dynamic graph or hypergraph.

Relationships may encode causal, temporal, semantic, contextual, experiential, or compositional associations.

### Holographic Memory

Answers:

> **“What does the configuration of everything I remember imply about the current situation?”**

Holographic memory is not implemented as an independent storage layer.

Instead, it is a higher-order reconstruction process operating across the distributed memory substrate.

Given a current context, the Memory Engine activates relevant vectors, episodes, semantic facts, procedures, and relationships and reconstructs a coherent contextual state.

This permits memory retrieval to operate as associative reconstruction rather than simple nearest-neighbor lookup.

## Unified Memory Model

The ICOS Memory Engine therefore operates across four conceptual layers:

1. **Representation**

   - vectors
   - metadata
   - temporal state
   - graph/hypergraph relationships

2. **Memory Semantics**

   - working
   - episodic
   - semantic
   - procedural
   - reflexive

3. **Cognitive Operations**

   - encoding
   - retrieval
   - association
   - consolidation
   - prediction
   - revision
   - decay
   - reconstruction

4. **Holographic Reconstruction**

   - contextual activation
   - cross-memory association
   - evidence integration
   - pattern detection
   - coherent state reconstruction

The resulting architecture allows multiple memory modalities to coexist without requiring independent databases for each cognitive function.

## Architecture

- Layered Memory (semantic, vector, holographic)
- Multiple memory banks (project, user, agent)

```typescript
epistemic-memory
│
├── encoding
├── retrieval
├── consolidation
├── provenance
├── confidence
├── temporal validity
├── memory classification
├── association
└── reconstruction
        │
        ▼
     RuVector
     ├── vectors
     ├── metadata
     ├── graph
     ├── temporal data
     └── retrieval
```

### Possible Memory Record

```json
{
  "content": "...",
  "type": "episodic",
  "source": "conversation",
  "confidence": 0.92,
  "valid_from": "...",
  "valid_until": null,
  "entities": [],
  "relationships": [],
  "embedding": "...",
  "provenance": []
}
```