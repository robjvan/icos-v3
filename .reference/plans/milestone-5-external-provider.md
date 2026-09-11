# M5 — External LLM Provider Compatibility

## Status

In progress (2026-09-11). Docs verified — Zen Go uses
`https://opencode.ai/zen/go/v1/chat/completions` (OpenAI-compatible),
own User-Agent + stable `x-opencode-session` required per Go docs.
Plan's console-gateway URL does NOT apply to Zen; using the Zen base.

## Objective

Extend the existing generic `LlmClient` implementation so ICOS Core can switch between local and external OpenAI-compatible LLM providers without changing Core, ConversationService, Cognition, streaming, or session logic.

Initial providers:

* Ollama
* llama.cpp
* OpenRouter
* OpenCode Go / Zen

The implementation must establish a provider configuration boundary that allows additional providers/endpoints to be added later without creating provider-specific logic throughout Core.

### Core principle

**Core knows about an LLM contract, not about providers.**

```text
Core
  │
  └── LlmClient
       │
       └── Provider configuration
            ├── Ollama
            ├── llama.cpp
            ├── OpenRouter
            └── OpenCode Go / Zen
```

Do NOT introduce provider-specific clients such as:

```text
OpenRouterClient
OpenCodeClient
OllamaClient
```

unless a future provider genuinely requires a protocol that cannot be represented by the existing OpenAI-compatible contract.

---

# 1. Preserve the Existing LlmClient Contract

Start by inspecting the existing implementation and tests.

The existing public interface should remain conceptually equivalent to:

```ts
interface LlmClient {
  chat(request: LlmChatRequest): Promise<LlmChatResponse>;

  chatStream(
    request: LlmChatRequest,
    signal?: AbortSignal,
  ): AsyncIterable<LlmStreamEvent>;
}
```

Do not make ConversationService aware of:

* provider names
* API keys
* base URLs
* provider-specific headers
* OpenRouter metadata
* OpenCode session headers
* model-specific quirks

Those belong below the LlmClient boundary.

Existing Core behavior must remain unchanged.

---

# 2. Introduce Provider Configuration

Create a configuration model representing an OpenAI-compatible endpoint.

Example conceptual shape:

```ts
interface LlmProviderConfig {
  id: string;
  baseUrl: string;
  model: string;

  apiKey?: string;

  headers?: Record<string, string>;

  timeoutMs?: number;

  userAgent?: string;
}
```

Do not over-engineer this into a generic provider framework.

The important distinction is:

```text
Provider configuration
        ≠
Provider implementation
```

For the initial M5 scope, all four providers should use the same HTTP implementation.

---

# 3. Separate Authentication from General Headers

The current client should stop assuming that authentication is always represented by one hard-coded API-key mechanism.

Support arbitrary request headers through configuration.

For example:

```ts
headers: {
  Authorization: `Bearer ${apiKey}`,
}
```

This allows future providers to require different authentication/header arrangements without modifying the HTTP transport.

However:

* never log API keys
* never include credentials in error messages
* never expose credentials through Core API responses
* never persist credentials in SQLite
* never put secrets into session records

Environment variables should remain the initial credential source.

---

# 4. Environment Configuration

Preserve the existing local-provider environment variables for backwards compatibility:

```text
LLM_BASE_URL
LLM_MODEL
LLM_API_KEY
LLM_TIMEOUT_MS
LLM_PROVIDER
```

Add support for selecting an external provider through configuration.

Suggested initial examples:

### Ollama

```text
LLM_PROVIDER=ollama
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=<model>
```

### llama.cpp

```text
LLM_PROVIDER=llama.cpp
LLM_BASE_URL=http://localhost:8080/v1
LLM_MODEL=<model>
```

### OpenRouter

```text
LLM_PROVIDER=openrouter
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_MODEL=<provider/model>
LLM_API_KEY=<secret>
```

OpenRouter should remain an ordinary OpenAI-compatible endpoint rather than receiving special logic in Core.

### OpenCode Go / Zen

Use the current OpenCode inference OpenAI-compatible endpoint.

OpenCode's current documentation exposes an OpenAI-compatible inference endpoint under:

```text
https://opencode.ai/inference/openai/v1/chat/completions
```

with bearer authentication for paid models.

Therefore the base URL should be represented as configuration rather than hard-coded into Core.

Example:

```text
LLM_PROVIDER=opencode
LLM_BASE_URL=https://opencode.ai/inference/openai/v1
LLM_MODEL=<model>
LLM_API_KEY=<secret>
```

Do not assume that "Go" and "Zen" require separate client implementations. They are provider/service configurations unless their actual API behavior proves otherwise.

---

# 5. OpenCode Session Header

This is a REQUIRED part of M5.

OpenCode Go requires clients to send:

```http
x-opencode-session: <stable-id-per-conversation>
```

