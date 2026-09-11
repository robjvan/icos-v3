import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { SessionStore } from '../conversation/session.store';
import { MemoryCandidateRepository } from '../memory/memory-candidate.repository';
import type {
  CommandContext,
  CommandResult,
  SlashCommandHandler,
} from './command-result';
import { CommandRegistry, UnknownSlashCommandError } from './command-registry';
import { DisplayPreferenceStore } from './display-preferences';
import { HostHealthProvider } from './host-health';
import { registerRuntimeCommands } from './runtime-commands';
import { registerSessionCommands } from './session-commands';
import {
  MalformedSlashCommandError,
  isSlashCommandInput,
  parseSlashCommand,
} from './slash-command.parser';
import type { ParsedSlashCommand } from './slash-command.parser';

/**
 * Slash-command entry point. Owns the registry and the builtin catalog;
 * `ConversationService` consults it before any LLM processing, so a
 * command can never leak into ordinary conversation.
 */
@Injectable()
export class CommandDispatcher {
  private readonly registry = new CommandRegistry();

  constructor(
    private readonly sessions: SessionStore,
    private readonly candidates: MemoryCandidateRepository,
    private readonly prefs: DisplayPreferenceStore,
    private readonly host: HostHealthProvider,
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
  ) {
    const register = (handler: SlashCommandHandler): void => {
      this.registry.register(handler);
    };
    registerSessionCommands(register, {
      sessions,
      config,
      prefs,
      activeStreams: () => CommandDispatcher.activeStreams,
    });
    registerRuntimeCommands(register, {
      sessions,
      candidates,
      config,
      prefs,
      host,
    });
  }

  /** In-flight SSE streams; maintained by `ConversationService`. */
  private static streams = 0;
  private static get activeStreams(): number {
    return CommandDispatcher.streams;
  }
  static trackStreamStart(): void {
    CommandDispatcher.streams += 1;
  }
  static trackStreamEnd(): void {
    CommandDispatcher.streams = Math.max(0, CommandDispatcher.streams - 1);
  }

  isCommand(message: string): boolean {
    return isSlashCommandInput(message);
  }

  get commandNames(): string[] {
    return this.registry.commandNames;
  }

  /**
   * Parse and run a command. Malformed input, unknown names, and usage
   * errors surface as deterministic HTTP errors (400/404) — never LLM.
   */
  async dispatch(raw: string, sessionId?: string): Promise<CommandResult> {
    let parsed: ParsedSlashCommand;
    try {
      parsed = parseSlashCommand(raw);
    } catch (err) {
      if (err instanceof MalformedSlashCommandError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
    let handler: SlashCommandHandler;
    try {
      handler = this.registry.resolve(parsed.name);
    } catch (err) {
      if (err instanceof UnknownSlashCommandError) {
        throw new NotFoundException(err.message);
      }
      throw err;
    }
    const context: CommandContext = { sessionId, raw };
    return await handler.execute(context, parsed.args);
  }
}
