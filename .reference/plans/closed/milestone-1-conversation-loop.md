# Milestone 1 — Minimum Conversation Loop Slice (`core/`)

Status: implemented (2026-09-09) — verified live against Ollama (`violet:latest` via `/v1/chat/completions`); `tsc`, `eslint`, 22 unit + 4 e2e tests green.
Scope: `core/` only. No changes to memory, sentinel, interfaces.
Spec refs: `.reference/notes/core.md` (Conversation Processing, Model Providers, Context Construction, Minimal Runtime), `.reference/notes/overview.md` (port 3000).

## 1. Goal

Smallest runnable cognitive loop: accept a user message over REST, keep per-session history, call one OpenAI-compatible LLM endpoint (Ollama, vLLM, etc.), return the assistant reply.

Explicit non-goals (deferred, see §7):
streaming, persisted sessions, provider abstraction, memory recall/consolidation, sentinel evaluation, tools, interrupts/subagents.

## 2. Agreed decisions

- Transport: non-streaming REST only.
- Sessions: in-memory `Map`, lost on restart.
- Provider: single generic OpenAI-compatible HTTP client driven by `LLM_BASE_URL` + `LLM_MODEL` (+ optional key). No per-backend adapters.
- Stubs: none wired. Leave `TODO(core.md)` seam comments where memory/sentinel/tools will plug in.

## 3. Current state

- `core/src/`: empty Nest starter. `CoreController` (`core` prefix, no routes), empty `CoreService`, `main.ts` listens on `PORT ?? 3000`.
- Deps: `@nestjs/common,core,platform-express`, `dotenv`. No HTTP client, validation, or config checking.
- `.env.sample`: `PORT, LLM_MODEL, LLM_PROVIDER, LLM_BASE_URL` — no defaults, no key/timeout vars.
- Tests: only `core.controller.spec.ts`.

## 4. Runtime flow

```text
POST /core/conversation { sessionId?, message }
  → sessions.resolve (uuid when absent)
  → cognition.buildContext (system prompt + bounded history + input)
  → llm.chat (POST {LLM_BASE_URL}/chat/completions {model, messages, stream:false})
  → append assistant message, return { sessionId, reply, model }
```

`GET /core/conversation/:id → { sessionId, messages }` for history/debug (cheap given the store).

Error mapping: `400` empty message; `502` provider error / empty choice; `504` network/timeout. Log provider body snippet server-side only.

## 5. Changes

### New files (`core/src/`)

- `conversation/conversation.module.ts` — composes controller + service + store + LLM client.
- `conversation/conversation.controller.ts` — `POST /core/conversation`, `GET /core/conversation/:id`, `ValidationPipe` DTOs.
- `conversation/dto/conversation.dto.ts` — request/response DTOs (`class-validator`).
- `conversation/conversation.service.ts` — the loop: resolve session → build context → call LLM → update history. Contains `TODO(core.md): memory.recall` and `TODO(core.md): sentinel.evaluate` seam comments (no code).
- `conversation/session.store.ts` — `@Injectable` in-memory `Map<string, ChatMessage[]>`; `resolve/append/get`; trim to `MAX_HISTORY` (default 50).
- `conversation/context.builder.ts` — pure function `(systemPrompt, history, input) => OpenAI messages[]`. Smallest useful representation per `core.md` Context Construction.
- `llm/llm.client.ts` — `@Injectable` generic client on native `fetch` + `AbortController` timeout. `chat({messages})`. Throws typed `LlmError(status, retryable)`.
- `config.ts` — typed env reader, fail fast on boot when `LLM_MODEL` missing.
- Tests: `context.builder.spec.ts`, `session.store.spec.ts`, `conversation.service.spec.ts` (mock `llm.client`), e2e with mocked `global.fetch` asserting request shape + history accumulation.

### Modified

- `core.module.ts` — import `ConversationModule`.
- `main.ts` — enable global `ValidationPipe`.
- `.env.sample` — document `LLM_BASE_URL` (default `http://localhost:11434/v1`), required `LLM_MODEL`, optional `LLM_API_KEY`, `LLM_TIMEOUT_MS` (default 60000), `SYSTEM_PROMPT`, `MAX_HISTORY`. Mark `LLM_PROVIDER` as unused label in this slice.
- `package.json` — add `class-validator, class-transformer, uuid` (+ `@types/uuid` dev).

### Not added

`openai` SDK, `@nestjs/axios`, SSE, DB, memory/sentinel/tool interfaces.

## 6. LLM client detail

- URL: `${LLM_BASE_URL}/chat/completions` (normalize trailing slash; accept base with or without `/v1`). Ollama `http://localhost:11434/v1`, vLLM `http://localhost:8000/v1`.
- Payload: `{ model: LLM_MODEL, messages, stream: false }`.
- Headers: `Content-Type: application/json`; `Authorization: Bearer <key>` only when `LLM_API_KEY` set.
- Parse: `choices[0].message.content`; empty → `502`.

## 7. Verification

1. `npm install && npm test && npm run test:e2e` green in `core/`.
2. Live boot: `LLM_BASE_URL=http://localhost:11434/v1 LLM_MODEL=<model> npm run start:dev`.
3. Manual:
```bash
curl -X POST localhost:3000/core/conversation \
  -H 'Content-Type: application/json' \
  -d '{"message":"hello"}'
curl localhost:3000/core/conversation/<sessionId>
```
Expect reply on first call; second call with returned `sessionId` retains history.

## 8. Execution order

1. Config + `.env.sample` + `main.ts` pipe.
2. `llm.client` + unit test (mocked fetch: success, 500, timeout).
3. `session.store` + `context.builder` + unit tests.
4. `conversation.service` + `controller` + `module` wiring.
5. Unit + e2e tests.
6. Manual Ollama verify per §7.

## 9. Future milestones (backlog, not this slice)

- Streaming (`stream:true` SSE endpoint for TUI/Web).
- Persisted sessions (file/sqlite/postgres).
- `ModelProvider` interface + adapters, retries, model routing.
- `memory.recall` / consolidation seam (`epistemic-memory`, port 3001).
- `sentinel.evaluate` seam (`model-sentinel`, port 3002).
- Tool-calling loop, interrupts/cancellation, usage/token logging, OpenAPI docs.
