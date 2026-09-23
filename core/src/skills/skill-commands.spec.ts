import { BadRequestException, NotFoundException } from '@nestjs/common';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { CommandDispatcher } from '../commands/command-dispatcher';
import { DisplayPreferenceStore } from '../commands/display-preferences';
import type { HostHealthProvider } from '../commands/host-health';
import type { MemoryCandidateRepository } from '../memory/memory-candidate.repository';
import { FakeSessionRepository } from '../conversation/fake-session.repository';
import { SessionStore } from '../conversation/session.store';
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
    memoryPromotionAuto: false,
    memoryPromotionAutoKinds: [],
    vectorDbPath: '/tmp/icos-test-claims-vector.db',
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

async function setup(
  dir: string,
  overrides: Partial<CoreConfig> = {},
): Promise<{
  dispatcher: CommandDispatcher;
  config: CoreConfig;
  skills: SkillService;
  store: SessionStore;
}> {
  const config = testConfig(dir, overrides);
  const store = new SessionStore(new FakeSessionRepository(), config);
  const candidates = {
    ping: jest.fn(() => Promise.resolve()),
  } as unknown as MemoryCandidateRepository;
  const prefs = new DisplayPreferenceStore();
  const host = {
    collect: jest.fn(() => Promise.resolve({})),
  } as unknown as HostHealthProvider;
  const skills = new SkillService(config);
  await skills.onModuleInit();
  const dispatcher = new CommandDispatcher(
    store,
    candidates,
    prefs,
    host,
    skills,
    config,
  );
  return { dispatcher, config, skills, store };
}

