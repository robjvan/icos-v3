import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { CoreModule } from '../src/core.module';
import { CORE_CONFIG } from '../src/config';
import {
  MAX_ITERATIONS,
  MAX_TOOL_STEPS,
  MAX_TURN_DURATION_MS,
  TOOL_STEP_INSTRUCTION,
} from '../src/conversation/conversation.service';
import { buildPlanningBlock } from '../src/agent/planning-context';
import { ToolRegistry } from '../src/tools/tool-registry';
import { LlmClient } from '../src/llm/llm.client';
import { MemoryCandidateExtractor } from '../src/memory/memory-candidate-extractor';

describe('Conversation (e2e)', () => {
  let app: INestApplication<App> | null = null;
  let dir = '';
  interface MockToolCall {
    id: string;
    name: string;
    version: number;
    rawArguments: string;
    args: Record<string, unknown>;
  }

  interface MockLlmResult {
    kind: string;
    content: string | null;
    model: string;
    toolCalls?: MockToolCall[];
  }

  const chatWithTools = jest.fn<Promise<MockLlmResult>, [unknown]>(() =>
    Promise.resolve({
      kind: 'text',
      content: 'mock reply',
      model: 'test-model',
    }),
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
  const chatStreamWithTools = jest.fn<
    Promise<MockLlmResult>,
    [unknown, { onToken: (content: string) => void }]
  >((request, sink) => {
    void request;
    if (streamFails) {
      return Promise.reject(new Error('upstream boom'));
    }
    sink.onToken('mock ');
    sink.onToken('reply');
    return Promise.resolve({
      kind: 'text',
      content: 'mock reply',
      model: 'test-model',
    });
  });

  const anyString = expect.any(String) as unknown as string;

  interface ConversationResponse {
    status?: string;
    sessionId: string;
    requestId?: string;
    reply: string;
    model: string;
    tool?: { invocationId: string; name: string };
    result?: unknown;
    approval?: {
      approvalId: string;
      invocationId: string;
      tool: string;
      args: Record<string, unknown>;
    };
    outcome?: string;
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
        agentMaxIterations: MAX_ITERATIONS,
        agentMaxToolSteps: MAX_TOOL_STEPS,
        agentMaxTurnDurationMs: MAX_TURN_DURATION_MS,
      })
      .overrideProvider(LlmClient)
      .useValue({ chatWithTools, chatStreamWithTools })
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
    chatWithTools.mockClear();
    chatWithTools.mockResolvedValue({
      kind: 'text',
      content: 'mock reply',
      model: 'test-model',
    });
    chatStreamWithTools.mockClear();
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
    expect(chatWithTools.mock.calls[0][0]).toMatchObject({
      sessionId: body.sessionId,
    });
  });

  it('persists one agent run per turn with steps and terminal state', async () => {
    const res = await request(http())
      .post('/core/conversation')
      .send({ message: 'hello' })
      .expect(200);
    const sessionId = (res.body as ConversationResponse).sessionId;

    const db = new Database(join(dir, 'sessions.sqlite'), {
      readonly: true,
    });
    try {
      const rows = db
        .prepare(`SELECT * FROM agent_runs WHERE session_id = ?`)
        .all(sessionId) as {
        goal: string;
        state: string;
        request_ids: string;
        current_request_id: string;
        iteration_count: number;
        tool_call_count: number;
        limits_json: string;
        termination_json: string;
      }[];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ goal: 'hello', state: 'completed' });
      expect(JSON.parse(rows[0].request_ids)).toHaveLength(1);
      expect(rows[0].current_request_id).toBe(
        (res.body as ConversationResponse).requestId,
      );
      expect(rows[0].iteration_count).toBe(1);
      expect(rows[0].tool_call_count).toBe(0);
      expect(JSON.parse(rows[0].limits_json)).toEqual({
        maxIterations: MAX_ITERATIONS,
        maxToolSteps: MAX_TOOL_STEPS,
        maxTurnDurationMs: MAX_TURN_DURATION_MS,
      });
      expect(JSON.parse(rows[0].termination_json)).toMatchObject({
        reason: 'final_answer',
      });
    } finally {
      db.close();
    }
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
    expect(chatStreamWithTools).toHaveBeenCalledTimes(1);
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
    expect(chatWithTools).not.toHaveBeenCalled();
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
    expect(chatWithTools).not.toHaveBeenCalled();
  });

  it('rejects malformed slash commands with 400', async () => {
    await request(http())
      .post('/core/conversation')
      .send({ message: '/' })
      .expect(400);
    expect(chatWithTools).not.toHaveBeenCalled();
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
    expect(chatStreamWithTools).not.toHaveBeenCalled();
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
    expect(chatWithTools).not.toHaveBeenCalled();
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
    expect(chatWithTools).not.toHaveBeenCalled();
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
    expect(chatWithTools).not.toHaveBeenCalled();
  });

  it('M7c turn scopes: explicit pins, one-shot pulls, contextual discovery', async () => {
    type WireMessage = { role: string; content: string };
    const sent = (call: number): WireMessage[] =>
      (
        chatWithTools.mock.calls[call][0] as {
          messages: WireMessage[];
          sessionId: string;
        }
      ).messages;

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

    const first = await request(http())
      .post('/core/conversation')
      .send({ message: 'hello there friend' })
      .expect(200);
    const sessionId = (first.body as ConversationResponse).sessionId;
    // Clean turn: catalog block present, no skill bodies.
    expect(sent(0)[0]?.content).toContain('<available_skills>');
    expect(sent(0).some((m) => m.content.includes('<skill '))).toBe(false);

    // Explicit pin: every subsequent turn carries scope="explicit".
    await request(http())
      .post('/core/conversation')
      .send({ message: '/skills use demo', sessionId })
      .expect(200);
    await request(http())
      .post('/core/conversation')
      .send({ message: 'journal time', sessionId })
      .expect(200);
    expect(
      sent(1).find((m) => m.content.includes('scope="explicit"')),
    ).toMatchObject({ role: 'system' });
    // Already-included: discovery does not duplicate it as contextual.
    expect(sent(1).some((m) => m.content.includes('contextual'))).toBe(false);

    const active = await request(http())
      .get('/core/skills/active')
      .query({ sessionId })
      .expect(200);
    expect(active.body).toMatchObject({
      sessionId,
      explicit: ['demo'],
      requested: [],
    });

    // One-shot pull: next turn only, then gone, never pinned.
    await request(http())
      .post('/core/conversation')
      .send({ message: '/skills drop demo', sessionId })
      .expect(200);
    await request(http())
      .post('/core/conversation')
      .send({ message: '/skills pull demo', sessionId })
      .expect(200);
    await request(http())
      .post('/core/conversation')
      .send({ message: 'sourdough starter ratios', sessionId })
      .expect(200);
    expect(
      sent(2).find((m) => m.content.includes('scope="turn-explicit"')),
    ).toBeDefined();
    await request(http())
      .post('/core/conversation')
      .send({ message: 'another plain message', sessionId })
      .expect(200);
    expect(sent(3).some((m) => m.content.includes('<skill '))).toBe(false);

    // Auto-discovery: relevant turn loads it contextually, unpinned.
    await request(http())
      .post('/core/conversation')
      .send({ message: 'journal work begins', sessionId })
      .expect(200);
    expect(
      sent(4).find((m) => m.content.includes('scope="contextual"')),
    ).toMatchObject({ role: 'system' });

    // Transcript holds conversation only — no skill scaffolding.
    const history = await request(http())
      .get(`/core/conversation/${sessionId}`)
      .expect(200);
    expect(JSON.stringify(history.body)).not.toContain('<skill');
    expect(JSON.stringify(history.body)).not.toContain('<available_skills>');
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
    chatWithTools.mockClear();
    await request(http())
      .post('/core/conversation')
      .send({ message: 'third', sessionId })
      .expect(200);
    const sent = chatWithTools.mock.calls[0][0] as {
      messages: { content: string }[];
    };
    expect(sent.messages.map((m) => m.content)).toEqual([
      `test-system\n\n${TOOL_STEP_INSTRUCTION}\n\n${buildPlanningBlock({
        goal: 'third',
        tools: new ToolRegistry().list(),
        maxToolSteps: MAX_TOOL_STEPS,
        maxIterations: MAX_ITERATIONS,
        progress: { stepsUsed: 0, toolCallsUsed: 0, priorActions: [] },
      })}`,
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
    chatWithTools.mockResolvedValueOnce({
      kind: 'text',
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

  describe('tool turns', () => {
    // NOTE: mock call ids must be unique per proposal like a real
    // provider's. Reused ids collide in context validation
    // (invalid_context), which is correct fail-closed behavior.
    function searchCall(query = 'teal', limit = 20, id = 'model-call-1') {
      const rawArguments = JSON.stringify({ query, limit });
      return {
        kind: 'tool_calls',
        content: null,
        model: 'test-model',
        toolCalls: [
          {
            id,
            name: 'session.search',
            version: 1,
            rawArguments,
            args: { query, limit },
          },
        ],
      };
    }

    function renameCall(title = 'Ward map') {
      const rawArguments = JSON.stringify({ title });
      return {
        kind: 'tool_calls',
        content: null,
        model: 'test-model',
        toolCalls: [
          {
            id: 'model-call-1',
            name: 'session.rename',
            version: 1,
            rawArguments,
            args: { title },
          },
        ],
      };
    }

    function finalText(content: string) {
      return { kind: 'text', content, model: 'test-model' };
    }

    it('executes a search turn against the real transcript, scoped to the session', async () => {
      const other = await request(http())
        .post('/core/conversation')
        .send({ message: 'teal private' })
        .expect(200);
      const otherId = (other.body as ConversationResponse).sessionId;

      const first = await request(http())
        .post('/core/conversation')
        .send({ message: 'teal local' })
        .expect(200);
      const sessionId = (first.body as ConversationResponse).sessionId;

      chatWithTools.mockResolvedValueOnce(searchCall('teal'));
      chatWithTools.mockResolvedValueOnce(finalText('teal is local'));
      const turn = await request(http())
        .post('/core/conversation')
        .send({ message: 'find teal', sessionId })
        .expect(200);
      const body = turn.body as ConversationResponse;
      expect(body.status).toBe('ok');
      expect(body.reply).toBe('teal is local');
      expect(body.requestId).toBeDefined();
      expect(body.tool).toMatchObject({
        invocationId: anyString,
        name: 'session.search',
      });

      // The second proposal consumed the durable scoped result while
      // tools stayed offered (multi-step chaining, not a disabled final).
      const chained = chatWithTools.mock.calls.find((call) =>
        ((call[0] as { messages?: { role?: string }[] }).messages ?? []).some(
          (m) => m.role === 'tool',
        ),
      );
      expect(chained).toBeDefined();
      expect((chained?.[0] as { tools?: unknown[] }).tools).toHaveLength(2);
      const toolMessage = (
        chained?.[0] as {
          messages: { role: string; callId?: string; content: string }[];
        }
      ).messages.find((m) => m.role === 'tool');
      expect(toolMessage?.callId).toBe(body.tool?.invocationId);
      const result = JSON.parse(toolMessage?.content ?? '{}') as {
        ok: boolean;
        matches: { sessionId: string; content: string }[];
      };
      expect(result.ok).toBe(true);
      expect(result.matches.map((m) => m.sessionId)).toEqual([sessionId]);
      expect(result.matches.every((m) => m.sessionId !== otherId)).toBe(true);

      const history = await request(http())
        .get(`/core/conversation/${sessionId}`)
        .expect(200);
      expect(
        (history.body as HistoryResponse).messages.map((m) => m.content),
      ).toEqual(['teal local', 'mock reply', 'find teal', 'teal is local']);
    });

    it('skips repeated calls without re-executing', async () => {
      const first = await request(http())
        .post('/core/conversation')
        .send({ message: 'teal local' })
        .expect(200);
      const sessionId = (first.body as ConversationResponse).sessionId;

      chatWithTools.mockResolvedValueOnce(searchCall('teal'));
      chatWithTools.mockResolvedValueOnce(searchCall('teal'));
      chatWithTools.mockResolvedValueOnce(finalText('deduped answer'));
      const turn = await request(http())
        .post('/core/conversation')
        .send({ message: 'find teal', sessionId })
        .expect(200);
      expect((turn.body as ConversationResponse).reply).toBe('deduped answer');

      const db = new Database(join(dir, 'sessions.sqlite'), {
        readonly: true,
      });
      try {
        const rows = db
          .prepare(
            `SELECT COUNT(*) AS n FROM tool_requests
             WHERE session_id = ? AND state = 'succeeded'`,
          )
          .get(sessionId) as { n: number };
        // One execution despite two identical proposals.
        expect(rows.n).toBe(1);
      } finally {
        db.close();
      }

      const history = await request(http())
        .get(`/core/conversation/${sessionId}`)
        .expect(200);
      expect(
        (history.body as HistoryResponse).messages.map((m) => m.content),
      ).toEqual(['teal local', 'mock reply', 'find teal', 'deduped answer']);
    });

    it('recovers from a rejected proposal with corrected arguments', async () => {
      const first = await request(http())
        .post('/core/conversation')
        .send({ message: 'hello' })
        .expect(200);
      const sessionId = (first.body as ConversationResponse).sessionId;

      // Blank queries fail validation; the model sees the failure and
      // corrects within the same turn instead of 502ing.
      chatWithTools.mockResolvedValueOnce({
        kind: 'tool_calls',
        content: null,
        model: 'test-model',
        toolCalls: [
          {
            id: 'model-call-1',
            name: 'session.search',
            version: 1,
            rawArguments: '{"query":"","limit":20}',
            args: { query: '', limit: 20 },
          },
        ],
      });
      chatWithTools.mockResolvedValueOnce(finalText('recovered answer'));
      const turn = await request(http())
        .post('/core/conversation')
        .send({ message: 'find teal', sessionId })
        .expect(200);
      expect((turn.body as ConversationResponse).reply).toBe(
        'recovered answer',
      );

      const history = await request(http())
        .get(`/core/conversation/${sessionId}`)
        .expect(200);
      expect(
        (history.body as HistoryResponse).messages.map((m) => m.content),
      ).toEqual(['hello', 'mock reply', 'find teal', 'recovered answer']);
    });

    it('delivers the persisted result when the final response failed', async () => {
      const first = await request(http())
        .post('/core/conversation')
        .send({ message: 'teal local' })
        .expect(200);
      const sessionId = (first.body as ConversationResponse).sessionId;

      // The model keeps searching, so the step bound forces finalization
      // through resume(); the final call itself goes down. Distinct
      // call ids like a real provider (reused ids would collide in
      // context validation).
      for (let i = 0; i < 6; i++) {
        chatWithTools.mockResolvedValueOnce(
          searchCall('teal', 20, `call-${i}`),
        );
      }
      chatWithTools.mockRejectedValueOnce(new Error('provider down'));
      const turn = await request(http())
        .post('/core/conversation')
        .send({ message: 'find teal', sessionId })
        .expect(200);
      const body = turn.body as ConversationResponse;
      expect(body.status).toBe('ok');
      expect(body.reply).toContain('could not be completed');
      const delivered = body.result as {
        ok: boolean;
        matches: { sessionId: string; content: string }[];
      };
      expect(delivered.ok).toBe(true);
      expect(delivered.matches).toHaveLength(1);
      expect(delivered.matches[0]).toMatchObject({
        sessionId,
        content: 'teal local',
      });

      const resumed = await request(http())
        .post('/core/conversation/resume')
        .send({ sessionId, requestId: body.requestId })
        .expect(200);
      expect((resumed.body as ConversationResponse).reply).toBe(body.reply);
      const history = await request(http())
        .get(`/core/conversation/${sessionId}`)
        .expect(200);
      expect(
        (history.body as HistoryResponse).messages.map((m) => m.content),
      ).toEqual(['teal local', 'mock reply', 'find teal', body.reply]);
    });

    it('parks renames as 202, then resumes after approval exactly once', async () => {
      const first = await request(http())
        .post('/core/conversation')
        .send({ message: 'hello' })
        .expect(200);
      const sessionId = (first.body as ConversationResponse).sessionId;

      chatWithTools.mockResolvedValueOnce(renameCall('Ward map'));
      const parked = await request(http())
        .post('/core/conversation')
        .send({ message: 'call it Ward map', sessionId })
        .expect(202);
      const pending = parked.body as ConversationResponse;
      expect(pending.status).toBe('approval_required');
      expect(pending.requestId).toBeDefined();
      expect(pending.approval).toMatchObject({
        approvalId: anyString,
        tool: 'session.rename',
        args: { title: 'Ward map' },
      });

      // Nothing persisted while approval is pending.
      const before = await request(http())
        .get(`/core/conversation/${sessionId}`)
        .expect(200);
      expect(
        (before.body as HistoryResponse).messages.map((m) => m.content),
      ).toEqual(['hello', 'mock reply']);

      // The parked invocation exists with no execution attached.
      const parkDb = new Database(join(dir, 'sessions.sqlite'), {
        readonly: true,
      });
      try {
        const parked = parkDb
          .prepare(
            `SELECT state, execution_json FROM tool_requests WHERE request_id = ?`,
          )
          .get(pending.requestId) as {
          state: string;
          execution_json: string | null;
        };
        expect(parked.state).toBe('awaiting_approval');
        expect(parked.execution_json).toBeNull();
      } finally {
        parkDb.close();
      }

      await request(http())
        .post(`/core/approvals/${pending.approval?.approvalId}/approve`)
        .send({ sessionId })
        .expect(200);

      chatWithTools.mockResolvedValueOnce(finalText('renamed'));
      const resumed = await request(http())
        .post('/core/conversation/resume')
        .send({ sessionId, requestId: pending.requestId })
        .expect(200);
      expect((resumed.body as ConversationResponse).reply).toBe('renamed');

      const sessions = await request(http()).get('/core/sessions').expect(200);
      const renamed = (
        sessions.body as { sessions: { sessionId: string; title?: string }[] }
      ).sessions.find((s) => s.sessionId === sessionId);
      expect(renamed?.title).toBe('Ward map');

      // Duplicate resume answers from the durable record, no re-execution.
      const again = await request(http())
        .post('/core/conversation/resume')
        .send({ sessionId, requestId: pending.requestId })
        .expect(200);
      expect((again.body as ConversationResponse).reply).toBe('renamed');
      const after = await request(http())
        .get(`/core/conversation/${sessionId}`)
        .expect(200);
      expect(
        (after.body as HistoryResponse).messages.map((m) => m.content),
      ).toEqual(['hello', 'mock reply', 'call it Ward map', 'renamed']);
    });

    it('reconsiders after rejection with zero execution', async () => {
      const first = await request(http())
        .post('/core/conversation')
        .send({ message: 'hello' })
        .expect(200);
      const sessionId = (first.body as ConversationResponse).sessionId;

      chatWithTools.mockResolvedValueOnce(renameCall('Nope'));
      const parked = await request(http())
        .post('/core/conversation')
        .send({ message: 'rename it', sessionId })
        .expect(202);
      const pending = parked.body as ConversationResponse;

      await request(http())
        .post(`/core/approvals/${pending.approval?.approvalId}/reject`)
        .send({ sessionId })
        .expect(200);

      // The denial becomes an observation: the agent answers from it
      // instead of dying on the mirror notice.
      chatWithTools.mockResolvedValueOnce(finalText('leaving the name'));
      const resumed = await request(http())
        .post('/core/conversation/resume')
        .send({ sessionId, requestId: pending.requestId })
        .expect(200);
      expect((resumed.body as ConversationResponse).status).toBe('ok');
      expect((resumed.body as ConversationResponse).outcome).toBeUndefined();
      expect((resumed.body as ConversationResponse).reply).toBe(
        'leaving the name',
      );

      const sessions = await request(http()).get('/core/sessions').expect(200);
      const kept = (
        sessions.body as { sessions: { sessionId: string; title?: string }[] }
      ).sessions.find((s) => s.sessionId === sessionId);
      expect(kept?.title).toBeUndefined();

      const history = await request(http())
        .get(`/core/conversation/${sessionId}`)
        .expect(200);
      expect(
        (history.body as HistoryResponse).messages.map((m) => m.content),
      ).toEqual(['hello', 'mock reply', 'rename it', 'leaving the name']);

      const db = new Database(join(dir, 'sessions.sqlite'), {
        readonly: true,
      });
      try {
        const runs = db
          .prepare(
            `SELECT state, termination_json FROM agent_runs
             WHERE session_id = ? ORDER BY rowid`,
          )
          .all(sessionId) as {
          state: string;
          termination_json: string;
        }[];
        expect(runs).toHaveLength(2);
        expect(runs[1]).toMatchObject({ state: 'completed' });
        expect(JSON.parse(runs[1].termination_json)).toMatchObject({
          reason: 'final_answer',
        });
      } finally {
        db.close();
      }
    });

    it('validates resume requests and denies foreign sessions', async () => {
      await request(http())
        .post('/core/conversation/resume')
        .send({ sessionId: 'not-a-uuid', requestId: 'also-bad' })
        .expect(400);
      await request(http())
        .post('/core/conversation/resume')
        .send({
          sessionId: '11111111-1111-4111-8111-111111111111',
          requestId: '22222222-2222-4222-8222-222222222222',
        })
        .expect(404);

      const first = await request(http())
        .post('/core/conversation')
        .send({ message: 'hello' })
        .expect(200);
      const sessionId = (first.body as ConversationResponse).sessionId;
      chatWithTools.mockResolvedValueOnce(renameCall('Ward map'));
      const parked = await request(http())
        .post('/core/conversation')
        .send({ message: 'rename it', sessionId })
        .expect(202);
      const pending = parked.body as ConversationResponse;

      const fork = await request(http())
        .post('/core/conversation')
        .send({ message: '/fork', sessionId })
        .expect(200);
      const forkId = (fork.body as ConversationResponse).sessionId;
      expect(forkId).not.toBe(sessionId);
      await request(http())
        .post('/core/conversation/resume')
        .send({ sessionId: forkId, requestId: pending.requestId })
        .expect(400);
    });

    it('streams tool and approval events over SSE', async () => {
      const first = await request(http())
        .post('/core/conversation')
        .send({ message: 'hello' })
        .expect(200);
      const sessionId = (first.body as ConversationResponse).sessionId;

      chatStreamWithTools.mockResolvedValueOnce(searchCall('teal'));
      chatStreamWithTools.mockResolvedValueOnce(finalText('teal is local'));
      const searched = await request(http())
        .post('/core/conversation/stream')
        .send({ message: 'find teal', sessionId })
        .expect(200)
        .expect('Content-Type', /event-stream/);
      expect(searched.text).toContain('event: tool');
      expect(searched.text).toContain('"reply":"teal is local"');

      chatStreamWithTools.mockResolvedValueOnce(renameCall('Ward map'));
      const parked = await request(http())
        .post('/core/conversation/stream')
        .send({ message: 'rename it', sessionId })
        .expect(200)
        .expect('Content-Type', /event-stream/);
      expect(parked.text).toContain('event: approval');
      expect(parked.text).toContain('event: done');
      expect(parked.text).not.toContain('event: token');
    });

    it('keeps the execution record across /undo without re-executing', async () => {
      const first = await request(http())
        .post('/core/conversation')
        .send({ message: 'hello' })
        .expect(200);
      const sessionId = (first.body as ConversationResponse).sessionId;

      chatWithTools.mockResolvedValueOnce(renameCall('Ward map'));
      const parked = await request(http())
        .post('/core/conversation')
        .send({ message: 'rename it', sessionId })
        .expect(202);
      const pending = parked.body as ConversationResponse;
      await request(http())
        .post(`/core/approvals/${pending.approval?.approvalId}/approve`)
        .send({ sessionId })
        .expect(200);
      chatWithTools.mockResolvedValueOnce(finalText('renamed'));
      await request(http())
        .post('/core/conversation/resume')
        .send({ sessionId, requestId: pending.requestId })
        .expect(200);

      // Undo hides the turn text but the ledger still answers.
      await request(http())
        .post('/core/conversation')
        .send({ message: '/undo', sessionId })
        .expect(200);
      const resumed = await request(http())
        .post('/core/conversation/resume')
        .send({ sessionId, requestId: pending.requestId })
        .expect(200);
      expect((resumed.body as ConversationResponse).reply).toBe('renamed');
      const history = await request(http())
        .get(`/core/conversation/${sessionId}`)
        .expect(200);
      const contents = (history.body as HistoryResponse).messages.map(
        (m) => m.content,
      );
      expect(contents.filter((c) => c === 'renamed')).toHaveLength(1);
    });

    it('keeps distinct durable identities across chained steps', async () => {
      const first = await request(http())
        .post('/core/conversation')
        .send({ message: 'teal local' })
        .expect(200);
      const sessionId = (first.body as ConversationResponse).sessionId;

      chatWithTools.mockResolvedValueOnce(searchCall('teal'));
      chatWithTools.mockResolvedValueOnce(searchCall('local'));
      chatWithTools.mockResolvedValueOnce(finalText('both found'));
      const turn = await request(http())
        .post('/core/conversation')
        .send({ message: 'find both', sessionId })
        .expect(200);
      expect((turn.body as ConversationResponse).status).toBe('ok');

      const db = new Database(join(dir, 'sessions.sqlite'), {
        readonly: true,
      });
      try {
        const rows = db
          .prepare(
            `SELECT request_id, invocation_id, execution_json IS NOT NULL AS executed
             FROM tool_requests WHERE session_id = ? ORDER BY rowid`,
          )
          .all(sessionId) as {
          request_id: string;
          invocation_id: string | null;
          executed: number;
        }[];
        // Two executed steps with distinct durable invocations, plus
        // the closing text row — no duplicates, no shared identity.
        const invoked = rows.filter((r) => r.invocation_id);
        expect(invoked).toHaveLength(2);
        expect(invoked[0].invocation_id).not.toBe(invoked[1].invocation_id);
        expect(invoked.map((r) => r.executed)).toEqual([1, 1]);
        const runs = db
          .prepare(`SELECT request_ids FROM agent_runs WHERE session_id = ?`)
          .all(sessionId) as { request_ids: string }[];
        const chained = runs.filter(
          (r) => (JSON.parse(r.request_ids) as string[]).length === 3,
        );
        expect(chained).toHaveLength(1);
        // The seed turn's closed text row leads; the run references
        // exactly its own three steps.
        expect(JSON.parse(chained[0].request_ids)).toEqual(
          rows.map((r) => r.request_id).slice(-3),
        );
      } finally {
        db.close();
      }

      // One transcript pair despite two executions.
      const history = await request(http())
        .get(`/core/conversation/${sessionId}`)
        .expect(200);
      expect(
        (history.body as HistoryResponse).messages.map((m) => m.content),
      ).toEqual(['teal local', 'mock reply', 'find both', 'both found']);
    });

    it('recovers a failed final across restart without re-executing', async () => {
      const first = await request(http())
        .post('/core/conversation')
        .send({ message: 'teal local' })
        .expect(200);
      const sessionId = (first.body as ConversationResponse).sessionId;

      // The model keeps searching, so the step bound finalizes through
      // resume(); the final call itself goes down. Distinct call ids
      // like a real provider (reused ids would collide in validation).
      for (let i = 0; i < 6; i++) {
        chatWithTools.mockResolvedValueOnce(
          searchCall('teal', 20, `call-${i}`),
        );
      }
      chatWithTools.mockRejectedValueOnce(new Error('provider down'));
      const turn = await request(http())
        .post('/core/conversation')
        .send({ message: 'find teal', sessionId })
        .expect(200);
      const requestId = (turn.body as ConversationResponse).requestId;
      expect((turn.body as ConversationResponse).status).toBe('ok');

      // Simulate a Core restart against the same database files.
      await app?.close();
      app = await createApp(
        join(dir, 'sessions.sqlite'),
        join(dir, 'memories.sqlite'),
      );

      // The durable result answers; nothing re-executes, no LLM call.
      chatWithTools.mockClear();
      const resumed = await request(http())
        .post('/core/conversation/resume')
        .send({ sessionId, requestId })
        .expect(200);
      expect((resumed.body as ConversationResponse).reply).toBe(
        (turn.body as ConversationResponse).reply,
      );
      expect(chatWithTools).not.toHaveBeenCalled();

      const history = await request(http())
        .get(`/core/conversation/${sessionId}`)
        .expect(200);
      expect(
        (history.body as HistoryResponse).messages.map((m) => m.content),
      ).toEqual([
        'teal local',
        'mock reply',
        'find teal',
        (turn.body as ConversationResponse).reply,
      ]);
    });

    it('resumes a parked approval across restart', async () => {
      const first = await request(http())
        .post('/core/conversation')
        .send({ message: 'hello' })
        .expect(200);
      const sessionId = (first.body as ConversationResponse).sessionId;

      chatWithTools.mockResolvedValueOnce(renameCall('Ward map'));
      const parked = await request(http())
        .post('/core/conversation')
        .send({ message: 'rename it', sessionId })
        .expect(202);
      const pending = parked.body as ConversationResponse;

      // Restart while the approval is still pending.
      await app?.close();
      app = await createApp(
        join(dir, 'sessions.sqlite'),
        join(dir, 'memories.sqlite'),
      );

      // The approval survived; the resumed run continues planning.
      chatWithTools.mockResolvedValueOnce(finalText('renamed after restart'));
      await request(http())
        .post(`/core/approvals/${pending.approval?.approvalId}/approve`)
        .send({ sessionId })
        .expect(200);
      const resumed = await request(http())
        .post('/core/conversation/resume')
        .send({ sessionId, requestId: pending.requestId })
        .expect(200);
      expect((resumed.body as ConversationResponse).status).toBe('ok');

      const sessions = await request(http()).get('/core/sessions').expect(200);
      const renamed = (
        sessions.body as { sessions: { sessionId: string; title?: string }[] }
      ).sessions.find((s) => s.sessionId === sessionId);
      expect(renamed?.title).toBe('Ward map');
    });
  });
});
