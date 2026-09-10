import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { CoreModule } from './../src/core.module';
import { CORE_CONFIG } from './../src/config';
import { LlmClient } from './../src/llm/llm.client';

describe('Conversation (e2e)', () => {
  let app: INestApplication<App> | null = null;
  let dir = '';
  const chat = jest.fn(() =>
    Promise.resolve({ content: 'mock reply', model: 'test-model' }),
  );
  let streamFails = false;
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

  async function createApp(dbPath: string): Promise<INestApplication<App>> {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [CoreModule],
    })
      .overrideProvider(CORE_CONFIG)
      .useValue({
        port: 3000,
        llmBaseUrl: 'http://localhost:11434/v1',
        llmModel: 'test-model',
        llmTimeoutMs: 1000,
        systemPrompt: 'test-system',
        maxHistory: 50,
        dbPath,
      })
      .overrideProvider(LlmClient)
      .useValue({ chat, chatStream })
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
    dir = mkdtempSync(join(tmpdir(), 'icos-e2e-'));
    app = await createApp(join(dir, 'core.sqlite'));
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
    const dbPath = join(dir, 'restart.sqlite');
    await app?.close();
    app = await createApp(dbPath);

    const first = await request(http())
      .post('/core/conversation')
      .send({ message: 'remember teal' })
      .expect(200);
    const { sessionId } = first.body as ConversationResponse;

    // Simulate a Core restart against the same database file.
    await app?.close();
    app = await createApp(dbPath);

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
});
