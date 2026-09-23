import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { DatabaseService } from '../session/database.service';
import { SessionDatabaseService } from '../session/session-database.service';
import { SqliteSessionRepository } from '../session/sqlite-session.repository';
import {
  ApprovalNotFoundError,
  InvalidApprovalTransitionError,
} from './approval.repository';
import { SqliteApprovalRepository } from './sqlite-approval.repository';

function testConfig(sessionDbPath: string, dir: string): CoreConfig {
  return {
    port: 3000,
    provider: 'ollama',
    llmBaseUrl: 'http://localhost:11434/v1',
    llmModel: 'm',
    llmTimeoutMs: 1000,
    systemPrompt: 'sys',
    maxHistory: 50,
    sessionDbPath,
    memoryDbPath: join(dir, 'mem-unused.sqlite'),
    legacyDbPath: join(dir, 'legacy-missing.sqlite'),
    memoryExtractionEnabled: false,
    memoryProvider: 'ollama',
    memoryLlmBaseUrl: 'http://localhost:11434/v1',
    memoryLlmModel: 'm',
    memoryLlmTimeoutMs: 1000,
    memoryPromotionAuto: false,
    memoryPromotionAutoKinds: [],
    vectorDbPath: '/tmp/icos-test-claims-vector.db',
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

describe('SqliteApprovalRepository', () => {
  let dir = '';
  const services: DatabaseService[] = [];

  const setup = async (): Promise<SqliteApprovalRepository> => {
    const service = new SessionDatabaseService(
      testConfig(join(dir, `s-${services.length}.sqlite`), dir),
    );
    service.onModuleInit();
    services.push(service);
    // Approvals are session-bound (FK): the owning rows must exist.
    const sessions = new SqliteSessionRepository(service);
    await sessions.createSession('s1');
    await sessions.createSession('s2');
    return new SqliteApprovalRepository(service);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-approvals-'));
  });

  afterEach(() => {
    for (const service of services.splice(0)) {
      service.onModuleDestroy();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates pending approvals with unique ids', async () => {
    const repository = await setup();
    const first = await repository.createApproval({
      sessionId: 's1',
      action: 'Run migration',
      description: 'Alters persistent data',
    });
    const second = await repository.createApproval({
      sessionId: 's1',
      action: 'Run migration',
    });

    expect(first.id).toBeDefined();
    expect(second.id).not.toBe(first.id);
    expect(first).toMatchObject({
      sessionId: 's1',
      action: 'Run migration',
      description: 'Alters persistent data',
      status: 'pending',
    });
    expect(second.description).toBe('');
    expect(await repository.getApproval('missing')).toBeNull();
  });

  it('lists with session and status filters', async () => {
    const repository = await setup();
    const pending = await repository.createApproval({
      sessionId: 's1',
      action: 'one',
    });
    await repository.createApproval({ sessionId: 's2', action: 'two' });
    await repository.resolveApproval(pending.id, 'approved');

    expect(
      (await repository.listApprovals({ sessionId: 's1' })).map((r) => r.id),
    ).toEqual([pending.id]);
    expect(await repository.listApprovals({ status: 'approved' })).toHaveLength(
      1,
    );
    expect(await repository.listApprovals({ status: 'pending' })).toHaveLength(
      1,
    );
    expect(await repository.listApprovals()).toHaveLength(2);
  });

  it.each(['approved', 'rejected', 'cancelled'] as const)(
    'resolves pending to %s exactly once',
    async (to) => {
      const repository = await setup();
      const created = await repository.createApproval({
        sessionId: 's1',
        action: 'act',
      });

      const resolved = await repository.resolveApproval(created.id, to);

      expect(resolved.status).toBe(to);
      expect(resolved.resolvedAt).toBeDefined();
      await expect(
        repository.resolveApproval(created.id, 'approved'),
      ).rejects.toThrow(InvalidApprovalTransitionError);
    },
  );

  it('rejects resolving unknown approvals', async () => {
    const repository = await setup();
    await expect(
      repository.resolveApproval('missing', 'approved'),
    ).rejects.toThrow(ApprovalNotFoundError);
  });

  it('expires lapsed approvals lazily, on read and on list', async () => {
    const repository = await setup();
    const past = new Date(Date.now() - 1000).toISOString();
    const lapsed = await repository.createApproval({
      sessionId: 's1',
      action: 'slow',
      expiresAt: past,
    });

    const read = await repository.getApproval(lapsed.id);
    expect(read?.status).toBe('expired');
    expect(read?.resolvedAt).toBeDefined();
    expect(await repository.listApprovals({ status: 'pending' })).toHaveLength(
      0,
    );
    await expect(
      repository.resolveApproval(lapsed.id, 'approved'),
    ).rejects.toThrow(InvalidApprovalTransitionError);
  });

  it('keeps unexpired approvals pending', async () => {
    const repository = await setup();
    const future = new Date(Date.now() + 60_000).toISOString();
    const created = await repository.createApproval({
      sessionId: 's1',
      action: 'soon',
      expiresAt: future,
    });
    expect((await repository.getApproval(created.id))?.status).toBe('pending');
  });

  it('records created and terminal events in order', async () => {
    const repository = await setup();
    const created = await repository.createApproval({
      sessionId: 's1',
      action: 'act',
    });
    await repository.resolveApproval(created.id, 'rejected');

    const events = await repository.listEvents(created.id);
    expect(events.map((e) => e.event)).toEqual(['created', 'rejected']);
    expect(events[0]).toMatchObject({
      approvalId: created.id,
      sessionId: 's1',
    });
  });

  it('pings liveness', async () => {
    await expect((await setup()).ping()).resolves.toBeUndefined();
  });
});
