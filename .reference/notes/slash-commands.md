# ICOS v3 Slash Commands

## Initial Catalog

- `/status` - display current session status - model, context size, usage, etc

- `/new` - start new session

- `/health` - display current host system and runtime health

- `/export` - export session transcript

- `/rename` - rename session

- `/thinking` - show/collapse thinking

- `/timestamps` - show time stamps

- `/undo` - undo previous message

- `/fork` - fork session

- `/restart-runtime` - restart the runtime

- `/context` - show current context debug info (see example below)
  ```text
  System:          2,341 tokens
  History:         4,821 tokens
  Skills:            642 tokens
  Memory:              0 tokens
  Current input:     117 tokens
  ────────────────────────────
  Total:           7,921 tokens
  Limit:          16,384 tokens
  ```  

## Planned commands

- `/skills` - Skills

- `/mcps` - Toggle MCP servers

- `/memory` - memory ...

- `/compact` - compact current session (how does this work exactly?)

- `/model` - change model on the fly (dropdown in UI sidebar also?)

- `/variant` - change model reasoning level (off, low, med, high, xhigh, etc)
  - `/thinking` - alias for `/variant`
  - `/reasoning` - alias for `/variant`

- `/temperature` - ...
  - `/temp` - alias for `/temperature`
