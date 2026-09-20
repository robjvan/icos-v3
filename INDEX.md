# ICOS v3 INDEX

```shell
icos/ # Root of project.
├── .icos/ # Working files for the instance.
│
├── .reference/ # Reference files - plans, legacy code, etc.
│     ├── notes/ # Subsystem planning notes.
│     └── plans/ # Implementation plans.
│           └── evidence/ # Evidence files captured after each milestone.
│
├── core/ # Core subsytem.
│     ├── Dockerfile # Dev server image for compose.
│     └── .env.sample # Authoritative runtime configuration template.
│
├── docs/ # User-facing documents.
│     └── docs/EULA.md # End-user License Agreement.
│
├── docker-compose.yml # Supported launch path (icos-v3-core service).
├── AGENTS.md # Project-level Agent rules.
├── INDEX.md # Project index.
└── README.md # Project-level README document.
```
