import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { CoreConfig } from '../config';
import { FakeSessionRepository } from '../conversation/fake-session.repository';
import { SessionStore } from '../conversation/session.store';
import type { MemoryCandidateRepository } from '../memory/memory-candidate.repository';
import { CommandDispatcher } from './command-dispatcher';
import { DisplayPreferenceStore } from './display-preferences';
import { HostHealthProvider } from './host-health';
import type { HostHealth } from './host-health';
import { SkillService } from '../skills/skill.service';

function testConfig(overrides: Partial<CoreConfig> = {}): CoreConfig {
  return {
    port: 3000,
    provider: 'ollama',
    llmBaseUrl: 'http://localhost:11434/v1',
    llmModel: 'test-model',
    llmApiKey: 'secret-key-must-never-leak',
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
    skillsDirPath: '/tmp/icos-test-skills-missing',
    skillsEnabled: true,
    skillsMaxBodyChars: 12000,
    skillsMaxCatalogItems: 50,
    skillsMaxActivePerSession: 5,
    skillsMaxAutoLoadedPerTurn: 2,
    skillsMaxContextChars: 8000,
    ...overrides,
  };
}

const STUB_HOST: HostHealth = {
  os: 'TestOS 1.0',
  arch: 'x86_64',
  uptimeSeconds: 3 * 86400 + 7 * 3600 + 12 * 60,
  cpuCores: 16,
  cpuPercent: 8,
  loadAverage: [1.42, 1.31, 1.18],
  memoryUsedBytes: Math.round(12.4 * 1024 ** 3),
  memoryTotalBytes: Math.round(31.2 * 1024 ** 3),
  diskUsedBytes: 184 * 1024 ** 3,
  diskTotalBytes: 931 * 1024 ** 3,
  gpu: {
    name: 'Test GPU 4060',
    memoryUsedBytes: Math.round(4.8 * 1024 ** 3),
    memoryTotalBytes: 8 * 1024 ** 3,
    temperatureC: 57,
  },
};

function setup(config: CoreConfig = testConfig()) {
  const repository = new FakeSessionRepository();
  const store = new SessionStore(repository, config);
  const candidates = {
    ping: jest.fn(() => Promise.resolve()),
  } as unknown as MemoryCandidateRepository;
  const prefs = new DisplayPreferenceStore();
  const host = {
    collect: jest.fn(() => Promise.resolve({ ...STUB_HOST })),
  } as unknown as HostHealthProvider;
  const dispatcher = new CommandDispatcher(
    store,
    candidates,
    prefs,
    host,
    new SkillService(config),
    config,
  );
  return { repository, store, candidates, prefs, host, dispatcher, config };
}

async function seedTurn(
  store: SessionStore,
  sessionId: string,
  user: string,
  assistant: string,
): Promise<void> {
  await store.append(sessionId, { role: 'user', content: user });
  await store.append(sessionId, { role: 'assistant', content: assistant });
}

