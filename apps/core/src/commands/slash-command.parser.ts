/**
 * Deterministic slash-command parser. Recognizes leading-`/` input and
 * returns a structured representation; anything else is ordinary
 * conversation and never reaches this parser as a command.
 */
export interface ParsedSlashCommand {
  /** Lowercase command name without the leading slash. */
  name: string;
  /** Quote-aware argument list. */
  args: string[];
  /** Original raw input. */
  raw: string;
}

export class MalformedSlashCommandError extends Error {
  constructor(raw: string) {
    super(`Malformed slash command: "${raw}"`);
    this.name = 'MalformedSlashCommandError';
  }
}

const COMMAND_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

/** True when the input is a command attempt (leading `/` after trim). */
export function isSlashCommandInput(message: string): boolean {
  return message.trimStart().startsWith('/');
}

export function parseSlashCommand(raw: string): ParsedSlashCommand {
  const text = raw.trim();
  if (!text.startsWith('/')) {
    throw new MalformedSlashCommandError(raw);
  }
  const body = text.slice(1).trim();
  if (!body) throw new MalformedSlashCommandError(raw);
  const tokens = splitArgs(body);
  if (tokens.length === 0) throw new MalformedSlashCommandError(raw);
  const name = tokens[0].toLowerCase();
  if (!COMMAND_NAME_PATTERN.test(name)) {
    throw new MalformedSlashCommandError(raw);
  }
  return { name, args: tokens.slice(1), raw };
}

/**
 * Whitespace splitting with double-quote grouping (`/rename "my title"`).
 * Backslash escapes the next character inside quotes. Unclosed quotes
 * consume the rest of the input rather than failing.
 */
function splitArgs(body: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  let escaped = false;
  let hasToken = false;

  for (const char of body) {
    if (escaped) {
      current += char;
      escaped = false;
      hasToken = true;
      continue;
    }
    if (inQuotes && char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      hasToken = true;
      continue;
    }
    if (!inQuotes && /\s/.test(char)) {
      if (hasToken) {
        tokens.push(current);
        current = '';
        hasToken = false;
      }
      continue;
    }
    current += char;
    hasToken = true;
  }
  if (hasToken) tokens.push(current);
  return tokens;
}
