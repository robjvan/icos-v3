import { BadRequestException, NotFoundException } from '@nestjs/common';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { SKILL_FILE } from './skill-loader';
import { SkillService } from './skill.service';
import { SkillsController } from './skills.controller';

function testConfig(
  skillsDirPath: string,
  overrides: Partial<CoreConfig> = {},
): CoreConfig {
  return {
    port: 3000,
    provider: 'ollama',
    llmBaseUrl: 'http://localhost:11434/v1',
    llmModel: 'test-model',
    llmTimeoutMs: 1000,
    systemPrompt: 'test-system',
    maxHistory: 50,
    sessionDbPath: ':memory:',
    memoryDbPath: ':memory:',
    legacyDbPath: '/tmp/icos-test-legacy-missing.sqlite',
    memoryExtractionEnabled: false,
    memoryProvider: 'ollama',
    memoryLlmBaseUrl: 'http://localhost:11434/v1',
    memoryLlmModel: 'test-model',
    memoryLlmTimeoutMs: 1000,
    skillsDirPath,
    skillsEnabled: true,
    skillsMaxBodyChars: 12000,
    skillsMaxCatalogItems: 50,
    skillsMaxActivePerSession: 5,
    skillsMaxAutoLoadedPerTurn: 2,
    skillsMaxContextChars: 8000,
    agentMaxIterations: 5,
    agentMaxToolSteps: 5,
    agentMaxTurnDurationMs: 900000,
    ...overrides,
  };
}

describe('SkillsController', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-skills-ctl-'));
    mkdirSync(join(dir, 'daily-journal'), { recursive: true });
    writeFileSync(
      join(dir, 'daily-journal', SKILL_FILE),
      '---\nname: daily-journal\ndescription: Journal.\n---\n\nAsk away.\n',
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function controller(
    overrides: Partial<CoreConfig> = {},
  ): Promise<SkillsController> {
    const service = new SkillService(testConfig(dir, overrides));
    await service.onModuleInit();
    return new SkillsController(service);
  }

  it('lists descriptors plus skip reasons', async () => {
    const body = (await controller()).list();
    expect(body.enabled).toBe(true);
    expect(body.skills).toEqual([
      { name: 'daily-journal', description: 'Journal.', version: '0.0.0' },
    ]);
    expect(body.skipped).toEqual([]);
  });

  it('returns one skill body by name', async () => {
    const body = await (await controller()).get('DAILY-JOURNAL');
    expect(body).toEqual({
      name: 'daily-journal',
      description: 'Journal.',
      version: '0.0.0',
      body: 'Ask away.',
    });
  });

  it('maps unknown skills to 404', async () => {
    await expect((await controller()).get('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reports disabled mode and blocks body reads', async () => {
    const ctl = await controller({ skillsEnabled: false });
    expect(ctl.list()).toEqual({ enabled: false, skills: [], skipped: [] });
    await expect(ctl.get('daily-journal')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('reports explicit, requested, and last-turn scopes', async () => {
    const service = new SkillService(testConfig(dir, {}));
    await service.onModuleInit();
    const ctl = new SkillsController(service);
    expect(() => ctl.active()).toThrow(BadRequestException);
    expect(ctl.active('s1')).toEqual({
      sessionId: 's1',
      explicit: [],
      requested: [],
      contextual: [],
      lastTurn: null,
    });
    service.useSkill('s1', 'daily-journal');
    await service.stageOneShot('s1', 'daily-journal');
    expect(ctl.active('s1')).toMatchObject({
      explicit: ['daily-journal'],
      requested: ['daily-journal'],
    });
  });

  it('discovers ranked matches without loading bodies', async () => {
    const ctl = await controller();
    expect(ctl.discover('journal')).toEqual({
      query: 'journal',
      matches: [{ name: 'daily-journal', score: 2, matchedOn: ['name'] }],
    });
    expect(ctl.discover('sourdough')).toEqual({
      query: 'sourdough',
      matches: [],
    });
  });

  it('rejects blank discovery queries', async () => {
    const ctl = await controller();
    expect(() => ctl.discover('   ')).toThrow(BadRequestException);
    expect(() => ctl.discover()).toThrow(BadRequestException);
  });
});
