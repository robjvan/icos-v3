/**
 * Command result contract. Results are structured data with a
 * human-readable rendering — never fake LLM messages. Chat surfaces
 * render `text`; future clients consume `kind`/`data` directly.
 */
export type CommandResultKind = 'message' | 'data' | 'session' | 'error';

export interface CommandResult {
  kind: CommandResultKind;
  /** Deterministic human-readable rendering. */
  text: string;
  /** Set when the command switches the active session (`/new`, `/fork`). */
  sessionId?: string;
  /** Machine-readable payload for future Web/Desktop clients. */
  data?: Record<string, unknown>;
}

/** Invocation context passed to every handler. */
export interface CommandContext {
  /** Resolved caller session, if one was supplied. */
  sessionId?: string;
  /** Original raw input. */
  raw: string;
}

export interface SlashCommandHandler {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly description: string;
  execute(context: CommandContext, args: string[]): Promise<CommandResult>;
}
