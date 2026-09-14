# ICOS v3 Model Sentinal Subsystem

## Description

TBD

## Possible Loop

```ascii
LLM output
    │
    ▼
┌───────────────────────┐
│    Model Sentinel     │
├───────────────────────┤
│ contradiction         │
│ unsupported claims    │
│ hallucination         │
│ instruction drift     │
│ context drift         │
│ tool/result mismatch  │
│ confidence anomalies  │
└───────────┬───────────┘
            │
            ▼
       assessment
```