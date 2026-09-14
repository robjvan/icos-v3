import type { CommandResult, SlashCommandHandler } from './command-result';
import { CommandRegistry, UnknownSlashCommandError } from './command-registry';

function handler(
  name: string,
  aliases: readonly string[] = [],
): SlashCommandHandler {
  return {
    name,
    aliases,
    description: `test ${name}`,
    execute: (): Promise<CommandResult> =>
      Promise.resolve({ kind: 'message', text: name }),
  };
}

describe('CommandRegistry', () => {
  it('resolves registered commands case-insensitively', () => {
    const registry = new CommandRegistry();
    const status = handler('status');
    registry.register(status);
    expect(registry.resolve('status')).toBe(status);
    expect(registry.resolve('STATUS')).toBe(status);
  });

  it('resolves aliases to the same handler', () => {
    const registry = new CommandRegistry();
    const thinking = handler('thinking', ['reasoning']);
    registry.register(thinking);
    expect(registry.resolve('reasoning')).toBe(thinking);
  });

  it('throws for unknown commands', () => {
    const registry = new CommandRegistry();
    expect(() => registry.resolve('nope')).toThrow(UnknownSlashCommandError);
  });

  it('rejects duplicate names and aliases', () => {
    const registry = new CommandRegistry();
    registry.register(handler('status'));
    expect(() => registry.register(handler('status'))).toThrow(/duplicate/i);
    expect(() => registry.register(handler('other', ['status']))).toThrow(
      /duplicate/i,
    );
  });

  it('lists canonical names without aliases', () => {
    const registry = new CommandRegistry();
    registry.register(handler('status'));
    registry.register(handler('thinking', ['reasoning']));
    expect(registry.commandNames).toEqual(['status', 'thinking']);
  });
});
