import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { DatabaseService } from '../session/database.service';
import { MemoryDatabaseService } from './memory-database.service';
import type { NewClaim } from './claim';
import { SqliteClaimRepository } from './sqlite-claim.repository';

function testConfig(memoryDbPath: string, dir: string): CoreConfig {
  return {
    port: 3000,
    provider: 'ollama',
    llmBaseUrl: 'http://localhost:11434/v1',
    llmModel: 'm',
    llmTimeoutMs: 1000,
    systemPrompt: 'sys',
    maxHistory: 50,
    sessionDbPath: join(dir, 'sessions-unused.sqlite'),
    memoryDbPath,
    legacyDbPath: join(dir, 'legacy-missing.sqlite'),
    memoryExtractionEnabled: true,
    memoryProvider: 'ollama',
    memoryLlmBaseUrl: 'http://localhost:11434/v1',
    memoryLlmModel: 'mem',
    memoryLlmTimeoutMs: 1000,
    skillsDirPath: join(dir, 'skills-unused'),
    skillsEnabled: true,
    skillsMaxBodyChars: 12000,
    skillsMaxCatalogItems: 50,
    skillsMaxActivePerSession: 5,
    skillsMaxAutoLoadedPerTurn: 2,
    skillsMaxContextChars: 8000,
    agentMaxIterations: 5,
    agentMaxToolSteps: 5,
    agentMaxTurnDurationMs: 900000,
  };
}

const claim = (object = 'TypeScript'): NewClaim => ({
  subject: 'user',
  predicate: 'prefers',
  object,
  category: 'preference',
  status: 'candidate',
  extractorConfidence: 0.9,
  confidence: 0.5,
  firstAssertedAt: 'cand-1',
  lastSurfacedAt: 'cand-1',
  origin: 'user',
  evidence: [{ candidateId: 'cand-1', role: 'user' }],
  entities: ['user'],
  promotion: 'approved:appr-1',
});

describe('SqliteClaimRepository', () => {
  let dir = '';
  const services: DatabaseService[] = [];

  const openRepo = (name = 'claims.sqlite'): SqliteClaimRepository => {
    const service = new MemoryDatabaseService(testConfig(join(dir, name), dir));
    service.onModuleInit();
    services.push(service);
    return new SqliteClaimRepository(service);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-claim-'));
  });

  afterEach(() => {
    for (const service of services.splice(0)) {
      service.onModuleDestroy();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates claims with provenance and defaults', async () => {
    const repository = openRepo();

    const saved = await repository.createClaim(claim());

    expect(saved.id).toBeDefined();
    expect(saved).toMatchObject({
      subject: 'user',
      predicate: 'prefers',
      object: 'TypeScript',
      category: 'preference',
      status: 'candidate',
      origin: 'user',
      firstAssertedAt: 'cand-1',
      lastSurfacedAt: 'cand-1',
      evidence: [{ candidateId: 'cand-1', role: 'user' }],
    });
    // Reserved fields stay at defaults through M10 paths.
    expect(saved.sourceType).toBeNull();
    expect(saved.summary).toBeNull();
    expect(saved.related).toEqual([]);
    expect(saved.timesObserved).toBe(1);
    expect(saved.accessCount).toBe(0);
    expect(saved.lastAccessedAt).toBeNull();
    expect(saved.activation).toBeNull();
    expect(saved.locked).toBe(false);
    expect(saved.emotional).toBeNull();
  });

  it('refuses duplicate identity instead of forking a claim', async () => {
    const repository = openRepo();
    await repository.createClaim(claim());

    await expect(
      repository.createClaim({
        ...claim(),
        object: '  TYPESCRIPT ',
        promotion: 'approved:appr-2',
      }),
    ).rejects.toThrow('already exists');
  });

  it('finds claims by normalized triple', async () => {
    const repository = openRepo();
    const saved = await repository.createClaim(claim());

    const found = await repository.findByTriple({
      subject: ' User ',
      predicate: 'PREFERS',
      object: 'typescript',
    });
    expect(found?.id).toBe(saved.id);
    expect(
      await repository.findByTriple({
        subject: 'user',
        predicate: 'prefers',
        object: 'Rust',
      }),
    ).toBeNull();
  });

  it('appends evidence without rewriting origin or first assertion', async () => {
    const repository = openRepo();
    const saved = await repository.createClaim(claim());

    const updated = await repository.appendEvidence(
      saved.id,
      [{ candidateId: 'cand-2', role: 'assistant' }],
      0.7,
    );

    expect(updated?.evidence).toEqual([
      { candidateId: 'cand-1', role: 'user' },
      { candidateId: 'cand-2', role: 'assistant' },
    ]);
    expect(updated?.lastSurfacedAt).toBe('cand-2');
    expect(updated?.firstAssertedAt).toBe('cand-1');
    expect(updated?.origin).toBe('user');
    expect(updated?.timesObserved).toBe(2);
    expect(updated?.confidence).toBe(0.7);
  });

  it('ignores already-attached evidence on re-append', async () => {
    const repository = openRepo();
    const saved = await repository.createClaim(claim());

    const updated = await repository.appendEvidence(
      saved.id,
      [{ candidateId: 'cand-1', role: 'user' }],
      0.6,
    );
    expect(updated?.evidence).toHaveLength(1);
  });

  it('enforces the status lifecycle', async () => {
    const repository = openRepo();
    const saved = await repository.createClaim(claim());

    // candidate → contradicted is illegal (must promote first).
    expect(await repository.setStatus(saved.id, 'contradicted')).toBeNull();
    expect((await repository.getClaim(saved.id))?.status).toBe('candidate');

    expect((await repository.setStatus(saved.id, 'active'))?.status).toBe(
      'active',
    );
    // active → candidate is illegal (no resurrection).
    expect(await repository.setStatus(saved.id, 'candidate')).toBeNull();

    expect((await repository.setStatus(saved.id, 'contradicted'))?.status).toBe(
      'contradicted',
    );
    expect(await repository.setStatus('missing', 'active')).toBeNull();
  });

  it('lists newest-first, optionally filtered by status', async () => {
    const repository = openRepo();
    const a = await repository.createClaim(claim('A'));
    await repository.createClaim(claim('B'));
    await repository.setStatus(a.id, 'active');

    expect((await repository.listClaims()).map((c) => c.object)).toEqual([
      'B',
      'A',
    ]);
    expect(
      (await repository.listClaims({ status: 'active' })).map((c) => c.object),
    ).toEqual(['A']);
  });

  it('persists claims and ledger-touch-free status across reopen', async () => {
    const path = join(dir, 'persist.sqlite');
    const firstService = new MemoryDatabaseService(testConfig(path, dir));
    firstService.onModuleInit();
    const repo = new SqliteClaimRepository(firstService);
    const saved = await repo.createClaim(claim());
    await repo.setStatus(saved.id, 'active');
    firstService.onModuleDestroy();

    const secondService = new MemoryDatabaseService(testConfig(path, dir));
    secondService.onModuleInit();
    services.push(secondService);
    const reopened = new SqliteClaimRepository(secondService);
    const listed = await reopened.listClaims({ status: 'active' });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ object: 'TypeScript', origin: 'user' });
  });
});
