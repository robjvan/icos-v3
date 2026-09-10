import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { DatabaseService } from '../session/database.service';
import { MemoryDatabaseService } from './memory-database.service';
import type { NewMemoryCandidate } from './memory-candidate';
import { SqliteMemoryCandidateRepository } from './sqlite-memory-candidate.repository';

function testConfig(memoryDbPath: string, dir: string): CoreConfig {
  return {
    port: 3000,
    llmBaseUrl: 'http://localhost:11434/v1',
    llmModel: 'm',
    llmTimeoutMs: 1000,
    systemPrompt: 'sys',
    maxHistory: 50,
    sessionDbPath: join(dir, 'sessions-unused.sqlite'),
    memoryDbPath,
    legacyDbPath: join(dir, 'legacy-missing.sqlite'),
    memoryExtractionEnabled: true,
    memoryLlmBaseUrl: 'http://localhost:11434/v1',
    memoryLlmModel: 'mem',
    memoryLlmTimeoutMs: 1000,
  };
}

const candidate = (
  sessionId: string,
  messageId: number,
  object = 'TypeScript',
): NewMemoryCandidate => ({
  kind: 'preference',
  subject: 'user',
  predicate: 'prefers',
  object,
  confidence: 0.9,
  importance: 0.7,
  stability: 0.8,
  source: { sessionId, messageId },
  extractorModel: 'mem',
  extractorVersion: 'memory-extraction-v1',
});

describe('SqliteMemoryCandidateRepository', () => {
  let dir = '';
  const services: DatabaseService[] = [];

  const openRepo = (
    name = 'memories.sqlite',
  ): SqliteMemoryCandidateRepository => {
    const service = new MemoryDatabaseService(testConfig(join(dir, name), dir));
    service.onModuleInit();
    services.push(service);
    return new SqliteMemoryCandidateRepository(service);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-cand-'));
  });

  afterEach(() => {
    for (const service of services.splice(0)) {
      service.onModuleDestroy();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('saves candidates with ids, provenance, and extractor metadata', async () => {
    const repository = openRepo();

    const [saved] = await repository.saveCandidates([candidate('s1', 7)]);

    expect(saved?.id).toBeDefined();
    expect(saved).toMatchObject({
      kind: 'preference',
      subject: 'user',
      predicate: 'prefers',
      object: 'TypeScript',
      source: { sessionId: 's1', messageId: 7 },
      extractorModel: 'mem',
      extractorVersion: 'memory-extraction-v1',
    });
    expect(saved?.extractedAt).toBeDefined();
  });

  it('lists newest-first, optionally filtered by session', async () => {
    const repository = openRepo();
    await repository.saveCandidates([candidate('s1', 1, 'A')]);
    await repository.saveCandidates([candidate('s2', 2, 'B')]);

    const all = await repository.listCandidates();
    expect(all.map((c) => c.object)).toEqual(['B', 'A']);
    const filtered = await repository.listCandidates('s1');
    expect(filtered.map((c) => c.object)).toEqual(['A']);
    expect(
      await repository.listCandidates(undefined, { limit: 1 }),
    ).toHaveLength(1);
  });

  it('persists across close and reopen', async () => {
    const path = join(dir, 'persist.sqlite');
    const firstService = new MemoryDatabaseService(testConfig(path, dir));
    firstService.onModuleInit();
    const repo = new SqliteMemoryCandidateRepository(firstService);
    await repo.saveCandidates([candidate('s1', 3)]);
    firstService.onModuleDestroy();

    const secondService = new MemoryDatabaseService(testConfig(path, dir));
    secondService.onModuleInit();
    services.push(secondService);
    const reopened = new SqliteMemoryCandidateRepository(secondService);
    const listed = await reopened.listCandidates('s1');
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      object: 'TypeScript',
      source: { sessionId: 's1', messageId: 3 },
    });
  });
});