for each conversation so OpenCode can optimize routing and prompt caching.

The header must therefore be generated from the ICOS conversation/session identity.

## Required behavior

For every Core conversation:

```text
ICOS session ID
      ↓
LlmClient request
      ↓
x-opencode-session: <same stable value>
```

The value MUST remain stable for the lifetime of that ICOS conversation.

Do NOT generate a new random value for every HTTP request.

Do NOT use the process ID.

Do NOT use the message ID.

Do NOT use a timestamp.

Use the existing ICOS `sessionId`.

Example:

```http
x-opencode-session: 6f7e9b7a-...
```

The same ICOS session must produce:

```text
request 1 → same header
request 2 → same header
request 3 → same header
stream request → same header
```

A different ICOS session must produce a different value.

---

# 6. Make Session Identity Available to LlmClient

The current LlmClient request model may not contain the ICOS session ID.

Add it at the request-contract level rather than trying to infer it inside the HTTP client.

For example:

```ts
interface LlmChatRequest {
  messages: LlmMessage[];

  model?: string;

  temperature?: number;

  maxTokens?: number;

  sessionId?: string;
}
```

Or use a more explicit request metadata object if that better matches the existing code:

```ts
interface LlmRequestContext {
  sessionId?: string;
}
```

The important requirement is:

**the LlmClient must receive the conversation identity explicitly.**

Do not make LlmClient inspect HTTP/session/database internals.

---

# 7. Provider-Specific Headers Must Be Composable

Implement a request-header construction layer.

Conceptually:

```text
base headers
    +
authentication headers
    +
provider-specific headers
    +
request metadata headers
    ↓
final HTTP request
```

For example:

```text
OpenCode:
Authorization: Bearer ...
x-opencode-session: <sessionId>
User-Agent: icos/3.x
```

OpenRouter may use:

```text
Authorization: Bearer ...
```

and optional provider-specific metadata.

Ollama/llama.cpp may require no authentication.

Do not hard-code OpenCode headers into the generic fetch method.

Instead, give the provider configuration a mechanism to contribute headers.

Example conceptual API:

```ts
interface LlmProvider {
  buildHeaders(context: LlmRequestContext): Record<string, string>;
}
```

However, if this abstraction becomes unnecessarily large, prefer a simpler configuration-based implementation.

The agent should choose the smallest abstraction that satisfies the requirements.

---

# 8. User-Agent

OpenCode Go currently asks clients to identify themselves with their own User-Agent rather than a generic HTTP library/SDK identifier.

ICOS should therefore send a stable application User-Agent for OpenCode requests.

Suggested form:

```text
icos/<version>
```

Do not identify the client as:

```text
fetch
node
axios
undici
```

The User-Agent should be configurable if necessary.

Example:

```text
LLM_USER_AGENT=icos/3.0
```

If provider-specific configuration is cleaner, allow the OpenCode configuration to define it.

---

# 9. Streaming Must Work Identically

The existing `chatStream()` implementation must continue to work through the same provider boundary.

Provider selection must NOT change the stream API exposed to Core.

```text
Core
  ↓
LlmClient.chatStream()
  ↓
provider endpoint
  ↓
SSE parser
  ↓
ICOS stream events
```

The existing:

```text
meta
token
done
error
```

events remain unchanged.

Test all providers through the existing streaming path.

Do not create an OpenRouter streaming implementation and a separate OpenCode streaming implementation unless protocol differences make this unavoidable.

---

# 10. Error Semantics Must Remain Provider-Neutral

Preserve the existing mapping:

```text
empty/invalid request       → 400
provider HTTP/API failure   → 502
network failure             → 504
timeout                     → 504
aborted request             → appropriate existing abort behavior
empty provider response     → 502
```

Provider-specific response bodies may contain useful diagnostic information, but the public Core API should not expose secrets.

Errors should identify useful safe information such as:

```text
provider
HTTP status
safe provider error message
```

but never:

```text
Authorization header
API key
raw credential-bearing request
```

---

# 11. Provider Selection

Provider selection should be configuration-driven.

The application should be able to switch:

```text
LLM_PROVIDER=ollama
```

to:

```text
LLM_PROVIDER=openrouter
```

or:

```text
LLM_PROVIDER=opencode
```

without changing Core code.

Ideally this should require:

1. change environment/configuration
2. restart Core
3. send the same conversation request

No source changes.

The same browser/session client should continue functioning.

---

# 12. Model Names Are Provider Configuration

Do not normalize model IDs unnecessarily.

Pass the configured model ID through to the provider.

Examples:

```text
Ollama:
gemma4-e4b-unc

OpenRouter:
<provider>/<model>

OpenCode:
<model-id>
```

The LlmClient should not need to understand what the model name means.

Do not build a global model registry in M5.

