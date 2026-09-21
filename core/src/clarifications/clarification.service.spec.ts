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
import { ClarificationService } from './clarification.service';
import { SqliteClarificationRepository } from './sqlite-clarification.repository';

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

describe('ClarificationService', () => {
  let dir = '';
  let database: SessionDatabaseService | null = null;

  const setup = () => {
    const sessions = new SqliteSessionRepository(
      database as SessionDatabaseService,
    );
    const clarifications = new SqliteClarificationRepository(
      database as SessionDatabaseService,
    );
    return {
      sessions,
      service: new ClarificationService(clarifications, sessions),
    };
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-clarification-svc-'));
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

  it('creates questions for existing sessions', async () => {
    const { sessions, service } = setup();
    await sessions.createSession('s1');

    const created = await service.create({
      sessionId: 's1',
      question: 'Which database?',
      options: ['a', 'b'],
      ttlMs: 60_000,
    });

    expect(created.status).toBe('pending');
    expect(created.options).toEqual(['a', 'b']);
    expect(created.expiresAt).toBeDefined();
  });

  it('refuses to create questions for unknown sessions', async () => {
    const { service } = setup();
    await expect(
      service.create({ sessionId: 'missing', question: 'q?' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('binds answers and cancels to the owning session', async () => {
    const { sessions, service } = setup();
    await sessions.createSession('s1');
    await sessions.createSession('s2');
    const created = await service.create({ sessionId: 's1', question: 'q?' });

    await expect(service.answer(created.id, 's2', 'x')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.cancel(created.id, 's2')).rejects.toThrow(
      BadRequestException,
    );
    expect((await service.get(created.id)).status).toBe('pending');
    await expect(service.answer(created.id, 's1', 'x')).resolves.toMatchObject({
      status: 'answered',
      answer: 'x',
    });
  });

  it('maps repository failures to HTTP errors', async () => {
    const { sessions, service } = setup();
    await sessions.createSession('s1');
    const choice = await service.create({
      sessionId: 's1',
      question: 'env?',
      options: ['dev', 'prod'],
    });

    await expect(service.answer('missing', 's1', 'x')).rejects.toThrow(
      NotFoundException,
    );
    // Off-option answer.
    await expect(service.answer(choice.id, 's1', 'staging')).rejects.toThrow(
      BadRequestException,
    );
    await service.answer(choice.id, 's1', 'dev');
    // Double answer conflicts.
    await expect(service.answer(choice.id, 's1', 'prod')).rejects.toThrow(
      ConflictException,
    );
  });

  it('embeds the event trail in detail views', async () => {
    const { sessions, service } = setup();
    await sessions.createSession('s1');
    const created = await service.create({ sessionId: 's1', question: 'q?' });
    await service.cancel(created.id, 's1');

    const detail = await service.get(created.id);
    expect(detail.events.map((e) => e.event)).toEqual(['created', 'cancelled']);
  });
});
