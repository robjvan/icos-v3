import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { DatabaseService } from '../session/database.service';
import { SessionDatabaseService } from '../session/session-database.service';
import { SqliteSessionRepository } from '../session/sqlite-session.repository';
import {
  ClarificationNotFoundError,
  InvalidClarificationAnswerError,
  InvalidClarificationTransitionError,
} from './clarification.repository';
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
  };
}

describe('SqliteClarificationRepository', () => {
  let dir = '';
  const services: DatabaseService[] = [];

  const setup = async (): Promise<SqliteClarificationRepository> => {
    const service = new SessionDatabaseService(
      testConfig(join(dir, `s-${services.length}.sqlite`), dir),
    );
    service.onModuleInit();
    services.push(service);
    const sessions = new SqliteSessionRepository(service);
    await sessions.createSession('s1');
    await sessions.createSession('s2');
    return new SqliteClarificationRepository(service);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-clarifications-'));
  });

  afterEach(() => {
    for (const service of services.splice(0)) {
      service.onModuleDestroy();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates pending questions with unique ids', async () => {
    const repository = await setup();
    const free = await repository.createClarification({
      sessionId: 's1',
      question: 'Which database?',
    });
    const choice = await repository.createClarification({
      sessionId: 's1',
      question: 'Which environment?',
      options: ['dev', 'prod'],
    });

    expect(free).toMatchObject({
      sessionId: 's1',
      question: 'Which database?',
      status: 'pending',
    });
    expect(free.options).toBeUndefined();
    expect(choice.options).toEqual(['dev', 'prod']);
    expect(choice.id).not.toBe(free.id);
    expect(await repository.getClarification('missing')).toBeNull();
  });

  it('answers free-form questions and stores the answer', async () => {
    const repository = await setup();
    const created = await repository.createClarification({
      sessionId: 's1',
      question: 'Which database?',
    });

    const answered = await repository.answerClarification(
      created.id,
      '  teal  ',
    );

    expect(answered).toMatchObject({ status: 'answered', answer: 'teal' });
    expect(answered.resolvedAt).toBeDefined();
  });

  it('accepts only offered options on choice questions', async () => {
    const repository = await setup();
    const created = await repository.createClarification({
      sessionId: 's1',
      question: 'Which environment?',
      options: ['dev', 'prod'],
    });

    await expect(
      repository.answerClarification(created.id, 'staging'),
    ).rejects.toThrow(InvalidClarificationAnswerError);
    await expect(
      repository.answerClarification(created.id, '   '),
    ).rejects.toThrow(InvalidClarificationAnswerError);
    // Still pending after invalid attempts.
    expect((await repository.getClarification(created.id))?.status).toBe(
      'pending',
    );
    await expect(
      repository.answerClarification(created.id, 'prod'),
    ).resolves.toMatchObject({ status: 'answered', answer: 'prod' });
  });

  it('rejects answers to resolved or unknown requests', async () => {
    const repository = await setup();
    const created = await repository.createClarification({
      sessionId: 's1',
      question: 'q?',
    });
    await repository.cancelClarification(created.id);

    await expect(
      repository.answerClarification(created.id, 'late'),
    ).rejects.toThrow(InvalidClarificationTransitionError);
    await expect(
      repository.answerClarification('missing', 'x'),
    ).rejects.toThrow(ClarificationNotFoundError);
    await expect(repository.cancelClarification(created.id)).rejects.toThrow(
      InvalidClarificationTransitionError,
    );
  });

  it('lists with session and status filters', async () => {
    const repository = await setup();
    const one = await repository.createClarification({
      sessionId: 's1',
      question: 'one?',
    });
    await repository.createClarification({ sessionId: 's2', question: 'two?' });
    await repository.answerClarification(one.id, 'answer');

    expect(
      (await repository.listClarifications({ sessionId: 's1' })).map(
        (r) => r.id,
      ),
    ).toEqual([one.id]);
    expect(
      await repository.listClarifications({ status: 'answered' }),
    ).toHaveLength(1);
    expect(
      await repository.listClarifications({ status: 'pending' }),
    ).toHaveLength(1);
  });

  it('expires lapsed questions lazily', async () => {
    const repository = await setup();
    const past = new Date(Date.now() - 1000).toISOString();
    const lapsed = await repository.createClarification({
      sessionId: 's1',
      question: 'slow?',
      expiresAt: past,
    });

    expect((await repository.getClarification(lapsed.id))?.status).toBe(
      'expired',
    );
    expect(
      await repository.listClarifications({ status: 'pending' }),
    ).toHaveLength(0);
    await expect(
      repository.answerClarification(lapsed.id, 'late'),
    ).rejects.toThrow(InvalidClarificationTransitionError);
  });

  it('records created and terminal events in order', async () => {
    const repository = await setup();
    const created = await repository.createClarification({
      sessionId: 's1',
      question: 'q?',
    });
    await repository.answerClarification(created.id, 'a');

    const events = await repository.listEvents(created.id);
    expect(events.map((e) => e.event)).toEqual(['created', 'answered']);
    expect(events[0]).toMatchObject({
      clarificationId: created.id,
      sessionId: 's1',
    });
  });

  it('pings liveness', async () => {
    await expect((await setup()).ping()).resolves.toBeUndefined();
  });
});
