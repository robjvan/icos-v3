import type { CoreConfig } from '../config';
import { FakeSessionRepository } from '../conversation/fake-session.repository';
import { SessionStore } from '../conversation/session.store';
import type { MemoryCandidateRepository } from '../memory/memory-candidate.repository';
import { HostHealthProvider } from '../commands/host-health';
import type { HostHealth } from '../commands/host-health';
import { buildHealthReport } from './health-report';

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
    memoryPromotionAuto: false,
    memoryPromotionAutoKinds: [],
    vectorDbPath: '/tmp/icos-test-claims-vector.db',
    skillsDirPath: '/tmp/icos-test-skills-missing',
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
  const store = new SessionStore(new FakeSessionRepository(), config);
  const candidates = {
    ping: jest.fn(() => Promise.resolve()),
  } as unknown as MemoryCandidateRepository;
  const host = {
    collect: jest.fn(() => Promise.resolve({ ...STUB_HOST })),
  } as unknown as HostHealthProvider;
  return { store, candidates, host, config };
}

describe('buildHealthReport', () => {
  it('reports healthy runtime and host when all probes pass', async () => {
    const { store, candidates, host, config } = setup();
    const report = await buildHealthReport({
      sessions: store,
      candidates,
      config,
      host,
    });

    expect(report.status).toBe('healthy');
    expect(report.runtime.core.status).toBe('healthy');
    expect(report.runtime.sessions).toMatchObject({
      status: 'healthy',
      detail: 'sessions database ok',
    });
    expect(report.runtime.memory).toMatchObject({
      status: 'healthy',
      detail: 'memory database ok',
    });
    // Configured, not probed: never claim healthy from config alone.
    expect(report.runtime.llm.status).toBe('unknown');
    expect(report.host.os).toBe('TestOS 1.0');
    expect(report.host.cpuPercent).toBe(8);
  });

  it('degrades when a store ping fails', async () => {
    const { store, host, config } = setup();
    const failing = {
      ping: jest.fn(() => Promise.reject(new Error('sessions down'))),
    } as unknown as MemoryCandidateRepository;

    const report = await buildHealthReport({
      sessions: store,
      candidates: failing,
      config,
      host,
    });

    expect(report.status).toBe('degraded');
    expect(report.runtime.memory).toMatchObject({
      status: 'degraded',
      detail: 'sessions down',
    });
  });

  it('degrades when no LLM provider is configured', async () => {
    const { store, candidates, host } = setup(
      testConfig({ llmBaseUrl: '', llmModel: '' }),
    );
    const report = await buildHealthReport({
      sessions: store,
      candidates,
      config: testConfig({ llmBaseUrl: '', llmModel: '' }),
      host,
    });

    expect(report.status).toBe('degraded');
    expect(report.runtime.llm.status).toBe('degraded');
  });

  it('passes through unavailable host probes as null, never failing', async () => {
    const { store, candidates, config } = setup();
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

    const report = await buildHealthReport({
      sessions: store,
      candidates,
      config,
      host: bare,
    });

    expect(report.status).toBe('healthy');
    expect(report.host.cpuPercent).toBeNull();
    expect(report.host.gpu).toBeNull();
  });
});
