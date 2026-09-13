import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { CoreModule } from './../src/core.module';
import { CORE_CONFIG } from './../src/config';
import { LlmClient } from './../src/llm/llm.client';
import { MemoryCandidateExtractor } from './../src/memory/memory-candidate-extractor';

describe('Conversation (e2e)', () => {
  let app: INestApplication<App> | null = null;
  let dir = '';
  const chat = jest.fn<Promise<{ content: string; model: string }>, [unknown]>(
    () => Promise.resolve({ content: 'mock reply', model: 'test-model' }),
  );
  let streamFails = false;
  let extractFails = false;
  const extract = jest.fn(
    (): Promise<
      {
        kind: string;
        subject: string;
        predicate: string;
        object: string;
        confidence: number;
        importance: number;
        stability: number;
      }[]
    > => {
      if (extractFails) {
        return Promise.reject(new Error('extractor down'));
      }
      return Promise.resolve([
        {
          kind: 'preference',
          subject: 'user',
          predicate: 'prefers',
          object: 'e2e-subject',
          confidence: 0.9,
          importance: 0.7,
          stability: 0.8,
        },
      ]);
    },
  );
  const chatStream = jest.fn(
    (
      messages: unknown,
      sink: { onToken: (content: string) => void },
    ): Promise<{ content: string; model: string }> => {
      void messages;
      if (streamFails) {
        return Promise.reject(new Error('upstream boom'));
      }
      sink.onToken('mock ');
      sink.onToken('reply');
      return Promise.resolve({ content: 'mock reply', model: 'test-model' });
    },
  );

  interface ConversationResponse {
    sessionId: string;
    reply: string;
    model: string;
  }

  interface HistoryResponse {
    sessionId: string;
    messages: { role: string; content: string }[];
  }

  async function createApp(
    sessionDbPath: string,
    memoryDbPath: string,
    legacyDbPath?: string,
  ): Promise<INestApplication<App>> {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [CoreModule],
    })
      .overrideProvider(CORE_CONFIG)
      .useValue({
        port: 3000,
        provider: 'ollama',
        llmBaseUrl: 'http://localhost:11434/v1',
        llmModel: 'test-model',
        llmTimeoutMs: 1000,
        systemPrompt: 'test-system',
        maxHistory: 50,
        sessionDbPath,
        memoryDbPath,
        legacyDbPath: legacyDbPath ?? join(dir, 'legacy-missing.sqlite'),
        memoryExtractionEnabled: true,
        memoryProvider: 'ollama',
        memoryLlmBaseUrl: 'http://localhost:11434/v1',
        memoryLlmModel: 'test-model',
        memoryLlmTimeoutMs: 1000,
        skillsDirPath: join(dir, 'skills'),
        skillsEnabled: true,
        skillsMaxBodyChars: 12000,
        skillsMaxCatalogItems: 50,
        skillsMaxActivePerSession: 5,
        skillsMaxAutoLoadedPerTurn: 2,
        skillsMaxContextChars: 8000,
      })
      .overrideProvider(LlmClient)
      .useValue({ chat, chatStream })
      .overrideProvider(MemoryCandidateExtractor)
      .useValue({ extract })
      .compile();

    const instance = moduleFixture.createNestApplication();
    instance.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await instance.init();
    return instance;
  }

  beforeEach(async () => {
    chat.mockClear();
    chat.mockResolvedValue({ content: 'mock reply', model: 'test-model' });
    chatStream.mockClear();
    streamFails = false;
    extract.mockClear();
    extractFails = false;
    dir = mkdtempSync(join(tmpdir(), 'icos-e2e-'));
    app = await createApp(
      join(dir, 'sessions.sqlite'),
      join(dir, 'memories.sqlite'),
    );
  });

  afterEach(async () => {
    await app?.close();
    app = null;
    rmSync(dir, { recursive: true, force: true });
  });

  function http(): ReturnType<INestApplication<App>['getHttpServer']> {
    if (!app) throw new Error('app not initialized');
    return app.getHttpServer();
  }

  it('POST /core/conversation returns a reply and session id', async () => {
    const res = await request(http())
      .post('/core/conversation')
      .send({ message: 'hello' })
      .expect(200);

    const body = res.body as ConversationResponse;
    expect(body.sessionId).toBeDefined();
    expect(body.reply).toBe('mock reply');
    expect(body.model).toBe('test-model');
    // The ICOS session identity reaches the LLM request contract.
    expect(chat.mock.calls[0][0]).toMatchObject({
      sessionId: body.sessionId,
    });
  });

  it('retains history across calls in the same session', async () => {
    const first = await request(http())
      .post('/core/conversation')
      .send({ message: 'first' })
      .expect(200);

    const firstBody = first.body as ConversationResponse;

    await request(http())
      .post('/core/conversation')
      .send({ message: 'second', sessionId: firstBody.sessionId })
      .expect(200);

    const history = await request(http())
      .get(`/core/conversation/${firstBody.sessionId}`)
      .expect(200);

    const historyBody = history.body as HistoryResponse;
    expect(historyBody.messages.map((m) => m.content)).toEqual([
      'first',
      'mock reply',
      'second',
      'mock reply',
    ]);
  });

  it('rejects empty messages with 400', async () => {
    await request(http())
      .post('/core/conversation')
      .send({ message: '' })
      .expect(400);
  });

  it('returns 404 for unknown sessions', async () => {
    await request(http())
      .get('/core/conversation/00000000-0000-0000-0000-000000000000')
      .expect(404);
  });

  it('GET / serves the browser test client', async () => {
    const res = await request(http())
      .get('/')
      .expect(200)
      .expect('Content-Type', /html/);

    expect(res.text).toContain('<title>ICOS</title>');
    expect(res.text).toContain('/core/conversation');
  });

  it('POST /core/conversation/stream emits meta, tokens, done as SSE', async () => {
    const res = await request(http())
      .post('/core/conversation/stream')
      .send({ message: 'hello' })
      .expect(200)
      .expect('Content-Type', /event-stream/);

    expect(res.text).toContain('event: meta');
    expect(res.text).toContain('event: token');
    expect(res.text).toContain('event: done');
    expect(res.text).toContain('"content":"mock "');
    expect(res.text).toContain('"reply":"mock reply"');
    expect(chatStream).toHaveBeenCalledTimes(1);
  });

  it('POST /core/conversation/stream emits an error event on failure', async () => {
    streamFails = true;

    const res = await request(http())
      .post('/core/conversation/stream')
      .send({ message: 'hello' })
      .expect(200)
      .expect('Content-Type', /event-stream/);

    expect(res.text).toContain('event: meta');
    expect(res.text).toContain('event: error');
    expect(res.text).toContain('upstream boom');
    expect(res.text).not.toContain('event: done');
  });

  it('persists sessions across restarts', async () => {
    const sessionDbPath = join(dir, 'restart-sessions.sqlite');
    const memoryDbPath = join(dir, 'restart-memories.sqlite');
    await app?.close();
    app = await createApp(sessionDbPath, memoryDbPath);

    const first = await request(http())
      .post('/core/conversation')
      .send({ message: 'remember teal' })
      .expect(200);
    const { sessionId } = first.body as ConversationResponse;

    // Simulate a Core restart against the same database files.
    await app?.close();
    app = await createApp(sessionDbPath, memoryDbPath);

    const history = await request(http())
      .get(`/core/conversation/${sessionId}`)
      .expect(200);
    const historyBody = history.body as HistoryResponse;
    expect(historyBody.messages.map((m) => m.content)).toEqual([
      'remember teal',
      'mock reply',
    ]);

    // The reopened session continues to accumulate.
    await request(http())
      .post('/core/conversation')
      .send({ message: 'again', sessionId })
      .expect(200);
    const updated = await request(http())
      .get(`/core/conversation/${sessionId}`)
      .expect(200);
    expect(
      (updated.body as HistoryResponse).messages.map((m) => m.content),
    ).toEqual(['remember teal', 'mock reply', 'again', 'mock reply']);
  });

  it('GET /core/sessions lists sessions newest-first', async () => {
    const first = await request(http())
      .post('/core/conversation')
      .send({ message: 'first topic here' })
      .expect(200);
    const second = await request(http())
      .post('/core/conversation')
      .send({ message: 'second topic here' })
      .expect(200);

    const res = await request(http()).get('/core/sessions').expect(200);
    const body = res.body as {
      sessions: {
        sessionId: string;
        messageCount: number;
        preview?: string;
      }[];
    };
    expect(body.sessions.map((s) => s.sessionId)).toEqual([
      (second.body as ConversationResponse).sessionId,
      (first.body as ConversationResponse).sessionId,
    ]);
    expect(body.sessions[0]).toMatchObject({
      messageCount: 2,
      preview: 'second topic here',
    });
  });

  it('GET /core/sessions/search finds historical content', async () => {
    const first = await request(http())
      .post('/core/conversation')
      .send({ message: 'I like teal' })
      .expect(200);
    await request(http())
      .post('/core/conversation')
      .send({ message: 'unrelated chatter' })
      .expect(200);
    const sessionId = (first.body as ConversationResponse).sessionId;

    const res = await request(http())
      .get('/core/sessions/search')
      .query({ q: 'teal' })
      .expect(200);
    const body = res.body as {
      results: { sessionId: string; content: string }[];
    };
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({
      sessionId,
      content: 'I like teal',
    });

    const filtered = await request(http())
      .get('/core/sessions/search')
      .query({ q: 'mock reply', sessionId })
      .expect(200);
    expect(
      (filtered.body as typeof body).results.every(
        (r) => r.sessionId === sessionId,
      ),
    ).toBe(true);
  });

  it('GET /core/sessions/search rejects bad queries', async () => {
    // Punctuation-heavy input falls back to a literal phrase search.
    await request(http())
      .get('/core/sessions/search')
      .query({ q: '"' })
      .expect(200);
    await request(http()).get('/core/sessions/search').expect(400);
    await request(http())
      .get('/core/sessions/search')
      .query({ q: '' })
      .expect(400);
  });

  it('GET /core/memory-candidates exposes extracted candidates', async () => {
    const first = await request(http())
      .post('/core/conversation')
      .send({ message: 'I prefer oak' })
      .expect(200);
    const sessionId = (first.body as ConversationResponse).sessionId;

    // Extraction runs after the turn; poll briefly for the background save.
    let candidates: {
      id: string;
      object: string;
      source: { sessionId: string; messageId: number };
    }[] = [];
    for (let i = 0; i < 50 && candidates.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const res = await request(http())
        .get('/core/memory-candidates')
        .query({ sessionId })
        .expect(200);
      candidates = (
        res.body as {
          candidates: {
            id: string;
            object: string;
            source: { sessionId: string; messageId: number };
          }[];
        }
      ).candidates;
    }

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      object: 'e2e-subject',
      source: { sessionId, messageId: 1 },
    });
  });

  it('conversation still succeeds when extraction fails', async () => {
    extractFails = true;

    await request(http())
      .post('/core/conversation')
      .send({ message: 'hello' })
      .expect(200);

    const res = await request(http())
      .get('/core/memory-candidates')
      .expect(200);
    expect((res.body as { candidates: unknown[] }).candidates).toHaveLength(0);
  });

  it('slash commands answer without LLM, transcript, or extraction', async () => {
    const res = await request(http())
      .post('/core/conversation')
      .send({ message: '/health' })
      .expect(200);

    const body = res.body as ConversationResponse & {
      command?: { kind: string };
    };
    expect(body.model).toBe('core');
    expect(body.reply).toContain('Core: healthy');
    expect(body.reply).toContain('Host System');
    expect(body.reply).toContain('Status: healthy');
    expect(body.command).toMatchObject({ kind: 'data' });
    expect(chat).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();

    // Nothing persisted as conversation.
    const listed = await request(http()).get('/core/sessions').expect(200);
    expect((listed.body as { sessions: unknown[] }).sessions).toHaveLength(0);
  });

  it('rejects unknown slash commands with 404', async () => {
    await request(http())
      .post('/core/conversation')
      .send({ message: '/nope' })
      .expect(404);
    expect(chat).not.toHaveBeenCalled();
  });

  it('rejects malformed slash commands with 400', async () => {
    await request(http())
      .post('/core/conversation')
      .send({ message: '/' })
      .expect(400);
    expect(chat).not.toHaveBeenCalled();
  });

  it('streams slash commands as meta then done with no tokens', async () => {
    const res = await request(http())
      .post('/core/conversation/stream')
      .send({ message: '/health' })
      .expect(200)
      .expect('Content-Type', /event-stream/);

    expect(res.text).not.toContain('event: token');
    expect(res.text).toContain('event: done');
    expect(res.text).toContain('"model":"core"');
    expect(chatStream).not.toHaveBeenCalled();
  });

  it('GET /core/skills reports the empty enabled catalog', async () => {
    const res = await request(http()).get('/core/skills').expect(200);
    expect(res.body).toEqual({ enabled: true, skills: [], skipped: [] });
  });

  it('/skills answers without LLM, transcript, or extraction', async () => {
    const res = await request(http())
      .post('/core/conversation')
      .send({ message: '/skills' })
      .expect(200);

    const body = res.body as ConversationResponse & {
      command?: { kind: string };
    };
    expect(body.model).toBe('core');
    expect(body.reply).toContain('Skills: none');
    expect(body.command).toMatchObject({ kind: 'data' });
    expect(chat).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();

    const listed = await request(http()).get('/core/sessions').expect(200);
    expect((listed.body as { sessions: unknown[] }).sessions).toHaveLength(0);
  });

  it('skills refresh/show round-trips a filesystem fixture', async () => {
    const skillsDir = join(dir, 'skills');
    mkdirSync(join(skillsDir, 'demo'), { recursive: true });
    writeFileSync(
      join(skillsDir, 'demo', 'SKILL.md'),
      '---\nname: demo\ndescription: Demo skill.\n---\n\nDo demo things.\n',
    );

    const refreshed = await request(http())
      .post('/core/conversation')
      .send({ message: '/skills refresh' })
      .expect(200);
    expect((refreshed.body as ConversationResponse).reply).toContain(
      'scanned 1, loaded 1, skipped 0',
    );

    const shown = await request(http())
      .post('/core/conversation')
      .send({ message: '/skills show demo' })
      .expect(200);
    expect((shown.body as ConversationResponse).reply).toContain(
      'Do demo things.',
    );

    const listed = await request(http()).get('/core/skills').expect(200);
    expect(listed.body).toMatchObject({
      enabled: true,
      skills: [{ name: 'demo', description: 'Demo skill.', version: '0.0.0' }],
    });

    const detail = await request(http()).get('/core/skills/demo').expect(200);
    expect(detail.body).toMatchObject({
      name: 'demo',
      body: 'Do demo things.',
    });

    await request(http()).get('/core/skills/nope').expect(404);
    expect(chat).not.toHaveBeenCalled();
  });

  it('suggest and discover rank without activating or injecting', async () => {
    const skillsDir = join(dir, 'skills');
    mkdirSync(join(skillsDir, 'demo'), { recursive: true });
    writeFileSync(
      join(skillsDir, 'demo', 'SKILL.md'),
      '---\nname: demo\ndescription: Demo skill for journal work.\n---\n\nDo demo things.\n',
    );
    await request(http())
      .post('/core/conversation')
      .send({ message: '/skills refresh' })
      .expect(200);

    const suggested = await request(http())
      .post('/core/conversation')
      .send({ message: '/skills suggest journal' })
      .expect(200);
    expect((suggested.body as ConversationResponse).reply).toContain('demo');
    expect((suggested.body as ConversationResponse).model).toBe('core');

    const discovered = await request(http())
      .get('/core/skills/discover')
      .query({ q: 'journal' })
      .expect(200);
    expect(discovered.body).toMatchObject({
      query: 'journal',
      matches: [{ name: 'demo' }],
    });

    await request(http()).get('/core/skills/discover').expect(400);

    // Suggesting changed nothing: catalog identical, transcript empty.
    const listed = await request(http()).get('/core/skills').expect(200);
    expect(listed.body).toMatchObject({
      skills: [{ name: 'demo' }],
    });
    const sessions = await request(http()).get('/core/sessions').expect(200);
    expect((sessions.body as { sessions: unknown[] }).sessions).toHaveLength(0);
    expect(chat).not.toHaveBeenCalled();
  });

  it('/rename titles the session and surfaces in the session list', async () => {
    const first = await request(http())
      .post('/core/conversation')
      .send({ message: 'hello' })
      .expect(200);
    const sessionId = (first.body as ConversationResponse).sessionId;

    const renamed = await request(http())
      .post('/core/conversation')
      .send({ message: '/rename e2e title', sessionId })
      .expect(200);
    expect((renamed.body as ConversationResponse).reply).toContain('e2e title');

    const listed = await request(http()).get('/core/sessions').expect(200);
    const sessions = (
      listed.body as { sessions: { sessionId: string; title?: string }[] }
    ).sessions;
    expect(sessions.find((s) => s.sessionId === sessionId)?.title).toBe(
      'e2e title',
    );

    // Transcript intact: still one ordinary turn.
    const history = await request(http())
      .get(`/core/conversation/${sessionId}`)
      .expect(200);
    expect(
      (history.body as HistoryResponse).messages.map((m) => m.content),
    ).toEqual(['hello', 'mock reply']);
  });

  it('/undo removes the last turn from LLM context only', async () => {
    const first = await request(http())
      .post('/core/conversation')
      .send({ message: 'first' })
      .expect(200);
    const sessionId = (first.body as ConversationResponse).sessionId;
    await request(http())
      .post('/core/conversation')
      .send({ message: 'second', sessionId })
      .expect(200);

    await request(http())
      .post('/core/conversation')
      .send({ message: '/undo', sessionId })
      .expect(200);

    // History keeps all four rows, flagged.
    const history = await request(http())
      .get(`/core/conversation/${sessionId}`)
      .expect(200);
    const messages = (history.body as HistoryResponse).messages;
    expect(messages).toHaveLength(4);
    expect(
      messages.filter(
        (m) => (m as { excludedFromContext?: boolean }).excludedFromContext,
      ),
    ).toHaveLength(2);

    // The next LLM turn sees only the first turn plus the new message.
    chat.mockClear();
    await request(http())
      .post('/core/conversation')
      .send({ message: 'third', sessionId })
      .expect(200);
    const sent = chat.mock.calls[0][0] as {
      messages: { content: string }[];
    };
    expect(sent.messages.map((m) => m.content)).toEqual([
      'test-system',
      'first',
      'mock reply',
      'third',
    ]);
  });

  it('approvals run a full create-to-resolve lifecycle', async () => {
    const first = await request(http())
      .post('/core/conversation')
      .send({ message: 'hello' })
      .expect(200);
    const sessionId = (first.body as ConversationResponse).sessionId;

    const created = await request(http())
      .post('/core/approvals')
      .send({ sessionId, action: 'Run migration', description: 'Alters data' })
      .expect(201);
    const approval = created.body as { id: string; status: string };
    expect(approval.status).toBe('pending');

    const listed = await request(http())
      .get('/core/approvals')
      .query({ sessionId, status: 'pending' })
      .expect(200);
    expect(
      (listed.body as { approvals: { id: string }[] }).approvals.map(
        (a) => a.id,
      ),
    ).toEqual([approval.id]);

    const approved = await request(http())
      .post(`/core/approvals/${approval.id}/approve`)
      .send({ sessionId })
      .expect(200);
    expect((approved.body as { status: string }).status).toBe('approved');

    const detail = await request(http())
      .get(`/core/approvals/${approval.id}`)
      .expect(200);
    expect(
      (detail.body as { events: { event: string }[] }).events.map(
        (e) => e.event,
      ),
    ).toEqual(['created', 'approved']);
  });

  it('approvals reject bad transitions, wrong sessions, and unknown ids', async () => {
    const first = await request(http())
      .post('/core/conversation')
      .send({ message: 'hello' })
      .expect(200);
    const sessionId = (first.body as ConversationResponse).sessionId;
    const other = await request(http())
      .post('/core/conversation')
      .send({ message: 'hello' })
      .expect(200);
    const otherId = (other.body as ConversationResponse).sessionId;

    const created = await request(http())
      .post('/core/approvals')
      .send({ sessionId, action: 'act' })
      .expect(201);
    const id = (created.body as { id: string }).id;

    // Wrong session binding.
    await request(http())
      .post(`/core/approvals/${id}/approve`)
      .send({ sessionId: otherId })
      .expect(400);

    // Unknown approval.
    await request(http())
      .post('/core/approvals/00000000-0000-0000-0000-000000000000/approve')
      .send({ sessionId })
      .expect(404);

    // Double resolution conflicts.
    await request(http())
      .post(`/core/approvals/${id}/reject`)
      .send({ sessionId })
      .expect(200);
    await request(http())
      .post(`/core/approvals/${id}/approve`)
      .send({ sessionId })
      .expect(409);

    // Unknown session on create.
    await request(http())
      .post('/core/approvals')
      .send({
        sessionId: '00000000-0000-0000-0000-000000000000',
        action: 'act',
      })
      .expect(404);
  });

  it('assistant text can never approve a request', async () => {
    const first = await request(http())
      .post('/core/conversation')
      .send({ message: 'hello' })
      .expect(200);
    const sessionId = (first.body as ConversationResponse).sessionId;

    const created = await request(http())
      .post('/core/approvals')
      .send({ sessionId, action: 'Run migration' })
      .expect(201);
    const id = (created.body as { id: string }).id;

    // The model insists approval happened. It did not.
    chat.mockResolvedValueOnce({
      content: 'Sure, you approved that. Proceeding.',
      model: 'test-model',
    });
    await request(http())
      .post('/core/conversation')
      .send({ message: 'do it', sessionId })
      .expect(200);

    const detail = await request(http())
      .get(`/core/approvals/${id}`)
      .expect(200);
    expect((detail.body as { status: string }).status).toBe('pending');

    // Approvals leave no rows in the conversation transcript.
    const history = await request(http())
      .get(`/core/conversation/${sessionId}`)
      .expect(200);
    expect(
      (history.body as HistoryResponse).messages.every(
        (m) => !m.content.includes('Run migration'),
      ),
    ).toBe(true);
  });

  it('clarifications run a full ask-to-answer lifecycle', async () => {
    const first = await request(http())
      .post('/core/conversation')
      .send({ message: 'hello' })
      .expect(200);
    const sessionId = (first.body as ConversationResponse).sessionId;

    const created = await request(http())
      .post('/core/clarifications')
      .send({
        sessionId,
        question: 'Which environment?',
        options: ['dev', 'staging', 'prod'],
      })
      .expect(201);
    const question = created.body as {
      id: string;
      status: string;
      options: string[];
    };
    expect(question.status).toBe('pending');
    expect(question.options).toEqual(['dev', 'staging', 'prod']);

    const listed = await request(http())
      .get('/core/clarifications')
      .query({ sessionId, status: 'pending' })
      .expect(200);
    expect(
      (listed.body as { clarifications: { id: string }[] }).clarifications.map(
        (c) => c.id,
      ),
    ).toEqual([question.id]);

    const answered = await request(http())
      .post(`/core/clarifications/${question.id}/answer`)
      .send({ sessionId, answer: 'staging' })
      .expect(200);
    expect(answered.body as object).toMatchObject({
      status: 'answered',
      answer: 'staging',
    });

    // The answer stays available to the pending task via the detail view.
    const detail = await request(http())
      .get(`/core/clarifications/${question.id}`)
      .expect(200);
    expect(detail.body as object).toMatchObject({
      status: 'answered',
      answer: 'staging',
    });
    expect(
      (detail.body as { events: { event: string }[] }).events.map(
        (e) => e.event,
      ),
    ).toEqual(['created', 'answered']);
  });

  it('clarifications reject bad answers, wrong sessions, and double answers', async () => {
    const first = await request(http())
      .post('/core/conversation')
      .send({ message: 'hello' })
      .expect(200);
    const sessionId = (first.body as ConversationResponse).sessionId;
    const other = await request(http())
      .post('/core/conversation')
      .send({ message: 'hello' })
      .expect(200);
    const otherId = (other.body as ConversationResponse).sessionId;

    const created = await request(http())
      .post('/core/clarifications')
      .send({
        sessionId,
        question: 'Which environment?',
        options: ['dev', 'prod'],
      })
      .expect(201);
    const id = (created.body as { id: string }).id;

    // Off-option answer.
    await request(http())
      .post(`/core/clarifications/${id}/answer`)
      .send({ sessionId, answer: 'qa' })
      .expect(400);

    // Wrong session binding.
    await request(http())
      .post(`/core/clarifications/${id}/answer`)
      .send({ sessionId: otherId, answer: 'dev' })
      .expect(400);

    // Unknown clarification.
    await request(http())
      .post('/core/clarifications/00000000-0000-0000-0000-000000000000/answer')
      .send({ sessionId, answer: 'dev' })
      .expect(404);

    await request(http())
      .post(`/core/clarifications/${id}/answer`)
      .send({ sessionId, answer: 'dev' })
      .expect(200);
    // Double answer conflicts.
    await request(http())
      .post(`/core/clarifications/${id}/answer`)
      .send({ sessionId, answer: 'prod' })
      .expect(409);

    // Ordinary conversation never resolves the question, and the
    // question never leaks into the transcript.
    const free = await request(http())
      .post('/core/clarifications')
      .send({ sessionId, question: 'Which database?' })
      .expect(201);
    const freeId = (free.body as { id: string }).id;
    await request(http())
      .post('/core/conversation')
      .send({ message: 'the teal one', sessionId })
      .expect(200);
    const detail = await request(http())
      .get(`/core/clarifications/${freeId}`)
      .expect(200);
    expect((detail.body as { status: string }).status).toBe('pending');
    const history = await request(http())
      .get(`/core/conversation/${sessionId}`)
      .expect(200);
    expect(
      (history.body as HistoryResponse).messages.every(
        (m) => !m.content.includes('Which database?'),
      ),
    ).toBe(true);
  });

  it('clarification creation validates options and sessions', async () => {
    const first = await request(http())
      .post('/core/conversation')
      .send({ message: 'hello' })
      .expect(200);
    const sessionId = (first.body as ConversationResponse).sessionId;

    // Unknown session.
    await request(http())
      .post('/core/clarifications')
      .send({
        sessionId: '00000000-0000-0000-0000-000000000000',
        question: 'q?',
      })
      .expect(404);
    // Degenerate option sets.
    await request(http())
      .post('/core/clarifications')
      .send({ sessionId, question: 'q?', options: ['only'] })
      .expect(400);
    await request(http())
      .post('/core/clarifications')
      .send({ sessionId, question: 'q?', options: ['dup', 'dup'] })
      .expect(400);
  });
});
