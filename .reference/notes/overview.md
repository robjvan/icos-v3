# ICOS v3 Overview

## Purpose

-

## Port Mapping

| Component | Port |
| --------- | ---- |
| Core | 3000 |
| Memory | 3001 |
| Model Sentinel | 3002 |

## Components

| Function | App | Notes |
| -------- | --- | ----- |
| Agent runtime | core | core.md |
| Chat ingress | core | core.md |
| Session management | core | core.md |
| LLM conversation loop | core | core.md |
| Skills | core | skill-samples.md |
| Cron jobs | core | core.md |
| Tools? | core | core.md |
| Context management | core | core.md |
| Integrations/Plugins | core | core.md |
| Memory | epistemic-memory | memory-system.md |
| Integrated RAG (KB et al.) | epistemic-memory | memory-systintegrations-and-plugins.md |
| Drift/hallucination detection | model-sentinel | model-sentinel.md |
| Notifications | integration | TBD |

## The ICOS Machine

```typescript
       perception / input
               ↓
          memory recall
               ↓
       state reconstruction
               ↓
        context formation
               ↓
          model inference
               ↓
       sentinel / evaluation
               ↓
       action / communication
               ↓
          outcome capture
               ↓
          consolidation
               ↓
             memory
               ↺
```

```typescript
                          ISABEL
                             │
              ┌─────────────┴─────────────┐
              │       WORLD MODEL            │
              │                              │
              │ What is happening?           │
              │ What matters?                │
              │ What changed?                │
              │ What am I supposed to do?    │
              │ What am I forgetting?        │
              │ What should happen next?     │
              └────────────┬──────────────┘
                             │
          ┌────────────────┼─────────────────┐
          │                 │                   │
       MEMORY            CONTEXT           REASONING
          │                 │                   │
      RuVector          current state       LLM
          │                 │                   │
          └────────────────┼─────────────────┘
                            │
                       ACTION / ADVICE
                            │
          ┌────────────────┼───────────────┐
          │                 │                 │
       Calendar           Email            Camera
       Tasks              Files             Audio
       Photos             Sensors            ...
```