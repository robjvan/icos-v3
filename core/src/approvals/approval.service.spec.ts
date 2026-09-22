import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { CoreConfig } from '../config';
import { SessionDatabaseService } from '../session/session-database.service';
import { SqliteSessionRepository } from '../session/sqlite-session.repository';
import { ApprovalService } from './approval.service';
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

describe('ApprovalService', () => {
  let dir = '';
  let database: SessionDatabaseService | null = null;

  const setup = () => {
    // Real repositories on one database: the FK binding sessions and
    // approvals is part of what is under test.
    const sessions = new SqliteSessionRepository(
      database as SessionDatabaseService,
    );
    const approvals = new SqliteApprovalRepository(
      database as SessionDatabaseService,
    );
    return { sessions, service: new ApprovalService(approvals, sessions) };
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-approval-svc-'));
    database = new SessionDatabaseService(
      testConfig(join(dir, 'sessions.sqlite'), dir),
    );
    database.onModuleInit();
  });

  afterEach(() => {
    database?.onModuleDestroy();
    database = null;
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates approvals for existing sessions', async () => {
    const { sessions, service } = setup();
    await sessions.createSession('s1');

    const created = await service.create({
      sessionId: 's1',
      action: 'Run migration',
      ttlMs: 60_000,
    });

    expect(created.status).toBe('pending');
    expect(created.expiresAt).toBeDefined();
  });

  it('refuses to create approvals for unknown sessions', async () => {
    const { service } = setup();
    await expect(
      service.create({ sessionId: 'missing', action: 'act' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('binds every mutation to the owning session', async () => {
    const { sessions, service } = setup();
    await sessions.createSession('s1');
    await sessions.createSession('s2');
    const created = await service.create({ sessionId: 's1', action: 'act' });

    await expect(service.approve(created.id, 's2')).rejects.toThrow(
      BadRequestException,
    );
    // Still pending after the wrong-session attempt.
    expect((await service.get(created.id)).status).toBe('pending');
    await expect(service.approve(created.id, 's1')).resolves.toMatchObject({
      status: 'approved',
    });
  });

  it('maps repository failures to HTTP errors', async () => {
    const { sessions, service } = setup();
    await sessions.createSession('s1');
    const created = await service.create({ sessionId: 's1', action: 'act' });

    await expect(service.approve('missing', 's1')).rejects.toThrow(
      NotFoundException,
    );
    await service.approve(created.id, 's1');
    await expect(service.reject(created.id, 's1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('embeds the event trail in detail views', async () => {
    const { sessions, service } = setup();
    await sessions.createSession('s1');
    const created = await service.create({ sessionId: 's1', action: 'act' });
    await service.cancel(created.id, 's1');

    const detail = await service.get(created.id);
    expect(detail.events.map((e) => e.event)).toEqual(['created', 'cancelled']);
  });
});
