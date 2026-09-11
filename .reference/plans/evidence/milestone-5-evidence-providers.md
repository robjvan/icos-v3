# Milestone 5 — Provider Evidence

Date: 2026-09-11
Scope: provider configuration boundary; same `LlmClient` transport for all rows.
Status: implementation complete; live verification complete for local + OpenRouter rows. **OpenCode endpoint testing still needed** (see below).

## Live matrix (port 3100, isolated DBs)

| Provider | Chat | Streaming | Auth | Session header | Notes |
| --- | --- | --- | --- | --- | --- |
| Ollama (gemma4-e4b-unc) | ✓ 200 | ✓ 20 token events | N/A (none sent) | N/A (not sent) | Unchanged behavior |
| llama.cpp (qwen) | ✓ 200 | ✓ 10 tokens + done | N/A (none sent) | N/A (not sent) | Unchanged behavior |
| OpenRouter (keyless) | 401→502 | — | `Authorization` absent → provider 401 | N/A | `[openrouter]` tag, safe body |
| OpenCode Zen (keyless, deepseek-v4.1-flash) | 401→502 | — | "Missing API key" → provider 401 | N/A | `[opencode]` tag, safe body |

Raw cloud errors (values redacted where applicable):

```json
{"message":"[openrouter] LLM endpoint returned 401: {\"error\":{\"message\":\"No cookie auth credentials found\",\"code\":401}}","error":"Bad Gateway","statusCode":502}
{"message":"[opencode] LLM endpoint returned 401: {\"type\":\"error\",\"error\":{\"type\":\"AuthError\",\"message\":\"Missing API key.\"}}","error":"Bad Gateway","statusCode":502}
```

## Wire capture (fake OpenAI endpoint, `LLM_PROVIDER=opencode`)

Three requests — chat, same-session follow-up, stream — all observed on the wire:

```text
POST /v1/chat/completions | session: cd944fd4-…-7a6c64aa | ua: icos-wirecheck/1.0 | auth: <present> | ct: application/json
POST /v1/chat/completions | session: cd944fd4-…-7a6c64aa | ua: icos-wirecheck/1.0 | auth: <present> | ct: application/json
POST /v1/chat/completions | session: cd944fd4-…-7a6c64aa | ua: icos-wirecheck/1.0 | auth: <present> | ct: application/json
```

Same `x-opencode-session` (= ICOS session id) across chat/chat/stream; custom `User-Agent` honored; `Authorization` present but its value never printed anywhere in this file, logs, or error paths.

## Static guarantees

- `grep opencode src` (non-spec): only `llm-provider.ts` (the single header gate) + one doc comment. Zero provider branches in ConversationService, SessionStore, MemoryCandidateExtractor, controllers — verified by grep.
- Secrets audit: API keys flow only into the `Authorization` header. No logging of headers/keys anywhere; error paths carry provider id + status + body snippet only.
- Provider switching across all four live boots: env changes only, no source changes.

## Automated coverage

- `tsc` clean, `eslint` clean.
- 96 unit tests (header merge order + override rules, auth present/absent, UA default `icos/<version>` + override, opencode session header incl. stability/distinctness/case-insensitivity/streaming/absence elsewhere, provider-tagged errors, request-contract plumbing incl. extractor sessionId).
- 13 e2e tests (all prior milestones green; ICOS session id asserted into the LLM request contract).

## Addendum — OpenRouter positive verification (2026-09-11)

Via Core on `:3000`, `LLM_PROVIDER=openrouter`, model `deepseek/deepseek-v4-flash-0731`:

- Chat: `{"reply":"router","model":"deepseek/deepseek-v4-flash-0731"}` with caller-supplied session `a0b4739a-…` adopted verbatim — traceable end to end.
- Stream: `meta → token → done` events; short replies arrive in a single provider chunk (normal).
- History: 6 messages accumulated in the traced session across chat + stream turns.
- No `x-opencode-session` on this row by construction (unit-proven absence; OpenRouter needs none).

Operational note: Core snapshots config at boot — live `.env` edits do not affect a running server, and a base URL containing the full `/chat/completions` path will 404 on the *next* boot (client appends the path itself). Full-URL bases are a future enhancement, not M5.

## Remaining testing: OpenCode endpoints

Not yet live-verified end to end through Core:

- [ ] One successful chat turn via OpenCode (Go or Zen) with a working model + quota.
- [ ] One successful streamed turn via the same.
- [ ] Confirm `x-opencode-session` stability across both in one ICOS session (wire-proven against a capture harness; needs a real provider turn to close the loop).
- [ ] Re-run the local-provider regression (Ollama chat + stream) after any client change in the meantime.

Blockers so far have all been provider-side (free-tier rate limits, disabled models, Responses-only model ids) — no Core changes are known to be needed. When quota/coverage allows, boot with `LLM_PROVIDER=opencode(-go|-zen)`, a working model id, and a root-style base URL, then repeat the OpenRouter checks above.

## Addendum — Zen endpoint archaeology (2026-09-11, with key)

- The Zen models table routes models to per-model endpoints: `muse-spark-*-free` is **Responses-API-only** (`/zen/v1/responses`), unreachable from a chat-completions client (404 on the wrong path, `ModelError: not supported` on the right one). Free chat/completions-compatible models: big-pickle, mimo-v2.5-free, ling-3.0-flash-fin-free, nemotron-*-free.
- Bare-curl free-tier calls fail with `MissingSessionID` ("free tier can only be used in OpenCode") — the free tier *requires* the session header, which is exactly what M5's `x-opencode-session` sends. Our Core request (with header) gets past that gate to the rate limiter.
- `big-pickle` via Core: auth accepted, model accepted, session header accepted → `FreeUsageLimitError: Rate limit exceeded`. Blocked on quota reset, not on compatibility.
- `mimo-v2.5-free`: `Model is disabled`. `deepseek-v4-flash-free`: `Model is unavailable`. Both dead ends for now.
- Code change resulting from this: the session-affinity gate now matches the `opencode` provider *family* (`opencode`, `opencode-zen`, ...) instead of one exact id.