describe('/skills commands', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-skills-cmd-'));
    writeSkill(dir, 'daily-journal', 'daily-journal', 'Journal.', 'Ask away.');
    writeSkill(dir, 'capture-idea', 'capture-idea', 'Capture.');
    writeSkill(dir, 'bad-dir', 'other', 'Mismatch.');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is registered in the command catalog', async () => {
    const { dispatcher } = await setup(dir);
    expect(dispatcher.commandNames).toContain('skills');
  });

  it('/skills lists the catalog plus skip reasons', async () => {
    const { dispatcher } = await setup(dir);
    const result = await dispatcher.dispatch('/skills');
    expect(result.kind).toBe('data');
    expect(result.text).toContain('Skills (2):');
    expect(result.text).toContain('capture-idea');
    expect(result.text).toContain('daily-journal');
    expect(result.text).toContain('Skipped (1):');
    expect(result.text).toContain('bad-dir (name-mismatch)');
  });

  it('/skills reports an empty catalog honestly', async () => {
    const { dispatcher } = await setup(join(dir, 'does-not-exist'));
    const result = await dispatcher.dispatch('/skills');
    expect(result.kind).toBe('data');
    expect(result.text).toContain('Skills: none');
  });

  it('/skills show renders one skill body', async () => {
    const { dispatcher } = await setup(dir);
    const result = await dispatcher.dispatch('/skills show DAILY-JOURNAL');
    expect(result.kind).toBe('data');
    expect(result.text).toContain('# daily-journal');
    expect(result.text).toContain('Ask away.');
    expect(result.data).toMatchObject({ name: 'daily-journal' });
  });

  it('/skills show rejects missing names deterministically', async () => {
    const { dispatcher } = await setup(dir);
    await expect(dispatcher.dispatch('/skills show')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      dispatcher.dispatch('/skills show nope'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('/skills rejects unknown subcommands', async () => {
    const { dispatcher } = await setup(dir);
    await expect(
      dispatcher.dispatch('/skills frobnicate'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('/skills refresh re-scans and reports counts', async () => {
    const { dispatcher } = await setup(dir);
    const result = await dispatcher.dispatch('/skills refresh');
    expect(result.kind).toBe('data');
    expect(result.text).toContain('scanned 3, loaded 2, skipped 1');
  });

  it('session-scoped subcommands require an active session', async () => {
    const { dispatcher } = await setup(dir);
    for (const message of [
      '/skills use daily-journal',
      '/skills drop daily-journal',
      '/skills active',
      '/skills pull daily-journal',
    ]) {
      await expect(dispatcher.dispatch(message)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
  });

  it('/skills suggest ranks candidates without activating anything', async () => {
    const { dispatcher } = await setup(dir);
    const before = await dispatcher.dispatch('/skills');
    const result = await dispatcher.dispatch('/skills suggest journal');
    expect(result.kind).toBe('data');
    expect(result.text).toContain('daily-journal');
    expect(result.text).not.toContain('capture-idea');
    expect(result.data).toMatchObject({
      query: 'journal',
      matches: [{ name: 'daily-journal' }],
    });
    // Nothing activated, nothing injected: catalog state identical.
    const after = await dispatcher.dispatch('/skills');
    expect(after.text).toBe(before.text);
  });

  it('/skills suggest handles empty results and blank input', async () => {
    const { dispatcher } = await setup(dir);
    const empty = await dispatcher.dispatch('/skills suggest sourdough');
    expect(empty.kind).toBe('data');
    expect(empty.text).toContain('No skills match');
    await expect(dispatcher.dispatch('/skills suggest')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('/skills reports disabled mode without touching the catalog', async () => {
    const { dispatcher } = await setup(dir, { skillsEnabled: false });
    const result = await dispatcher.dispatch('/skills');
    expect(result.kind).toBe('message');
    expect(result.text).toContain('Skills are disabled');
    const show = await dispatcher.dispatch('/skills show daily-journal');
    expect(show.kind).toBe('message');
    expect(show.text).toContain('Skills are disabled');
  });

  it('/skills use/drop/active round-trips a pinned skill', async () => {
    const { dispatcher, store } = await setup(dir);
    const { id } = await store.resolve(undefined);
    await expect(dispatcher.dispatch('/skills use')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      dispatcher.dispatch('/skills use nope', id),
    ).rejects.toBeInstanceOf(NotFoundException);
    const used = await dispatcher.dispatch('/skills use daily-journal', id);
    expect(used.text).toContain('"daily-journal" pinned');
    const active = await dispatcher.dispatch('/skills active', id);
    expect(active.kind).toBe('data');
    expect(active.text).toContain('explicit (pinned): daily-journal');
    const dropped = await dispatcher.dispatch('/skills drop daily-journal', id);
    expect(dropped.text).toContain('unpinned');
    const quiet = await dispatcher.dispatch('/skills active', id);
    expect(quiet.text).toContain('explicit (pinned): none');
  });

  it('/skills activation requires a session and honors the cap', async () => {
    const { dispatcher, store } = await setup(dir, {
      skillsMaxActivePerSession: 1,
    });
    await expect(
      dispatcher.dispatch('/skills use daily-journal'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(dispatcher.dispatch('/skills active')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const { id } = await store.resolve(undefined);
    await dispatcher.dispatch('/skills use daily-journal', id);
    await expect(
      dispatcher.dispatch('/skills use capture-idea', id),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('/skills pull stages one turn without pinning', async () => {
    const { dispatcher, store, skills } = await setup(dir);
    const { id } = await store.resolve(undefined);
    await expect(dispatcher.dispatch('/skills pull')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      dispatcher.dispatch('/skills pull nope', id),
    ).rejects.toBeInstanceOf(NotFoundException);
    const pulled = await dispatcher.dispatch('/skills pull daily-journal', id);
    expect(pulled.text).toContain('staged for the next turn only');
    expect(skills.getExplicitNames(id)).toEqual([]);
    expect(skills.getPendingNames(id)).toEqual(['daily-journal']);
  });

  it('/skills pull fails fast over budget', async () => {
    const { dispatcher, store, skills } = await setup(dir, {
      skillsMaxContextChars: 5,
      agentMaxIterations: 5,
      agentMaxToolSteps: 5,
      agentMaxTurnDurationMs: 900000,
    });
    const { id } = await store.resolve(undefined);
    await expect(
      dispatcher.dispatch('/skills pull daily-journal', id),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(skills.getPendingNames(id)).toEqual([]);
  });

  it('/fork copies pins but not staged one-shots', async () => {
    const { dispatcher, store, skills } = await setup(dir);
    const { id } = await store.resolve(undefined);
    await store.append(id, { role: 'user', content: 'hi' });
    await dispatcher.dispatch('/skills use daily-journal', id);
    await dispatcher.dispatch('/skills pull capture-idea', id);
    const forked = await dispatcher.dispatch('/fork', id);
    const forkId = forked.sessionId;
    expect(forkId).toBeDefined();
    if (!forkId) throw new Error('fork returned no session');
    expect(skills.getExplicitNames(forkId)).toEqual(['daily-journal']);
    expect(skills.getPendingNames(forkId)).toEqual([]);
    expect(skills.getLastTurn(forkId)).toBeNull();
  });

  it('/undo leaves the pin set alone', async () => {
    const { dispatcher, store, skills } = await setup(dir);
    const { id } = await store.resolve(undefined);
    await store.append(id, { role: 'user', content: 'hi' });
    await store.append(id, { role: 'assistant', content: 'yo' });
    await dispatcher.dispatch('/skills use daily-journal', id);
    await dispatcher.dispatch('/undo', id);
    expect(skills.getExplicitNames(id)).toEqual(['daily-journal']);
  });

  it('/status reports the skills catalog and session pins', async () => {
    const { dispatcher, store } = await setup(dir);
    const bare = await dispatcher.dispatch('/status');
    expect(bare.text).toContain('Skills: enabled, catalog 2');
    const { id } = await store.resolve(undefined);
    await dispatcher.dispatch('/skills use daily-journal', id);
    const withSession = await dispatcher.dispatch('/status', id);
    expect(withSession.text).toContain('Skills pinned: daily-journal');
  });
});
