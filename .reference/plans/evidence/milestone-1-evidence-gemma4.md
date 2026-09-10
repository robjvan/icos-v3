# Milestone 1 — Live Evidence (`gemma4-e4b-unc:latest`)

Date: 2026-09-09
App: `apps/core/` (NestJS, `node dist/main`)
LLM: Ollama OpenAI-compatible endpoint, `LLM_BASE_URL=http://localhost:11434/v1`, `LLM_MODEL=gemma4-e4b-unc:latest`

## Commands

```bash
LLM_MODEL=gemma4-e4b-unc:latest LLM_BASE_URL=http://localhost:11434/v1 PORT=3000 node dist/main
curl -X POST localhost:3000/core/conversation -H 'Content-Type: application/json' \
  -d '{"message":"My favorite color is teal. Reply in one short sentence to confirm you noted it."}'
curl -X POST localhost:3000/core/conversation -H 'Content-Type: application/json' \
  -d '{"message":"What is my favorite color? Answer in one short sentence.","sessionId":"<sid>"}'
curl localhost:3000/core/conversation/<sid>
```

## Turn 1 — new session (HTTP 200 in 5.98s, includes model load)

```json
{"sessionId":"ae703989-d311-4f09-b6c4-79f7b5f9a130","reply":"Got it, teal!","model":"gemma4-e4b-unc:latest"}
```

## Turn 2 — same session (HTTP 200 in 0.38s)

```json
{"sessionId":"ae703989-d311-4f09-b6c4-79f7b5f9a130","reply":"Your favorite color is teal.","model":"gemma4-e4b-unc:latest"}
```

Cross-turn recall works: the model answered from session history, not from the single message.

## History (HTTP 200)

```json
{"sessionId":"ae703989-d311-4f09-b6c4-79f7b5f9a130","messages":[{"role":"user","content":"My favorite color is teal. Reply in one short sentence to confirm you noted it."},{"role":"assistant","content":"Got it, teal!"},{"role":"user","content":"What is my favorite color? Answer in one short sentence."},{"role":"assistant","content":"Your favorite color is teal."}]}
```

4 messages in order: user → assistant → user → assistant.

## Error cases

Empty message → HTTP 400:

```json
{"message":["message should not be empty"],"error":"Bad Request","statusCode":400}
```

Unknown session → HTTP 404:

```json
{"message":"Unknown session \"00000000-0000-0000-0000-000000000000\"","error":"Not Found","statusCode":404}
```

## Verdict

Pass. Generic OpenAI-compatible client works unchanged against a second backend/model (`violet:latest` verified earlier, `gemma4-e4b-unc:latest` here): session creation, multi-turn context, history retrieval, and validation/error mapping all behave per the Milestone 1 plan.
