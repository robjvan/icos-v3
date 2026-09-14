import { BadRequestException } from '@nestjs/common';
import type { CoreConfig } from '../config';
import { SessionStore } from '../conversation/session.store';
import type { MemoryCandidateRepository } from '../memory/memory-candidate.repository';
import type {
  CommandContext,
  CommandResult,
  SlashCommandHandler,
} from './command-result';
import { DisplayPreferenceStore } from './display-preferences';
import type { HostHealth } from './host-health';
import {
  HostHealthProvider,
  formatGib,
  formatUptime,
  percent,
} from './host-health';

export interface RuntimeCommandDeps {
  sessions: SessionStore;
  candidates: MemoryCandidateRepository;
  config: CoreConfig;
  prefs: DisplayPreferenceStore;
  host: HostHealthProvider;
}

type CheckStatus = 'healthy' | 'degraded' | 'unknown';

class HealthCommand implements SlashCommandHandler {
  readonly name = 'health';
  readonly description =
    'Deterministic runtime + host health. No LLM generation.';
  constructor(private readonly deps: RuntimeCommandDeps) {}

  async execute(): Promise<CommandResult> {
    const { sessions, candidates, config, host } = this.deps;
    const checks: Record<string, { status: CheckStatus; detail: string }> = {
      core: {
        status: 'healthy',
        detail: `uptime ${Math.floor(process.uptime())}s`,
      },
    };
    try {
      await sessions.pingStores();
      checks.sessions = { status: 'healthy', detail: 'sessions database ok' };
    } catch (err) {
      checks.sessions = {
        status: 'degraded',
        detail: err instanceof Error ? err.message : 'unreachable',
      };
    }
    try {
      await candidates.ping();
      checks.memory = { status: 'healthy', detail: 'memory database ok' };
    } catch (err) {
      checks.memory = {
        status: 'degraded',
        detail: err instanceof Error ? err.message : 'unreachable',
      };
    }
    // Configured is not healthy: no active probe exists, so reachability
    // stays `unknown` rather than claiming what was never checked.
    const llmConfigured = Boolean(config.llmBaseUrl && config.llmModel);
    checks.llm = llmConfigured
      ? {
          status: 'unknown',
          detail: `configured (provider=${config.provider}, model=${config.llmModel}); reachability not probed`,
        }
      : { status: 'degraded', detail: 'LLM provider not configured' };

    const hostHealth = await host.collect();
    const overall =
      checks.sessions.status === 'degraded' ||
      checks.memory.status === 'degraded' ||
      checks.llm.status === 'degraded'
        ? 'degraded'
        : 'healthy';

    const data: Record<string, unknown> = {
      runtime: {
        core: checks.core,
        sessions: checks.sessions,
        memory: checks.memory,
        llm: {
          status: checks.llm.status,
          detail: checks.llm.detail,
          provider: config.provider,
          model: config.llmModel,
        },
      },
      host: {
        os: hostHealth.os,
        arch: hostHealth.arch,
        uptimeSeconds: hostHealth.uptimeSeconds,
        cpuCores: hostHealth.cpuCores,
        cpuPercent: hostHealth.cpuPercent,
        loadAverage: hostHealth.loadAverage,
        memoryUsedBytes: hostHealth.memoryUsedBytes,
        memoryTotalBytes: hostHealth.memoryTotalBytes,
        diskUsedBytes: hostHealth.diskUsedBytes,
        diskTotalBytes: hostHealth.diskTotalBytes,
        gpu: hostHealth.gpu,
      },
      status: overall,
    };
    const lines = [
      'ICOS Runtime',
      `  Core: ${checks.core.status} (${checks.core.detail})`,
      `  Sessions DB: ${checks.sessions.status}`,
      `  Memory DB: ${checks.memory.status}`,
      `  LLM: configured (provider=${config.provider}, model=${config.llmModel})`,
      '       Reachability: not probed',
      '',
      'Host System',
      ...renderHostLines(hostHealth),
      '',
      `Status: ${overall}`,
    ];
    return { kind: 'data', text: lines.join('\n'), data };
  }
}

