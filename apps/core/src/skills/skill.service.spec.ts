import { BadRequestException, NotFoundException } from '@nestjs/common';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { SKILL_FILE } from './skill-loader';
import { SkillService } from './skill.service';

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
    ...overrides,
  };
}

function writeSkill(
  dir: string,
  entry: string,
  name: string,
  description: string,
  body = 'Body.',
): void {
  mkdirSync(join(dir, entry), { recursive: true });
  writeFileSync(
    join(dir, entry, SKILL_FILE),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`,
  );
}

describe('SkillService', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-skills-svc-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('refreshes descriptors deterministically and reports skips', async () => {
    writeSkill(dir, 'daily-journal', 'daily-journal', 'Journal.');
    writeSkill(dir, 'capture-idea', 'capture-idea', 'Capture.');
    writeSkill(dir, 'bad-dir', 'other', 'Mismatch.');
    const service = new SkillService(testConfig(dir));
    const report = await service.refresh();
    expect(report).toEqual({
      dir,
      scanned: 3,
      loaded: 2,
      skipped: [{ name: 'bad-dir', reason: 'name-mismatch' }],
    });
    expect(service.listDescriptors().map((d) => d.name)).toEqual([
      'capture-idea',
      'daily-journal',
    ]);
    expect(service.getReport()).toEqual(report);
  });

  it('refresh is idempotent and treats a missing dir as empty', async () => {
    const service = new SkillService(testConfig(join(dir, 'does-not-exist')));
    expect(await service.refresh()).toEqual({
      dir: join(dir, 'does-not-exist'),
      scanned: 0,
      loaded: 0,
      skipped: [],
    });
    expect(service.listDescriptors()).toEqual([]);
  });

  it('loads bodies explicitly and caches them per scan generation', async () => {
    writeSkill(dir, 'daily-journal', 'daily-journal', 'Journal.', 'Ask away.');
    const service = new SkillService(testConfig(dir));
    await service.refresh();
    const first = await service.loadBody('DAILY-JOURNAL');
    expect(first).toMatchObject({
      name: 'daily-journal',
      body: 'Ask away.',
      bodyChars: 'Ask away.'.length,
    });
    // Cached: removing the file does not affect the cached body.
    rmSync(join(dir, 'daily-journal'), { recursive: true, force: true });
    await expect(service.loadBody('daily-journal')).resolves.toEqual(first);
    // Refresh drops the cache and re-validates: gone now.
    const report = await service.refresh();
    expect(report.loaded).toBe(0);
    await expect(service.loadBody('daily-journal')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects unknown skills with 404', async () => {
    const service = new SkillService(testConfig(dir));
    await service.refresh();
    await expect(service.loadBody('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('evicts skills whose file rots after the scan', async () => {
    writeSkill(dir, 'rotten', 'rotten', 'Rotten.');
    const service = new SkillService(testConfig(dir));
    await service.refresh();
    writeFileSync(join(dir, 'rotten', SKILL_FILE), 'garbage, no frontmatter');
    await expect(service.loadBody('rotten')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(service.listDescriptors()).toEqual([]);
  });

  it('disabled mode behaves as an empty catalog', async () => {
    writeSkill(dir, 'daily-journal', 'daily-journal', 'Journal.');
    const service = new SkillService(testConfig(dir, { skillsEnabled: false }));
    const report = await service.refresh();
    expect(report).toEqual({ dir, scanned: 0, loaded: 0, skipped: [] });
    expect(service.enabled).toBe(false);
    expect(service.listDescriptors()).toEqual([]);
    await expect(service.loadBody('daily-journal')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
