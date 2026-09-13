import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { SkillService } from './skill.service';

/**
 * Read-only skill inspection endpoints. Debug/observation surface —
 * the filesystem is the writer; there are no skill mutations here.
 */
@Controller('core/skills')
export class SkillsController {
  constructor(private readonly skills: SkillService) {}

  @Get()
  list(): {
    enabled: boolean;
    skills: { name: string; description: string; version: string }[];
    skipped: { name: string; reason: string }[];
  } {
    return {
      enabled: this.skills.enabled,
      skills: this.skills.listDescriptors(),
      skipped: this.skills.getReport().skipped,
    };
  }

  @Get('discover')
  discover(@Query('q') query?: string): {
    query: string;
    matches: { name: string; score: number; matchedOn: string[] }[];
  } {
    if (!query?.trim()) {
      throw new BadRequestException('Usage: /core/skills/discover?q=<text>');
    }
    return {
      query,
      matches: this.skills.discover(query).map((m) => ({
        name: m.skill.name,
        score: m.score,
        matchedOn: m.matchedOn,
      })),
    };
  }

  @Get(':name')
  async get(@Param('name') name: string): Promise<{
    name: string;
    description: string;
    version: string;
    body: string;
  }> {
    const skill = await this.skills.loadBody(name);
    return {
      name: skill.name,
      description: skill.description,
      version: skill.version,
      body: skill.body,
    };
  }
}
