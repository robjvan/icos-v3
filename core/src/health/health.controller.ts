import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';
import type { HealthReport } from './health-report';

/**
 * Pollable system health for auxiliary surfaces (web-client footer).
 * Same data as the `/health` slash command, without a conversation turn.
 */
@Controller('core/health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  async collect(): Promise<HealthReport> {
    return this.health.collect();
  }
}
