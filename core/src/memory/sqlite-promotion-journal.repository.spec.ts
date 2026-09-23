import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { DatabaseService } from '../session/database.service';
import { MemoryDatabaseService } from './memory-database.service';
import { SqlitePromotionJournalRepository } from './sqlite-promotion-journal.repository';

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
    memoryPromotionAuto: false,
    memoryPromotionAutoKinds: [],
    vectorDbPath: join(dir, 'claims-vector-test.db'),
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

describe('SqlitePromotionJournalRepository', () => {
  let dir = '';
  const services: DatabaseService[] = [];

  const openRepo = (): SqlitePromotionJournalRepository => {
    const service = new MemoryDatabaseService(
      testConfig(join(dir, 'j.sqlite'), dir),
    );
    service.onModuleInit();
    services.push(service);
    return new SqlitePromotionJournalRepository(service);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-journal-'));
  });

  afterEach(() => {
    for (const service of services.splice(0)) {
      service.onModuleDestroy();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('records one row per candidate, returning the existing row on re-proposal', async () => {
    const repository = openRepo();

    const first = await repository.recordProposal({
      candidateId: 'c1',
      operation: 'NEW',
      approvalId: 'appr-1',
    });
    expect(first.state).toBe('proposed');
    expect(first.approvalId).toBe('appr-1');

    const second = await repository.recordProposal({
      candidateId: 'c1',
      operation: 'REINFORCE',
    });
    expect(second.id).toBe(first.id);
    expect(second.operation).toBe('NEW');
  });

  it('enforces terminal finality with recovery replay allowed', async () => {
    const repository = openRepo();
    const entry = await repository.recordProposal({
      candidateId: 'c1',
      operation: 'NEW',
    });

    expect(
      await repository.setState(entry.id, 'committed', { claimId: 'claim-1' }),
    ).toMatchObject({ state: 'committed', claimId: 'claim-1' });
    // Terminal: no transitions out, not even back to proposed.
    expect(await repository.setState(entry.id, 'proposed')).toBeNull();

    const interrupted = await repository.recordProposal({
      candidateId: 'c2',
      operation: 'NEW',
    });
    await repository.setState(interrupted.id, 'promoting');
    expect(
      await repository.setState(interrupted.id, 'proposed', {
        detail: 'recovery replay',
      }),
    ).toMatchObject({ state: 'proposed' });
    expect(await repository.setState('missing', 'failed')).toBeNull();
  });

  it('lists by state and traces claims to journal rows', async () => {
    const repository = openRepo();
    await repository.recordProposal({ candidateId: 'c1', operation: 'NEW' });
    const c2 = await repository.recordProposal({
      candidateId: 'c2',
      operation: 'NEW',
    });
    await repository.setState(c2.id, 'committed', { claimId: 'claim-9' });

    expect(
      (await repository.listByState(['proposed'])).map(
        (row) => row.candidateId,
      ),
    ).toEqual(['c1']);
    expect(await repository.listByState([])).toEqual([]);
    expect(
      (await repository.listByClaimId('claim-9')).map((row) => row.candidateId),
    ).toEqual(['c2']);
    expect(await repository.listByClaimId('missing')).toEqual([]);
    expect(await repository.getByCandidate('c1')).toBeDefined();
    expect(await repository.getByCandidate('missing')).toBeNull();
  });
});