function renderHostLines(host: HostHealth): string[] {
  const lines = [
    `  OS: ${host.os}`,
    `  Arch: ${host.arch}`,
    `  Uptime: ${formatUptime(host.uptimeSeconds)}`,
    `  CPU: ${host.cpuPercent === null ? 'n/a' : `${host.cpuPercent}%`} / ${host.cpuCores} cores`,
    `  Memory: ${formatGib(host.memoryUsedBytes)} / ${formatGib(host.memoryTotalBytes)} GB (${percent(host.memoryUsedBytes, host.memoryTotalBytes)}%)`,
    `  Disk: ${host.diskUsedBytes === null || host.diskTotalBytes === null ? 'n/a' : `${formatGib(host.diskUsedBytes)} / ${formatGib(host.diskTotalBytes)} GB (${percent(host.diskUsedBytes, host.diskTotalBytes)}%)`}`,
    `  Load: ${host.loadAverage.map((v) => v.toFixed(2)).join(' / ')}`,
  ];
  if (host.gpu) {
    lines.push(
      `  GPU: ${host.gpu.name}`,
      `  GPU Memory: ${formatGib(host.gpu.memoryUsedBytes)} / ${formatGib(host.gpu.memoryTotalBytes)} GB (${percent(host.gpu.memoryUsedBytes, host.gpu.memoryTotalBytes)}%)`,
      `  GPU Temp: ${host.gpu.temperatureC === null ? 'n/a' : `${host.gpu.temperatureC}°C`}`,
    );
  } else {
    lines.push('  GPU: n/a');
  }
  return lines;
}

function togglePreference(
  prefs: DisplayPreferenceStore,
  sessionId: string | undefined,
  command: 'thinking' | 'timestamps',
  args: string[],
): CommandResult {
  const key = command === 'thinking' ? 'showThinking' : 'showTimestamps';
  if (!sessionId) {
    const defaults = prefs.defaults();
    return {
      kind: 'message',
      text:
        `${command} is ${defaults[key] ? 'on' : 'off'} by default. ` +
        `Send a message first to change it for a session.`,
    };
  }
  const current = prefs.get(sessionId);
  let next = !current[key];
  if (args.length > 0) {
    const arg = args[0].toLowerCase();
    if (arg === 'on') next = true;
    else if (arg === 'off') next = false;
    else {
      throw new BadRequestException(`Usage: /${command} [on|off]`);
    }
  }
  prefs.set(sessionId, { [key]: next });
  return {
    kind: 'message',
    text: `${command} ${next ? 'on' : 'off'}.`,
    data: { sessionId, [key]: next },
  };
}

class ThinkingCommand implements SlashCommandHandler {
  readonly name = 'thinking';
  readonly description =
    'Toggle reasoning/thinking visibility for the session.';
  constructor(private readonly deps: RuntimeCommandDeps) {}

  execute(context: CommandContext, args: string[]): Promise<CommandResult> {
    // M6a scope: display visibility only. When model reasoning control
    // (`/variant`) lands, `/thinking` becomes its alias per the notes.
    return Promise.resolve(
      togglePreference(this.deps.prefs, context.sessionId, 'thinking', args),
    );
  }
}

class TimestampsCommand implements SlashCommandHandler {
  readonly name = 'timestamps';
  readonly description = 'Toggle timestamp visibility for the session.';
  constructor(private readonly deps: RuntimeCommandDeps) {}

  execute(context: CommandContext, args: string[]): Promise<CommandResult> {
    return Promise.resolve(
      togglePreference(this.deps.prefs, context.sessionId, 'timestamps', args),
    );
  }
}

class RestartRuntimeCommand implements SlashCommandHandler {
  readonly name = 'restart-runtime';
  readonly description = 'Request a Core restart (unavailable in dev).';

  execute(): Promise<CommandResult> {
    // No process supervisor exists in this environment; report honestly
    // rather than terminating anything. Never wired to LLM invocation.
    return Promise.resolve({
      kind: 'message',
      text: 'Runtime restart is unavailable in this environment. Restart the Core process directly to pick up configuration changes.',
      data: { restartable: false },
    });
  }
}

/** Register the M6a runtime-visibility commands. */
export function registerRuntimeCommands(
  register: (handler: SlashCommandHandler) => void,
  deps: RuntimeCommandDeps,
): void {
  register(new HealthCommand(deps));
  register(new ThinkingCommand(deps));
  register(new TimestampsCommand(deps));
  register(new RestartRuntimeCommand());
}
