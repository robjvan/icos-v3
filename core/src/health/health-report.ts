import type { CoreConfig } from '../config';
import type { SessionStore } from '../conversation/session.store';
import type { MemoryCandidateRepository } from '../memory/memory-candidate.repository';
import type { HostHealth, HostHealthProvider } from '../commands/host-health';

export type HealthCheckStatus = 'healthy' | 'degraded' | 'unknown';

export interface HealthCheck {
  status: HealthCheckStatus;
  detail: string;
}

export interface LlmHealthCheck extends HealthCheck {
  provider: string;
  model: string;
}

/**
 * Pollable health payload. Same shape as the `/health` slash-command
 * `data` — one model serves both the conversation API and `GET /core/health`.
 */
export interface HealthReport {
  status: 'healthy' | 'degraded';
  runtime: {
    core: HealthCheck;
    sessions: HealthCheck;
    memory: HealthCheck;
    llm: LlmHealthCheck;
  };
  host: HostHealth;
}

export interface HealthReportDeps {
  sessions: SessionStore;
  candidates: MemoryCandidateRepository;
  config: CoreConfig;
  host: HostHealthProvider;
}

/**
 * Single source of truth for health data. Shared by the `/health`
 * slash command and the `GET /core/health` endpoint so the two can
 * never drift apart.
 */
export async function buildHealthReport(
  deps: HealthReportDeps,
): Promise<HealthReport> {
  const { sessions, candidates, config, host } = deps;
  const core: HealthCheck = {
    status: 'healthy',
    detail: `uptime ${Math.floor(process.uptime())}s`,
  };
  let sessionsCheck: HealthCheck;
  try {
    await sessions.pingStores();
    sessionsCheck = { status: 'healthy', detail: 'sessions database ok' };
  } catch (err) {
    sessionsCheck = {
      status: 'degraded',
      detail: err instanceof Error ? err.message : 'unreachable',
    };
  }
  let memory: HealthCheck;
  try {
    await candidates.ping();
    memory = { status: 'healthy', detail: 'memory database ok' };
  } catch (err) {
    memory = {
      status: 'degraded',
      detail: err instanceof Error ? err.message : 'unreachable',
    };
  }
  // Configured is not healthy: no active probe exists, so reachability
  // stays `unknown` rather than claiming what was never checked.
  const llmConfigured = Boolean(config.llmBaseUrl && config.llmModel);
  const llm: LlmHealthCheck = llmConfigured
    ? {
        status: 'unknown',
        detail: `configured (provider=${config.provider}, model=${config.llmModel}); reachability not probed`,
        provider: config.provider,
        model: config.llmModel,
      }
    : {
        status: 'degraded',
        detail: 'LLM provider not configured',
        provider: config.provider,
        model: config.llmModel,
      };

  const hostHealth = await host.collect();
  const status =
    sessionsCheck.status === 'degraded' ||
    memory.status === 'degraded' ||
    llm.status === 'degraded'
      ? 'degraded'
      : 'healthy';

  return {
    status,
    runtime: {
      core,
      sessions: sessionsCheck,
      memory,
      llm,
    },
    host: hostHealth,
  };
}
