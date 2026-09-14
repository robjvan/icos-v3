import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createRequire } from 'node:module';
import type { CoreConfig } from '../config';
import { SessionStore } from '../conversation/session.store';
import type { HistoryMessage } from '../conversation/session.store';
import type { Session } from '../session/session.repository';
import type {
  CommandContext,
  CommandResult,
  SlashCommandHandler,
} from './command-result';
import { DisplayPreferenceStore } from './display-preferences';
import { SkillService } from '../skills/skill.service';

export function requireSessionId(
  context: CommandContext,
  command: string,
): string {
  if (!context.sessionId) {
    throw new BadRequestException(
      `"/${command}" needs an active session — send a message first.`,
    );
  }
  return context.sessionId;
}

async function requireSession(
  sessions: SessionStore,
  sessionId: string,
  command: string,
): Promise<Session> {
  const session = await sessions.getSession(sessionId);
  if (!session) {
    // Commands never auto-create: an unknown id here is caller error.
    throw new NotFoundException(
      `Unknown session "${sessionId}" for "/${command}"`,
    );
  }
  return session;
}

function packageVersion(): string {
  try {
    const require = createRequire(__filename);
    const pkg = require('../../package.json') as { version?: unknown };
    if (typeof pkg.version === 'string' && pkg.version) return pkg.version;
  } catch {
    // Static fallback below.
  }
  return '0.0.0';
}

function renderSkillsSummary(skills: SkillService): string {
  if (!skills.enabled) return 'Skills: disabled';
  return `Skills: enabled, catalog ${String(skills.listDescriptors().length)}`;
}

function skillsSummaryData(skills: SkillService): Record<string, unknown> {
  return {
    enabled: skills.enabled,
    catalogSize: skills.listDescriptors().length,
  };
}

function renderSessionSkills(
  skills: SkillService,
  sessionId: string,
): string[] {
  if (!skills.enabled) return [];
  const explicit = skills.getExplicitNames(sessionId);
  const lines = [
    `Skills pinned: ${explicit.length > 0 ? explicit.join(', ') : 'none'}`,
  ];
  const pending = skills.getPendingNames(sessionId);
  if (pending.length > 0) {
    lines.push(`Skills staged: ${pending.join(', ')}`);
  }
  const last = skills.getLastTurn(sessionId);
  if (last) {
    lines.push(
      `Last turn skills: explicit ${String(last.chars.explicit)} + ` +
        `requested ${String(last.chars.requested)} + ` +
        `contextual ${String(last.chars.contextual)} chars`,
    );
    const names = [...last.explicit, ...last.requested, ...last.contextual];
    if (names.length > 0) lines.push(`  (${names.join(', ')})`);
  }
  return lines;
}

function sessionSkillsData(
  skills: SkillService,
  sessionId: string,
): Record<string, unknown> {
  return {
    enabled: skills.enabled,
    explicit: skills.getExplicitNames(sessionId),
    pending: skills.getPendingNames(sessionId),
    lastTurn: skills.getLastTurn(sessionId),
  };
}

export interface SessionCommandDeps {
  sessions: SessionStore;
  config: CoreConfig;
  prefs: DisplayPreferenceStore;
  skills: SkillService;
  /** Current in-flight SSE streams, for `/status` honesty. */
  activeStreams: () => number;
}

class StatusCommand implements SlashCommandHandler {
  readonly name = 'status';
  readonly description = 'Show current session and runtime state.';
  constructor(private readonly deps: SessionCommandDeps) {}

  async execute(context: CommandContext): Promise<CommandResult> {
    const { sessions, config, prefs, skills, activeStreams } = this.deps;
    const lines = [`Runtime: icos/${packageVersion()}`];
    lines.push(`Provider: ${config.provider} · Model: ${config.llmModel}`);
    lines.push(renderSkillsSummary(skills));
    const data: Record<string, unknown> = {
      provider: config.provider,
      model: config.llmModel,
      runtime: `icos/${packageVersion()}`,
      activeStreams: activeStreams(),
      skills: skillsSummaryData(skills),
    };
    if (context.sessionId) {
      const session = await requireSession(
        sessions,
        context.sessionId,
        'status',
      );
      const history = (await sessions.getHistory(session.id)) ?? [];
      const inContext = history.filter((m) => !m.excludedFromContext);
      const windowed = inContext.slice(-config.maxHistory);
      const display = prefs.get(session.id);
      lines.push(
        `Session: ${session.id}`,
        ...(session.title ? [`Title: ${session.title}`] : []),
        `Messages: ${history.length} (context window: ${windowed.length}/${config.maxHistory})`,
        `Created: ${session.createdAt} · Updated: ${session.updatedAt}`,
        `Streaming: ${activeStreams() > 0 ? `${activeStreams()} active` : 'idle'}`,
        `Display: thinking=${display.showThinking ? 'on' : 'off'}, timestamps=${display.showTimestamps ? 'on' : 'off'}`,
        ...renderSessionSkills(skills, session.id),
      );
      Object.assign(data, {
        sessionId: session.id,
        ...(session.title ? { title: session.title } : {}),
        messageCount: history.length,
        contextWindowUsed: windowed.length,
        contextWindowLimit: config.maxHistory,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        display,
        sessionSkills: sessionSkillsData(skills, session.id),
      });
    } else {
      lines.push('Session: none (send a message to start one)');
      lines.push(
        `Streaming: ${activeStreams() > 0 ? `${activeStreams()} active` : 'idle'}`,
      );
    }
    return { kind: 'data', text: lines.join('\n'), data };
  }
}

