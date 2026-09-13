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

  it('discovers ranked candidates without reading bodies', async () => {
    writeSkill(dir, 'daily-journal', 'daily-journal', 'Journal about the day.');
    writeSkill(dir, 'capture-idea', 'capture-idea', 'Capture.');
    writeSkill(dir, 'bad-dir', 'other', 'Mismatch.');
    const service = new SkillService(testConfig(dir));
    await service.refresh();
    const matches = service.discover('daily journal');
    expect(matches.map((m) => m.skill.name)).toEqual(['daily-journal']);
    expect(matches[0]?.matchedOn).toContain('name');
    // Skipped skills are excluded from discovery.
    expect(service.discover('mismatch')).toEqual([]);
    // Discovery is pure: registry and report unchanged.
    expect(service.listDescriptors()).toHaveLength(2);
    expect(service.getReport().skipped).toEqual([
      { name: 'bad-dir', reason: 'name-mismatch' },
    ]);
  });

  it('discovery returns empty when disabled', async () => {
    writeSkill(dir, 'daily-journal', 'daily-journal', 'Journal.');
    const service = new SkillService(testConfig(dir, { skillsEnabled: false }));
    await service.refresh();
    expect(service.discover('journal')).toEqual([]);
  });

  it('pins and unpins skills per session', async () => {
    writeSkill(dir, 'daily-journal', 'daily-journal', 'Journal.');
    const service = new SkillService(testConfig(dir));
    await service.refresh();
    expect(service.useSkill('s1', 'DAILY-JOURNAL')).toBe('daily-journal');
    expect(service.getExplicitNames('s1')).toEqual(['daily-journal']);
    expect(service.getExplicitNames('s2')).toEqual([]);
    // Idempotent re-pin.
    expect(service.useSkill('s1', 'daily-journal')).toBe('daily-journal');
    expect(service.getExplicitNames('s1')).toEqual(['daily-journal']);
    expect(service.dropSkill('s1', 'daily-journal')).toBe('daily-journal');
    expect(service.getExplicitNames('s1')).toEqual([]);
  });

  it('rejects pins for unknown skills and enforces the cap', async () => {
    writeSkill(dir, 'a-skill', 'a-skill', 'A.');
    writeSkill(dir, 'b-skill', 'b-skill', 'B.');
    const service = new SkillService(
      testConfig(dir, { skillsMaxActivePerSession: 1 }),
    );
    await service.refresh();
    expect(() => service.useSkill('s1', 'nope')).toThrow(NotFoundException);
    service.useSkill('s1', 'a-skill');
    expect(() => service.useSkill('s1', 'b-skill')).toThrow(
      BadRequestException,
    );
  });

  it('stages one-shots consumed by exactly one turn', async () => {
    writeSkill(dir, 'persona-anchor', 'persona-anchor', 'Anchor.', 'Be brief.');
    const service = new SkillService(testConfig(dir));
    await service.refresh();
    await service.stageOneShot('s1', 'persona-anchor');
    expect(service.getPendingNames('s1')).toEqual(['persona-anchor']);
    expect(service.getExplicitNames('s1')).toEqual([]);
    const first = await service.resolveTurnSkills('s1', 'hello');
    expect(first.requested.map((s) => s.name)).toEqual(['persona-anchor']);
    expect(service.getPendingNames('s1')).toEqual([]);
    const second = await service.resolveTurnSkills('s1', 'hello');
    expect(second.requested).toEqual([]);
    // Never pinned along the way.
    expect(service.getExplicitNames('s1')).toEqual([]);
  });

  it('fails fast when a staged body cannot fit the turn budget', async () => {
    writeSkill(dir, 'big-skill', 'big-skill', 'Big.', 'x'.repeat(100));
    const service = new SkillService(
      testConfig(dir, { skillsMaxContextChars: 10 }),
    );
    await service.refresh();
    await expect(
      service.stageOneShot('s1', 'big-skill'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.getPendingNames('s1')).toEqual([]);
  });

  it('resolves explicit, requested, then budgeted contextual in order', async () => {
    writeSkill(dir, 'a-skill', 'a-skill', 'Alpha procedure.', 'Body A.');
    writeSkill(dir, 'b-skill', 'b-skill', 'Beta procedure.', 'Body B.');
    writeSkill(dir, 'c-skill', 'c-skill', 'Gamma procedure.', 'Body C.');
    const service = new SkillService(testConfig(dir));
    await service.refresh();
    service.useSkill('s1', 'b-skill');
    await service.stageOneShot('s1', 'a-skill');
    const resolved = await service.resolveTurnSkills(
      's1',
      'need alpha beta gamma',
    );
    expect(resolved.explicit.map((s) => s.name)).toEqual(['b-skill']);
    expect(resolved.requested.map((s) => s.name)).toEqual(['a-skill']);
    // Already-included names are excluded from discovery candidates.
    expect(resolved.considered.map((m) => m.skill.name)).toEqual(['c-skill']);
    expect(resolved.contextual.map((s) => s.name)).toEqual(['c-skill']);
  });

  it('enforces the auto-load count and char budgets', async () => {
    writeSkill(dir, 'a-skill', 'a-skill', 'Shared token gamma.', 'Body A.');
    writeSkill(dir, 'b-skill', 'b-skill', 'Shared token gamma.', 'Body B.');
    const service = new SkillService(
      testConfig(dir, { skillsMaxAutoLoadedPerTurn: 1 }),
    );
    await service.refresh();
    const resolved = await service.resolveTurnSkills(
      's1',
      'shared token gamma',
    );
    expect(resolved.contextual.map((s) => s.name)).toEqual(['a-skill']);
    expect(resolved.considered).toHaveLength(2);

    const tight = new SkillService(
      testConfig(dir, { skillsMaxContextChars: 5 }),
    );
    await tight.refresh();
    const starved = await tight.resolveTurnSkills('s1', 'shared token gamma');
    expect(starved.contextual).toEqual([]);
    expect(starved.considered).toHaveLength(2);
  });

  it('copies pins on fork without pending or history', async () => {
    writeSkill(dir, 'a-skill', 'a-skill', 'A.');
    const service = new SkillService(testConfig(dir));
    await service.refresh();
    service.useSkill('s1', 'a-skill');
    await service.stageOneShot('s1', 'a-skill');
    service.recordLastTurn({
      sessionId: 's1',
      explicit: ['a-skill'],
      contextual: [],
      requested: [],
      considered: [],
      chars: { explicit: 6, requested: 0, contextual: 0 },
    });
    service.copyExplicitPins('s1', 's2');
    expect(service.getExplicitNames('s2')).toEqual(['a-skill']);
    expect(service.getPendingNames('s2')).toEqual([]);
    expect(service.getLastTurn('s2')).toBeNull();
  });

  it('builds a bounded catalog block', async () => {
    const empty = new SkillService(testConfig(dir));
    await empty.refresh();
    expect(empty.buildCatalogBlock()).toBe('');
    writeSkill(dir, 'b-skill', 'b-skill', 'B.');
    writeSkill(dir, 'a-skill', 'a-skill', 'A.');
    const capped = new SkillService(
      testConfig(dir, { skillsMaxCatalogItems: 1 }),
    );
    await capped.refresh();
    const block = capped.buildCatalogBlock();
    expect(block).toContain('<available_skills>');
    expect(block).toContain('- a-skill: A.');
    expect(block).not.toContain('- b-skill: B.');
    expect(block).toContain('(and 1 more — see /skills)');
    const disabled = new SkillService(
      testConfig(dir, { skillsEnabled: false }),
    );
    await disabled.refresh();
    expect(disabled.buildCatalogBlock()).toBe('');
  });
});
