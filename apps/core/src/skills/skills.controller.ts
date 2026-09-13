import { Controller, Get, Param } from '@nestjs/common';
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