class NewCommand implements SlashCommandHandler {
  readonly name = 'new';
  readonly description = 'Start a new conversation session.';
  constructor(private readonly deps: SessionCommandDeps) {}

  async execute(): Promise<CommandResult> {
    const { id } = await this.deps.sessions.resolve(undefined);
    return {
      kind: 'session',
      sessionId: id,
      text: `New session started.\nSession: ${id}`,
      data: { sessionId: id },
    };
  }
}

function renderExport(
  session: Session,
  history: HistoryMessage[],
  exportedAt: string,
): string {
  const lines = [
    `# Session ${session.id}`,
    ...(session.title ? [`Title: ${session.title}`] : []),
    `Created: ${session.createdAt}`,
    `Updated: ${session.updatedAt}`,
    `Exported: ${exportedAt}`,
    `Messages: ${history.length}`,
    '',
  ];
  history.forEach((message, index) => {
    lines.push(
      `## ${index + 1}. ${message.role}` +
        (message.excludedFromContext ? ' (excluded from context)' : ''),
      '',
      message.content,
      '',
    );
  });
  return lines.join('\n');
}

class ExportCommand implements SlashCommandHandler {
  readonly name = 'export';
  readonly description = 'Export the session transcript as Markdown.';
  constructor(private readonly deps: SessionCommandDeps) {}

  async execute(context: CommandContext): Promise<CommandResult> {
    const sessionId = requireSessionId(context, 'export');
    const session = await requireSession(
      this.deps.sessions,
      sessionId,
      'export',
    );
    const history = (await this.deps.sessions.getHistory(session.id)) ?? [];
    // Transcript content only — config, keys, and headers never included.
    const markdown = renderExport(session, history, new Date().toISOString());
    return {
      kind: 'data',
      text: markdown,
      data: {
        format: 'markdown',
        sessionId: session.id,
        messageCount: history.length,
        markdown,
      },
    };
  }
}

class RenameCommand implements SlashCommandHandler {
  readonly name = 'rename';
  readonly description = 'Set the session title. Transcript untouched.';
  constructor(private readonly deps: SessionCommandDeps) {}

  async execute(
    context: CommandContext,
    args: string[],
  ): Promise<CommandResult> {
    const sessionId = requireSessionId(context, 'rename');
    const title = args.join(' ').trim();
    if (!title) {
      throw new BadRequestException('Usage: /rename <title>');
    }
    await requireSession(this.deps.sessions, sessionId, 'rename');
    // Title lives on the session row; transcript rows are never modified.
    await this.deps.sessions.renameSession(sessionId, title);
    return {
      kind: 'message',
      text: `Session renamed.\nTitle: ${title}`,
      data: { sessionId, title },
    };
  }
}

class UndoCommand implements SlashCommandHandler {
  readonly name = 'undo';
  readonly description =
    'Reversibly exclude the last turn from LLM context. Transcript kept.';
  constructor(private readonly deps: SessionCommandDeps) {}

  async execute(context: CommandContext): Promise<CommandResult> {
    const sessionId = requireSessionId(context, 'undo');
    await requireSession(this.deps.sessions, sessionId, 'undo');
    const excluded = await this.deps.sessions.excludeLastTurn(sessionId);
    if (!excluded) {
      return { kind: 'message', text: 'Nothing to undo.' };
    }
    return {
      kind: 'message',
      text:
        `Last turn excluded from context (${excluded.length} message${excluded.length === 1 ? '' : 's'}). ` +
        `Transcript preserved — a future /redo can restore it.`,
      data: { sessionId, excludedMessageIds: excluded },
    };
  }
}

class ForkCommand implements SlashCommandHandler {
  readonly name = 'fork';
  readonly description =
    'Copy this session transcript into a new session. Source untouched.';
  constructor(private readonly deps: SessionCommandDeps) {}

  async execute(context: CommandContext): Promise<CommandResult> {
    const sessionId = requireSessionId(context, 'fork');
    await requireSession(this.deps.sessions, sessionId, 'fork');
    const newId = await this.deps.sessions.forkSession(sessionId);
    // Pinned procedures carry over ("continue from here"); staged one-shots
    // and last-turn reports are turn-scoped and stay behind.
    this.deps.skills.copyExplicitPins(sessionId, newId);
    return {
      kind: 'session',
      sessionId: newId,
      text: `Session forked.\nSource: ${sessionId}\nFork: ${newId}`,
      data: { sourceSessionId: sessionId, sessionId: newId },
    };
  }
}

/** Register the M6a session-lifecycle commands. */
export function registerSessionCommands(
  register: (handler: SlashCommandHandler) => void,
  deps: SessionCommandDeps,
): void {
  register(new StatusCommand(deps));
  register(new NewCommand(deps));
  register(new ExportCommand(deps));
  register(new RenameCommand(deps));
  register(new UndoCommand(deps));
  register(new ForkCommand(deps));
}
