import { Inject, Injectable } from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { SessionStore } from '../conversation/session.store';
import { MemoryCandidateRepository } from '../memory/memory-candidate.repository';
import { HostHealthProvider } from '../commands/host-health';
import { buildHealthReport } from './health-report';
import type { HealthReport } from './health-report';

/**
 * Pollable system health for auxiliary surfaces (web-client footer).
 * Delegates to the shared builder so the endpoint and the `/health`
 * slash command always report the same data.
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly sessions: SessionStore,
    private readonly candidates: MemoryCandidateRepository,
    private readonly host: HostHealthProvider,
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
  ) {}

  collect(): Promise<HealthReport> {
    return buildHealthReport({
      sessions: this.sessions,
      candidates: this.candidates,
      config: this.config,
      host: this.host,
    });
  }
}
