# ICOS v3 Core

## Description

TBD

- Core agentic loop
- Handles conversations

## Core Loop

```typescript
 INPUT
          │
          ▼
       CORE
          │
    ┌─────┴─────┐
    ▼           ▼
 MEMORY       CONTEXT
    │           │
    └─────┬─────┘
          ▼
         LLM
          │
          ▼
     MODEL SENTINEL
          │
     ┌────┴────┐
     │         │
    good      bad/uncertain
     │         │
     ▼         ▼
   action    revise/retry
     │
     ▼
   MEMORY
```

```typescript
ICOS
 │
 └── Agent Runtime Interface
       │
       ├── conversation()
       ├── generate()
       ├── tool_call()
       ├── observe()
       ├── execute()
       ├── interrupt()
       └── result()
```

```typescript
while (session.active) {

    const input = await interface.nextMessage();

    const memories = await memory.recall({
        input,
        session,
        profile
    });

    const context = cognition.buildContext({
        input,
        memories,
        session,
        profile
    });

    const response = await model.generate(context);

    const assessment = await sentinel.evaluate({
        input,
        context,
        response
    });

    if (assessment.requiresAction) {
        const results = await tools.execute(assessment.actions);

        await memory.record({
            input,
            response,
            actions: assessment.actions,
            results
        });

        continue;
    }

    await memory.consolidate({
        input,
        response,
        assessment
    });

    await interface.respond(response);
}
```