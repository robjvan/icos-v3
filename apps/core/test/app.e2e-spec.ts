import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { CoreModule } from './../src/core.module';
import { CORE_CONFIG } from './../src/config';
import { LlmClient } from './../src/llm/llm.client';

describe('Conversation (e2e)', () => {
  let app: INestApplication<App>;
  const chat = jest.fn(() =>
    Promise.resolve({ content: 'mock reply', model: 'test-model' }),
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

  beforeEach(async () => {
    chat.mockClear();
    chat.mockResolvedValue({ content: 'mock reply', model: 'test-model' });

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
      })
      .overrideProvider(LlmClient)
      .useValue({ chat })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET / serves the browser test client', async () => {
    const res = await request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Content-Type', /html/);

    expect(res.text).toContain('<title>ICOS</title>');
    expect(res.text).toContain('/core/conversation');
  });

  it('POST /core/conversation returns a reply and session id', async () => {
    const res = await request(app.getHttpServer())
      .post('/core/conversation')
      .send({ message: 'hello' })
      .expect(200);

    const body = res.body as ConversationResponse;
    expect(body.sessionId).toBeDefined();
    expect(body.reply).toBe('mock reply');
    expect(body.model).toBe('test-model');
  });

  it('retains history across calls in the same session', async () => {
    const first = await request(app.getHttpServer())
      .post('/core/conversation')
      .send({ message: 'first' })
      .expect(200);

    const firstBody = first.body as ConversationResponse;

    await request(app.getHttpServer())
      .post('/core/conversation')
      .send({ message: 'second', sessionId: firstBody.sessionId })
      .expect(200);

    const history = await request(app.getHttpServer())
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
    await request(app.getHttpServer())
      .post('/core/conversation')
      .send({ message: '' })
      .expect(400);
  });

  it('returns 404 for unknown sessions', async () => {
    await request(app.getHttpServer())
      .get('/core/conversation/00000000-0000-0000-0000-000000000000')
      .expect(404);
  });
});