describe('builtin slash commands', () => {
  it('exposes the M6a catalog', () => {
    const { dispatcher } = setup();
    expect(dispatcher.commandNames).toEqual([
      'export',
      'fork',
      'health',
      'new',
      'rename',
      'restart-runtime',
      'skills',
      'status',
      'thinking',
      'timestamps',
      'undo',
    ]);
  });

  it('/new creates a session without deleting the old one', async () => {
    const { dispatcher, store } = setup();
    const { id: first } = await store.resolve(undefined);
    await seedTurn(store, first, 'hi', 'hello');

    const result = await dispatcher.dispatch('/new', first);

    expect(result.kind).toBe('session');
    expect(result.sessionId).toBeDefined();
    expect(result.sessionId).not.toBe(first);
    expect(await store.getSession(first)).not.toBeNull();
  });

  it('/status reports session and runtime state from Core, not the LLM', async () => {
    const { dispatcher, store } = setup();
    const { id } = await store.resolve(undefined);
    await seedTurn(store, id, 'hi', 'hello');

    const result = await dispatcher.dispatch('/status', id);

    expect(result.kind).toBe('data');
    expect(result.text).toContain(`Session: ${id}`);
    expect(result.text).toContain('Provider: ollama');
    expect(result.text).toContain('Model: test-model');
    expect(result.text).toContain('Messages: 2');
    expect(result.data).toMatchObject({
      sessionId: id,
      provider: 'ollama',
      model: 'test-model',
      messageCount: 2,
    });
  });

  it('/status works without a session', async () => {
    const { dispatcher } = setup();
    const result = await dispatcher.dispatch('/status');
    expect(result.text).toContain('Session: none');
  });

  it('/health reports runtime and host sections without generating', async () => {
    const { dispatcher } = setup();
    const result = await dispatcher.dispatch('/health');
    expect(result.kind).toBe('data');
    expect(result.text).toContain('ICOS Runtime');
    expect(result.text).toContain('Core: healthy');
    expect(result.text).toContain('Sessions DB: healthy');
    expect(result.text).toContain('Memory DB: healthy');
    // Configured, not probed: never claim healthy from config alone.
    expect(result.text).toContain('Reachability: not probed');
    expect(result.text).toContain('Host System');
    expect(result.text).toContain('OS: TestOS 1.0');
    expect(result.text).toContain('Uptime: 3d 7h 12m');
    expect(result.text).toContain('CPU: 8% / 16 cores');
    expect(result.text).toContain('Load: 1.42 / 1.31 / 1.18');
    expect(result.text).toContain('GPU: Test GPU 4060');
    expect(result.text).toContain('GPU Temp: 57°C');
    expect(result.text).toContain('Status: healthy');
    const runtime = result.data?.['runtime'] as { llm: { status: unknown } };
    expect(runtime.llm.status).toBe('unknown');
    const host = result.data?.['host'] as { os: unknown };
    expect(host.os).toBe('TestOS 1.0');
    expect(result.data?.['status']).toBe('healthy');
  });

  it('/health renders unavailable sources as n/a, never failing', async () => {
    const { store, candidates, prefs, config } = setup();
    const bare = {
      collect: jest.fn(() =>
        Promise.resolve({
          ...STUB_HOST,
          cpuPercent: null,
          diskUsedBytes: null,
          diskTotalBytes: null,
          gpu: null,
        }),
      ),
    } as unknown as HostHealthProvider;
    const dispatcher = new CommandDispatcher(
      store,
      candidates,
      prefs,
      bare,
      new SkillService(config),
      config,
    );
    const result = await dispatcher.dispatch('/health');
    expect(result.text).toContain('CPU: n/a / 16 cores');
    expect(result.text).toContain('Disk: n/a');
    expect(result.text).toContain('GPU: n/a');
    expect(result.text).toContain('Status: healthy');
  });

  it('/health reports degraded stores and overall status honestly', async () => {
    const { store, prefs, host, config } = setup();
    const failing = {
      ping: jest.fn(() => Promise.reject(new Error('disk gone'))),
    } as unknown as MemoryCandidateRepository;
    const dispatcher = new CommandDispatcher(
      store,
      failing,
      prefs,
      host,
      new SkillService(config),
      config,
    );
    const result = await dispatcher.dispatch('/health');
    expect(result.text).toContain('Memory DB: degraded');
    expect(result.text).toContain('Status: degraded');
    expect(result.data?.['status']).toBe('degraded');
  });

  it('/export renders Markdown transcript without secrets', async () => {
    const { dispatcher, store } = setup();
    const { id } = await store.resolve(undefined);
    await seedTurn(store, id, 'my question', 'the answer');

    const result = await dispatcher.dispatch('/export', id);

    expect(result.kind).toBe('data');
    expect(result.data?.['format']).toBe('markdown');
    const markdown = result.data?.['markdown'] as string;
    expect(markdown).toContain(`# Session ${id}`);
    expect(markdown).toContain('my question');
    expect(markdown).toContain('the answer');
    expect(result.text).not.toContain('secret-key-must-never-leak');
    expect(markdown).not.toContain('secret-key-must-never-leak');
  });

  it('/rename sets the title and leaves the transcript alone', async () => {
    const { dispatcher, store } = setup();
    const { id } = await store.resolve(undefined);
    await seedTurn(store, id, 'hi', 'hello');

    const result = await dispatcher.dispatch('/rename "my title"', id);

    expect(result.text).toContain('my title');
    expect((await store.getSession(id))?.title).toBe('my title');
    expect(await store.getHistory(id)).toHaveLength(2);
  });

  it('/rename requires a title', async () => {
    const { dispatcher, store } = setup();
    const { id } = await store.resolve(undefined);
    await expect(dispatcher.dispatch('/rename', id)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('/thinking and /timestamps toggle per-session display state', async () => {
    const { dispatcher, store, prefs } = setup();
    const { id } = await store.resolve(undefined);

    expect(prefs.get(id)).toEqual({
      showThinking: true,
      showTimestamps: false,
    });
    await expect(dispatcher.dispatch('/thinking', id)).resolves.toMatchObject({
      text: 'thinking off.',
    });
    await expect(
      dispatcher.dispatch('/timestamps on', id),
    ).resolves.toMatchObject({ text: 'timestamps on.' });
    expect(prefs.get(id)).toEqual({
      showThinking: false,
      showTimestamps: true,
    });
    await expect(dispatcher.dispatch('/thinking maybe', id)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('/undo excludes the last turn from context but keeps history', async () => {
    const { dispatcher, store } = setup();
    const { id } = await store.resolve(undefined);
    await seedTurn(store, id, 'first', 'answer one');
    await seedTurn(store, id, 'second', 'answer two');

    const result = await dispatcher.dispatch('/undo', id);

    expect(result.text).toContain('excluded from context');
    const context = await store.getContextMessages(id);
    expect(context.map((m) => m.content)).toEqual(['first', 'answer one']);
    const history = (await store.getHistory(id)) ?? [];
    expect(history).toHaveLength(4);
    expect(
      history.filter((m) => m.excludedFromContext).map((m) => m.content),
    ).toEqual(['second', 'answer two']);

    // A second undo walks back another turn.
    await dispatcher.dispatch('/undo', id);
    expect(await store.getContextMessages(id)).toEqual([]);
    expect(await store.getHistory(id)).toHaveLength(4);
  });

  it('/undo with no turns reports nothing to undo', async () => {
    const { dispatcher, store } = setup();
    const { id } = await store.resolve(undefined);
    await expect(dispatcher.dispatch('/undo', id)).resolves.toMatchObject({
      text: 'Nothing to undo.',
    });
  });

  it('/fork copies the transcript and leaves the source untouched', async () => {
    const { dispatcher, store } = setup();
    const { id } = await store.resolve(undefined);
    await seedTurn(store, id, 'hi', 'hello');
    await dispatcher.dispatch('/rename forked title', id);

    const result = await dispatcher.dispatch('/fork', id);
    const forkId = result.sessionId as string;

    expect(result.kind).toBe('session');
    expect(forkId).not.toBe(id);
    expect(await store.getHistory(forkId)).toEqual(await store.getHistory(id));
    expect((await store.getSession(forkId))?.title).toBe('forked title');
    // Source intact.
    expect((await store.getHistory(id)) ?? []).toHaveLength(2);
  });

  it('/restart-runtime explains unavailability without side effects', async () => {
    const { dispatcher } = setup();
    const result = await dispatcher.dispatch('/restart-runtime');
    expect(result.text).toMatch(/unavailable/i);
    expect(result.data).toMatchObject({ restartable: false });
  });

  it('session commands on unknown ids fail without creating sessions', async () => {
    const { dispatcher, store } = setup();
    const missing = '11111111-2222-4333-8444-555555555555';
    for (const raw of ['/status', '/export', '/rename x', '/undo', '/fork']) {
      await expect(dispatcher.dispatch(raw, missing)).rejects.toThrow(
        NotFoundException,
      );
    }
    expect(await store.getSession(missing)).toBeNull();
  });

  it('unknown commands fail deterministically', async () => {
    const { dispatcher } = setup();
    await expect(dispatcher.dispatch('/nope')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('malformed commands fail deterministically', async () => {
    const { dispatcher } = setup();
    await expect(dispatcher.dispatch('/')).rejects.toThrow(BadRequestException);
    await expect(dispatcher.dispatch('/usr/bin')).rejects.toThrow(
      BadRequestException,
    );
  });
});
