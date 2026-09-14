# Provider Swap Evidence — llama.cpp + Phi-4-mini-reasoning

Date: 2026-09-10
App: `core/`, unchanged (no code, config, or restart; same browser page session)

## Setup

```bash
/Users/rob/llama.cpp/build/bin/llama-server -m ~/Downloads/Phi-4-mini-reasoning-Q4_K_M.gguf -ngl 99 --port 11434
```

- Same port Ollama used (`:11434`), so `LLM_BASE_URL=http://localhost:11434/v1` kept working untouched.
- Model: `Phi-4-mini-reasoning-Q4_K_M.gguf` (reasoning variant — relevant to the thinking-trace notes below).

## Hot-swap sequence (all in one browser session, no reload)

1. Chatting via Ollama + gemma.
2. Ollama killed → next message failed cleanly with a surfaced error (`Error: LLM request aborted` via the SSE `error` event). Failure path works as designed.
3. `llama-server` started on the same port → next message streamed a live reply. Zero changes anywhere in the stack.

## Observations

- Token streaming renders live, identical behavior to Ollama.
- The reasoning trace arrives **inline in the token stream**, wrapped in `<think>...</think>` tags — parseable, not stripped by the server.
- The reasoning-distilled model over-interprets ambiguous input (said "hello", got a derivation of `\boxed{52}` for the "hidden" math problem). Model personality issue, not a stack issue — see follow-ups.

## Verdict

Pass. Second provider swap with no code changes: the OpenAI-compatible client boundary holds across Ollama and llama.cpp, including mid-session backend replacement and graceful failure in between.

## Follow-ups

1. **Separate thinking from response.** The frontend (and later the sentinel) needs to distinguish reasoning trace vs. final answer. Proposal: detect `<think>` blocks in `LlmClient` (both `chat` and `chatStream`) and surface them as a distinct channel — e.g. a new SSE `event: thinking` alongside `event: token` — so the client can render it collapsed/styled differently, and the sentinel can weigh it separately from asserted claims.
2. **Prompt grounding.** A system-prompt line directing conversational (not puzzle-solving) behavior for greetings; iterate via `SYSTEM_PROMPT` env.
3. **Model selection.** Prefer non-reasoning instruct builds for chat roles; reserve reasoning builds for subagents where the trace is actually useful (and then the thinking channel from #1 carries it).
