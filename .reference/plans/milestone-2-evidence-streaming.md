# Milestone 2 — Streaming Evidence (`gemma4-e4b-unc:latest`)

Date: 2026-09-10
App: `apps/core/` (NestJS, `node dist/main`, port 3100 for the test)
LLM: Ollama OpenAI-compatible endpoint, `LLM_BASE_URL=http://localhost:11434/v1`, `LLM_MODEL=gemma4-e4b-unc:latest`

Endpoint: `POST /core/conversation/stream` (SSE: `meta` → `token`* → `done` | `error`).
Non-streaming `POST /core/conversation` unchanged.

## Raw SSE (prompt: "Count from one to five, one number per word.")

```
event: meta
data: {"type":"meta","sessionId":"301b4476-b160-41f7-b3b7-e4729dc8ba0b","model":"gemma4-e4b-unc:latest"}

event: token
data: {"type":"token","content":"One"}

event: token
data: {"type":"token","content":"\n"}

... (9 token events total) ...

event: done
data: {"type":"done","reply":"One\nTwo\nThree\nFour\nFive","model":"gemma4-e4b-unc:latest"}
```

Event census: 1 meta, 9 token, 1 done. Concatenated token contents exactly equal the `done` reply.

## History after a streamed turn (prompt: "Say the word amber and nothing else.")

```json
{"sessionId":"a5abaef7-08e2-4f55-bca1-49bf058eee23","messages":[{"role":"user","content":"Say the word amber and nothing else."},{"role":"assistant","content":"amber"}]}
```

Streamed replies persist to session history identically to non-streamed ones.

## Automated coverage

- `tsc` clean, `eslint` clean.
- 29 unit tests (upstream SSE parsing incl. split-chunk reassembly, keep-alive/malformed line tolerance, 502/504 mapping; service event ordering; error path stores nothing).
- 7 e2e tests (SSE shape `meta`/`token`/`done`, error-event path, plus all Milestone 1 cases).

## Verdict

Pass. Token streaming works live against Ollama with no client-perceived buffering, failures surface as SSE `error` events, and the browser test client (`GET /`) renders tokens as they arrive.
