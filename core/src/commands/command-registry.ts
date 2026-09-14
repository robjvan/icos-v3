import type { SlashCommandHandler } from './command-result';

export class UnknownSlashCommandError extends Error {
  constructor(name: string) {
    super(`Unknown slash command "/${name}"`);
    this.name = 'UnknownSlashCommandError';
  }
}

/**
 * Name → handler dispatch. New commands register; nothing here changes
 * when the catalog grows. Aliases resolve to the same handler.
 */
export class CommandRegistry {
  private readonly handlers = new Map<string, SlashCommandHandler>();

  register(handler: SlashCommandHandler): void {
    if (this.handlers.has(handler.name)) {
      throw new Error(`Duplicate slash command "/${handler.name}"`);
    }
    this.handlers.set(handler.name, handler);
    for (const alias of handler.aliases ?? []) {
      const key = alias.toLowerCase();
      if (this.handlers.has(key)) {
        throw new Error(`Duplicate slash command alias "/${alias}"`);
      }
      this.handlers.set(key, handler);
    }
  }

  resolve(name: string): SlashCommandHandler {
    const handler = this.handlers.get(name.toLowerCase());
    if (!handler) throw new UnknownSlashCommandError(name);
    return handler;
  }

  /** Canonical command names (no aliases), sorted. */
  get commandNames(): string[] {
    const names = new Set<string>();
    for (const handler of this.handlers.values()) names.add(handler.name);
    return [...names].sort();
  }
}