---

# 13. OpenRouter-Specific Requirements

Verify that the generic OpenAI-compatible implementation can successfully perform:

### Non-streaming

```text
POST /chat/completions
```

### Streaming

```text
POST /chat/completions
stream=true
```

### Authentication

```http
Authorization: Bearer <key>
```

### Model selection

Configured model ID is transmitted unchanged.

If OpenRouter requires additional optional headers for attribution/metadata, treat those as configurable headers rather than hard-coded Core behavior.

Do not make OpenRouter metadata mandatory unless required for the actual API contract.

---

# 14. OpenCode Go / Zen Requirements

> Compatibility note (2026-09-11): Zen routes models to per-model
> protocols. Most (DeepSeek, GLM, Kimi, Big Pickle, free chat models)
> are OpenAI-compatible `chat/completions` and work through the current
> client unchanged. A select few (Muse Spark contributor tiers, GPT/Grok
> flagships, Claude/Gemini vendor paths) live behind `/responses` or vendor
> (`/messages`, `/models/...`) endpoints with different request/response
> shapes. Supporting those is a separate, non-urgent milestone — it needs
> a second transport alongside the chat client, not a tweak to it. The
> `LLM_PROVIDER=opencode*` configuration (base URL, key, session header,
> User-Agent) carries over unchanged when that lands.

Verify:

### Non-streaming

OpenAI-compatible chat completion works.

### Streaming

SSE streaming works.

### Authentication

Bearer authentication works for the configured service/model.

### Session affinity

Every request for the same ICOS session contains:

```http
x-opencode-session: <stable ICOS session ID>
```

### Session stability

Given:

```text
ICOS session A
```

the following all use exactly the same header value:

```text
chat()
chatStream()
retry()
follow-up message
```

A new ICOS session receives a different value.

### Auxiliary requests

If M5 later introduces auxiliary LLM requests through the same LlmClient, they must receive the appropriate session identity when they logically belong to the same conversation.

Do not implement auxiliary request types unless they already exist.

---

# 15. Do Not Couple ICOS Sessions to OpenCode Sessions

This distinction is important.

ICOS owns:

```text
sessionId
```

OpenCode receives:

```text
x-opencode-session: sessionId
```

But ICOS must NOT depend on OpenCode's own session database/API.

There should be no requirement to:

```text
POST /session
GET /session/:id
```

against an OpenCode server merely to use OpenCode inference.

ICOS remains the source of truth for its own conversation sessions.

The OpenCode header is simply request metadata used by the external provider.

---

# 16. Provider Factory / Registry

If the implementation needs a provider-selection abstraction, keep it extremely small.

Conceptually:

```ts
interface LlmProvider {
  id: string;

  createClient(config: LlmProviderConfig): LlmClient;
}
```

or simply:

```ts
const providers = {
  ollama: ...,
  "llama.cpp": ...,
  openrouter: ...,
  opencode: ...,
};
```

The agent should NOT create:

```text
AbstractProviderFactoryFactory
ProviderStrategyRegistry
ModelAdapterManager
LLMBackendOrchestrator
```

M5 is specifically an opportunity to prevent v2-style abstraction creep.

All current providers use the same OpenAI-compatible transport.

Only abstract what is actually different:

```text
configuration
authentication
headers
endpoint
```

---

# 17. Tests

Add automated tests for the provider boundary.

## Unit tests

### Configuration

* provider loads correctly
* base URL loads correctly
* model loads correctly
* API key is optional
* timeout defaults correctly
* custom headers merge correctly
* provider-specific headers override/merge according to documented rules

### Authentication

Verify:

```text
Authorization: Bearer <key>
```

when configured.

Verify no Authorization header is emitted when no key exists.

### OpenCode session header

Given:

```text
sessionId = "session-a"
```

verify every OpenCode request contains:

```text
x-opencode-session: session-a
```

Then verify:

```text
session-a ≠ session-b
```

produces different headers.

### Header stability

Multiple requests from the same conversation must have identical session-header values.

### Streaming

Mock an OpenAI-compatible SSE stream and verify the existing parser receives the same normalized stream events regardless of provider.

---

# 18. Integration Test Matrix

Run the same functional test against each provider.

| Provider        | Chat | Streaming | Auth | Session Header |
| --------------- | ---: | --------: | ---: | -------------: |
| Ollama          |    ✓ |         ✓ |  N/A |            N/A |
| llama.cpp       |    ✓ |         ✓ |  N/A |            N/A |
| OpenRouter      |    ✓ |         ✓ |    ✓ |            N/A |
| OpenCode Go/Zen |    ✓ |         ✓ |    ✓ |              ✓ |

The goal is to prove that Core behavior is provider-independent.

---

# 19. Manual Acceptance Test

Use the existing browser client.

Start Core with provider A:

