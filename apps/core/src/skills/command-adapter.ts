import { BadRequestException } from '@nestjs/common';
import type { CoreConfig } from '../config';
import type {
  CommandContext,
  CommandResult,
  SlashCommandHandler,
} from '../commands/command-result';
import type { SkillService } from './skill.service';

export interface SkillCommandDeps {
  skills: SkillService;
  config: CoreConfig;
}

function formatSkillLine(skill: {
  name: string;
  version: string;
  description: string;
}): string {
  return `- ${skill.name} v${skill.version} — ${skill.description}`;
}

class SkillsCommand implements SlashCommandHandler {
  readonly name = 'skills';
  readonly description =
    'List, inspect, and refresh filesystem skills. No LLM contact.';
  constructor(private readonly deps: SkillCommandDeps) {}

  async execute(
    context: CommandContext,
    args: string[],
  ): Promise<CommandResult> {
    void context;
    const { skills } = this.deps;
    if (!skills.enabled) {
      return {
        kind: 'message',
        text: 'Skills are disabled (SKILLS_ENABLED=false). Conversation works without skills.',
        data: { enabled: false },
      };
    }
    const [sub, ...rest] = args;
    if (!sub) return this.list();
    switch (sub.toLowerCase()) {
      case 'show':
        return this.show(rest);
      case 'refresh':
        return this.refresh();
      case 'use':
      case 'drop':
      case 'active':
        return {
          kind: 'message',
          text: `/skills ${sub.toLowerCase()} lands in M7c — explicit session activation is not yet available.`,
          data: { pending: 'm7c' },
        };
      case 'pull':
        return {
          kind: 'message',
          text: '`/skills pull` lands in M7c — one-shot explicit retrieval is not yet available.',
          data: { pending: 'm7c' },
        };
      case 'suggest':
        return this.suggest(rest);
      default:
        throw new BadRequestException(
          'Usage: /skills [show <name> | refresh | suggest <text>]',
        );
    }
  }

  private list(): CommandResult {
    const { skills } = this.deps;
    const catalog = skills.listDescriptors();
    const report = skills.getReport();
    const lines =
      catalog.length === 0
        ? ['Skills: none (empty catalog).']
        : [`Skills (${catalog.length}):`, ...catalog.map(formatSkillLine)];
    if (report.skipped.length > 0) {
      lines.push(
        `Skipped (${report.skipped.length}):`,
        ...report.skipped.map((s) => `- ${s.name} (${s.reason})`),
      );
    }
    return {
      kind: 'data',
      text: lines.join('\n'),
      data: {
        enabled: true,
        skills: catalog,
        skipped: report.skipped,
      },
    };
  }

  private async show(args: string[]): Promise<CommandResult> {
    const [name] = args;
    if (!name) {
      throw new BadRequestException('Usage: /skills show <name>');
    }
    const skill = await this.deps.skills.loadBody(name);
    return {
      kind: 'data',
      text: [
        `# ${skill.name} v${skill.version}`,
        skill.description,
        '',
        skill.body,
      ].join('\n'),
      data: {
        name: skill.name,
        description: skill.description,
        version: skill.version,
        body: skill.body,
      },
    };
  }

  private suggest(args: string[]): CommandResult {
    const query = args.join(' ');
    if (!query.trim()) {
      throw new BadRequestException('Usage: /skills suggest <text>');
    }
    // Same engine as automatic discovery, human-visible: ranked names
    // only — never activates, never injects bodies.
    const matches = this.deps.skills.discover(query);
    const lines =
      matches.length === 0
        ? [`No skills match "${query}".`]
        : [
            `Skills matching "${query}":`,
            ...matches.map(
              (m) =>
                `- ${m.skill.name} (score ${m.score}, ${m.matchedOn.join('+')}) — ${m.skill.description}`,
            ),
          ];
    return {
      kind: 'data',
      text: lines.join('\n'),
      data: {
        query,
        matches: matches.map((m) => ({
          name: m.skill.name,
          score: m.score,
          matchedOn: m.matchedOn,
        })),
      },
    };
  }

  private async refresh(): Promise<CommandResult> {
    const { skills } = this.deps;
    const report = await skills.refresh();
    const lines = [
      `Skills refreshed: scanned ${report.scanned}, loaded ${report.loaded}, skipped ${report.skipped.length}.`,
    ];
    for (const skip of report.skipped) {
      lines.push(`- ${skip.name} (${skip.reason})`);
    }
    return {
      kind: 'data',
      text: lines.join('\n'),
      data: { ...report },
    };
  }
}

/** Register the M7a skill commands (M7b/M7c subcommands stubbed). */
export function registerSkillCommands(
  register: (handler: SlashCommandHandler) => void,
  deps: SkillCommandDeps,
): void {
  register(new SkillsCommand(deps));
}
