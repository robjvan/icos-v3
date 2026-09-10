import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { DatabaseService } from '../session/database.service';
import type { NewMemoryCandidate } from './memory-candidate';
import { SqliteMemoryCandidateRepository } from './sqlite-memory-candidate.repository';

function testConfig(dbPath: string): CoreConfig {
  return {
    port: 3000,
    llmBaseUrl: 'http://localhost:11434/v1',
    llmModel: 'm',
    llmTimeoutMs: 1000,
    systemPrompt: 'sys',
    maxHistory: 50,
    dbPath,
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

  const seedSession = (service: DatabaseService, id: string): number => {
    const db = service.connection;
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO sessions (id, created_at, updated_at) VALUES (?, ?, ?)',
    ).run(id, now, now);
    return Number(
      db
        .prepare(
          'INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)',
        )
        .run(id, 'user', 'I prefer TypeScript', now).lastInsertRowid,
    );
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
    const service = new DatabaseService(testConfig(join(dir, 'c.sqlite')));
    service.onModuleInit();
    services.push(service);
    const repository = new SqliteMemoryCandidateRepository(service);
    const messageId = seedSession(service, 's1');

    const [saved] = await repository.saveCandidates([
      candidate('s1', messageId),
    ]);

    expect(saved?.id).toBeDefined();
    expect(saved).toMatchObject({
      kind: 'preference',
      subject: 'user',
      predicate: 'prefers',
      object: 'TypeScript',
      source: { sessionId: 's1', messageId },
      extractorModel: 'mem',
      extractorVersion: 'memory-extraction-v1',
    });
    expect(saved?.extractedAt).toBeDefined();
  });

  it('lists newest-first, optionally filtered by session', async () => {
    const service = new DatabaseService(testConfig(join(dir, 'c.sqlite')));
    service.onModuleInit();
    services.push(service);
    const repository = new SqliteMemoryCandidateRepository(service);
    const m1 = seedSession(service, 's1');
    const m2 = seedSession(service, 's2');
    await repository.saveCandidates([candidate('s1', m1, 'A')]);
    await repository.saveCandidates([candidate('s2', m2, 'B')]);

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
    const first = new DatabaseService(testConfig(path));
    first.onModuleInit();
    const messageId = seedSession(first, 's1');
    const repo = new SqliteMemoryCandidateRepository(first);
    await repo.saveCandidates([candidate('s1', messageId)]);
    first.onModuleDestroy();

    const second = new DatabaseService(testConfig(path));
    second.onModuleInit();
    services.push(second);
    const reopened = new SqliteMemoryCandidateRepository(second);
    const listed = await reopened.listCandidates('s1');
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      object: 'TypeScript',
      source: { sessionId: 's1', messageId },
    });
  });
});