```text
LLM_PROVIDER=ollama
```

Start a conversation.

Then restart Core with:

```text
LLM_PROVIDER=openrouter
```

Verify a new session works.

Then repeat with OpenCode.

For OpenCode specifically, inspect the outgoing HTTP request and verify:

```http
x-opencode-session: <ICOS session ID>
```

appears on every relevant request.

Also verify that sending several messages in the same session preserves the same header.

---

# 20. Provider Swap Test

The strongest M5 test should resemble the M2 provider swap test.

### Test

1. Start Core against Ollama.
2. Open browser client.
3. Create a session.
4. Exchange several messages.
5. Stop Ollama.
6. Restart Core configured for OpenRouter.
7. Verify conversation works.
8. Restart Core configured for OpenCode.
9. Verify conversation works.
10. Verify streaming works with each provider.
11. Verify session persistence is unaffected.
12. Verify memory candidate extraction remains unaffected.

The application should not contain provider-specific branches in:

```text
ConversationService
Cognition
SessionStore
MemoryCandidateExtractor
REST controllers
streaming controller
```

---

# 21. Failure Tests

Verify:

### Invalid API key

Provider returns authentication failure.

Expected:

```text
502
```

with safe diagnostic information.

### Provider unavailable

Expected:

```text
504
```

according to the existing timeout/network semantics.

### Invalid model

Provider rejects model.

Expected:

```text
502
```

### OpenCode missing session header

The test harness should be capable of detecting this regression.

### OpenCode session changes accidentally

A test should fail if two requests belonging to the same ICOS session produce different `x-opencode-session` values.

---

# 22. Documentation

Update the ICOS configuration documentation with:

```text
Local:
  Ollama
  llama.cpp

Cloud:
  OpenRouter
  OpenCode Go / Zen
```

Document:

* required environment variables
* API key configuration
* model configuration
* provider switching
* OpenCode session-header behavior
* example configurations

Do not document provider credentials or real secrets.

---

# 23. Non-Goals

M5 must NOT implement:

* provider-specific model routing
* automatic fallback between providers
* load balancing
* cost optimization
* model benchmarking
* model selection intelligence
* provider health scoring
* provider discovery
* model catalogs
* provider marketplace
* OpenCode session management
* OpenCode TUI/server integration
* OpenRouter-specific orchestration
* automatic provider failover
* multi-provider simultaneous generation
* agent-level provider selection
* tool calling changes
* memory changes
* epistemic memory
* semantic retrieval

Those can be evaluated later based on actual requirements.

---

# 24. Definition of Done

M5 is complete when:

* [x] Existing Ollama functionality still works.
* [x] Existing llama.cpp functionality still works.
* [x] OpenRouter works through the same LlmClient. (chat + stream live, deepseek/deepseek-v4-flash-0731)
* [ ] OpenCode Go/Zen works through the same LlmClient. (keyless 401→502 verified; 200-path needs a working model/quota: big-pickle rate-limited, others disabled/unavailable)
* [ ] Non-streaming requests work for all four configurations. (ollama/llama.cpp/openrouter ✓; opencode pending)
* [ ] Streaming requests work for all four configurations. (ollama/llama.cpp/openrouter ✓; opencode pending)
* [x] API authentication is configuration-driven.
* [x] Arbitrary request headers are supported.
* [x] OpenCode sends `x-opencode-session`. (wire-proven)
* [x] The OpenCode session header is stable for the lifetime of an ICOS session. (wire-proven)
* [x] Different ICOS sessions produce different OpenCode session IDs. (unit-proven)
* [x] User-Agent is appropriate for OpenCode. (wire-proven)
* [x] Provider switching requires configuration changes, not Core source changes. (4 live boots, env-only)
* [x] ConversationService contains zero provider-specific logic. (grep-verified)
* [x] SessionStore contains zero provider-specific logic. (grep-verified)
* [x] Memory extraction contains zero provider-specific logic. (grep-verified)
* [x] Automated tests cover provider configuration and session-header behavior.
* [ ] Manual provider-swap test passes. (local swap proven in M2; full 4-provider swap pending keys)
* [x] No unnecessary provider abstraction has been introduced.

## Final architectural invariant

After M5, this should remain true:

```text
                    ┌───────────────┐
                    │     Core      │
                    └───────┬───────┘
                            │
                       LlmClient
                            │
                 OpenAI-compatible contract
                            │
              ┌─────────────┼─────────────┐
              │             │             │
           local          cloud         future
              │             │             │
           Ollama       OpenRouter      ????
         llama.cpp      OpenCode
```

Core should not care which box is underneath it.

The only provider-specific behavior currently justified by evidence is request configuration/authentication/header construction — especially the OpenCode `x-opencode-session` requirement.

That is the abstraction boundary M5 should establish.
