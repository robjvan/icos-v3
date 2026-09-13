import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  NotFoundException,
} from '@nestjs/common';
import type { CoreConfig } from '../config';
import { LlmClient, LlmError } from '../llm/llm.client';
import type { ChatResult, StreamSink } from '../llm/llm.client';
import type { LlmChatRequest } from '../llm/llm-provider';
import { InvalidSearchQueryError } from '../session/session.repository';
import type { ValidatedCandidate } from '../memory/memory-candidate';
import type { NewMemoryCandidate } from '../memory/memory-candidate';
import { MemoryCandidateExtractor } from '../memory/memory-candidate-extractor';
import type { MemoryExtractionInput } from '../memory/memory-candidate-extractor';
import { MemoryCandidateRepository } from '../memory/memory-candidate.repository';
import type { MemoryCandidate } from '../memory/memory-candidate';
import { CommandDispatcher } from '../commands/command-dispatcher';
import { DisplayPreferenceStore } from '../commands/display-preferences';
import { HostHealthProvider } from '../commands/host-health';
import { SkillService } from '../skills/skill.service';
import { ConversationService } from './conversation.service';
import type { ConversationStreamEvent } from './conversation.service';
import { FakeSessionRepository } from './fake-session.repository';
import { SessionStore } from './session.store';

function testConfig(overrides: Partial<CoreConfig> = {}): CoreConfig {
  return {
    port: 3000,
    provider: 'ollama',
    llmBaseUrl: 'http://localhost:11434/v1',
    llmModel: 'test-model',
    llmTimeoutMs: 1000,
    systemPrompt: 'test-system',
    maxHistory: 50,
    sessionDbPath: ':memory:',
    memoryDbPath: ':memory:',
    legacyDbPath: '/tmp/icos-test-legacy-missing.sqlite',
    memoryExtractionEnabled: true,
    memoryProvider: 'ollama',
    memoryLlmBaseUrl: 'http://localhost:11434/v1',
    memoryLlmModel: 'test-model',
    memoryLlmTimeoutMs: 1000,
    skillsDirPath: '/tmp/icos-test-skills-missing',
    skillsEnabled: true,
    skillsMaxBodyChars: 12000,
    skillsMaxCatalogItems: 50,
    skillsMaxActivePerSession: 5,
    skillsMaxAutoLoadedPerTurn: 2,
    skillsMaxContextChars: 8000,
    ...overrides,
  };
}

const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

type ChatFn = (request: LlmChatRequest) => Promise<ChatResult>;
type ChatStreamFn = (
  request: LlmChatRequest,
  sink: StreamSink,
  signal?: AbortSignal,
) => Promise<ChatResult>;

type ExtractFn = (
  input: MemoryExtractionInput,
) => Promise<ValidatedCandidate[]>;

function setup(
  config: CoreConfig = testConfig(),
  chatImpl?: ChatFn,
  chatStreamImpl?: ChatStreamFn,
  extractImpl?: ExtractFn,
) {
  const repository = new FakeSessionRepository();
  const store = new SessionStore(repository, config);
  const chat = jest.fn<Promise<ChatResult>, [LlmChatRequest]>(
    chatImpl ?? (() => Promise.resolve({ content: 'hi back', model: 'm' })),
  );
  const chatStream = jest.fn<Promise<ChatResult>, [LlmChatRequest, StreamSink]>(
    chatStreamImpl ??
      ((_messages, sink) => {
        sink.onToken('hi ');
        sink.onToken('back');
        return Promise.resolve({ content: 'hi back', model: 'm' });
      }),
  );
  const llm = { chat, chatStream } as unknown as LlmClient;
  const extract = jest.fn<
    Promise<ValidatedCandidate[]>,
    [MemoryExtractionInput]
  >(extractImpl ?? (() => Promise.resolve([])));
  const extractor = { extract } as unknown as MemoryCandidateExtractor;
  const saveCandidates = jest.fn(
    (items: NewMemoryCandidate[]): Promise<MemoryCandidate[]> =>
      Promise.resolve(
        items.map((item, index) => ({
          ...item,
          id: `c${index}`,
          extractedAt: new Date(0).toISOString(),
        })),
      ),
  );
  const candidates = {
    saveCandidates,
    listCandidates: jest.fn(() => Promise.resolve([])),
    ping: jest.fn(() => Promise.resolve()),
  } as unknown as MemoryCandidateRepository;
  const prefs = new DisplayPreferenceStore();
  const host = {
    collect: jest.fn(() =>
      Promise.resolve({
        os: 'test-os',
        arch: 'x86_64',
        uptimeSeconds: 61,
        cpuCores: 4,
        cpuPercent: 12.5,
        loadAverage: [0.5, 0.4, 0.3],
        memoryUsedBytes: 1024 ** 3,
        memoryTotalBytes: 4 * 1024 ** 3,
        diskUsedBytes: 10 * 1024 ** 3,
        diskTotalBytes: 100 * 1024 ** 3,
        gpu: null,
      }),
    ),
  } as unknown as HostHealthProvider;
  const commands = new CommandDispatcher(
    store,
    candidates,
    prefs,
    host,
    new SkillService(config),
    config,
  );
  return {
    service: new ConversationService(
      store,
      llm,
      extractor,
      candidates,
      commands,
      config,
    ),
    repository,
    chat,
    chatStream,
    extract,
    saveCandidates,
  };
}

describe('ConversationService', () => {
  it('creates a session, calls the LLM with system context, and stores history', async () => {
    const { service, repository, chat } = setup();

    const result = await service.converse('hello');

    expect(result.sessionId).toBeDefined();
    expect(result.reply).toBe('hi back');
    expect(chat).toHaveBeenCalledTimes(1);
    const sent = chat.mock.calls[0][0];
    expect(sent.sessionId).toBe(result.sessionId);
    expect(sent.messages[0]).toEqual({
      role: 'system',
      content: 'test-system',
    });
    expect(sent.messages[sent.messages.length - 1]).toEqual({
      role: 'user',
      content: 'hello',
    });
    expect(await repository.getMessages(result.sessionId)).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi back' },
    ]);
  });

  it('continues an existing session and includes prior history', async () => {
    const { service, chat } = setup();
    const first = await service.converse('first');
    await service.converse('second', first.sessionId);

    const secondCall = chat.mock.calls[1][0];
    expect(secondCall.sessionId).toBe(first.sessionId);
    expect(secondCall.messages.map((m) => m.content)).toEqual([
      'test-system',
      'first',
      'hi back',
      'second',
    ]);
  });

  it('bounds LLM context to maxHistory while persisting everything', async () => {
    const config = testConfig({ maxHistory: 5 });
    const { service, repository, chat } = setup(config);
    const { sessionId } = await service.converse('seed');
    for (let i = 0; i < 10; i++) {
      await repository.appendMessage(sessionId, {
        role: 'user',
        content: `stored-${i}`,
      });
    }

    await service.converse('latest', sessionId);

    const sent = chat.mock.calls[1][0];
    // system + last 5 stored + new input.
    expect(sent.messages.map((m) => m.content)).toEqual([
      'test-system',
      'stored-5',
      'stored-6',
      'stored-7',
      'stored-8',
      'stored-9',
      'latest',
    ]);
    expect(await repository.getMessages(sessionId)).toHaveLength(14);
  });

  it('maps LLM timeouts to 504 and other failures to 502', async () => {
    const timeout = setup(testConfig(), () =>
      Promise.reject(new LlmError(504, 'timed out', true)),
    );
    await expect(timeout.service.converse('hi')).rejects.toBeInstanceOf(
      GatewayTimeoutException,
    );

    const failure = setup(testConfig(), () =>
      Promise.reject(new LlmError(502, 'bad', false)),
    );
    await expect(failure.service.converse('hi')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('returns history and 404s unknown sessions', async () => {
    const { service } = setup();
    const { sessionId } = await service.converse('hello');
    expect((await service.history(sessionId)).messages).toHaveLength(2);
    await expect(
      service.history('00000000-0000-0000-0000-000000000000'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists sessions newest-first', async () => {
    const { service } = setup();
    await service.converse('first topic');
    const second = await service.converse('second topic');

    const sessions = await service.listSessions();
    expect(sessions.map((s) => s.sessionId)).toEqual([
      second.sessionId,
      sessions[1]?.sessionId,
    ]);
    expect(sessions[0]).toMatchObject({
      sessionId: second.sessionId,
      messageCount: 2,
      preview: 'second topic',
    });
  });

  it('searches transcripts and maps invalid queries to 400', async () => {
    const { service } = setup();
    const { sessionId } = await service.converse('I like teal');

    const results = await service.searchSessions('teal');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      sessionId,
      role: 'user',
      content: 'I like teal',
    });

    const failing = setup();
    jest
      .spyOn(failing.repository, 'searchMessages')
      .mockRejectedValue(new InvalidSearchQueryError('"'));
    await expect(failing.service.searchSessions('"')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  describe('converseStream', () => {
    it('emits meta, tokens, done in order and stores history', async () => {
      const { service, repository } = setup();
      const events: ConversationStreamEvent[] = [];

      await service.converseStream('hello', undefined, (event) =>
        events.push(event),
      );

      expect(events[0]).toMatchObject({ type: 'meta' });
      const sessionId =
        events[0].type === 'meta' ? events[0].sessionId : undefined;
      expect(events.slice(1, -1)).toEqual([
        { type: 'token', content: 'hi ' },
        { type: 'token', content: 'back' },
      ]);
      expect(events[events.length - 1]).toEqual({
        type: 'done',
        reply: 'hi back',
        model: 'm',
      });
      expect(sessionId).toBeDefined();
      expect(await repository.getMessages(sessionId ?? '')).toEqual([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi back' },
      ]);
    });

    it('emits error and stores nothing when the LLM fails', async () => {
      const { service, repository } = setup(testConfig(), undefined, () =>
        Promise.reject(new LlmError(502, 'boom', false)),
      );
      const events: ConversationStreamEvent[] = [];

      await service.converseStream('hello', undefined, (event) =>
        events.push(event),
      );

      expect(events[0]?.type).toBe('meta');
      expect(events[1]).toMatchObject({ type: 'error', message: 'boom' });
      expect(events).toHaveLength(2);
      const sessionId = events[0].type === 'meta' ? events[0].sessionId : '';
      expect(await repository.getMessages(sessionId)).toHaveLength(0);
    });
  });

  describe('memory extraction', () => {
    const preference: ValidatedCandidate = {
      kind: 'preference',
      subject: 'user',
      predicate: 'prefers',
      object: 'TypeScript',
      confidence: 0.94,
      importance: 0.72,
      stability: 0.88,
    };

    it('persists validated candidates with provenance after a turn', async () => {
      const { service, extract, saveCandidates } = setup(
        testConfig(),
        undefined,
        undefined,
        () => Promise.resolve([preference]),
      );

      const { sessionId } = await service.converse('I prefer TypeScript');
      await flushMicrotasks();

      expect(extract).toHaveBeenCalledTimes(1);
      expect(extract.mock.calls[0][0]).toMatchObject({
        sessionId,
        userMessage: { role: 'user', content: 'I prefer TypeScript' },
        assistantMessage: { role: 'assistant', content: 'hi back' },
      });
      expect(saveCandidates).toHaveBeenCalledTimes(1);
      expect(saveCandidates.mock.calls[0][0]).toEqual([
        {
          ...preference,
          source: { sessionId, messageId: 1 },
          extractorModel: 'test-model',
          extractorVersion: 'memory-extraction-v1',
        },
      ]);
    });

    it('extracts after streamed turns too', async () => {
      const { service, extract } = setup(
        testConfig(),
        undefined,
        undefined,
        () => Promise.resolve([preference]),
      );

      await service.converseStream('hello', undefined, () => {});
      await flushMicrotasks();

      expect(extract).toHaveBeenCalledTimes(1);
    });

    it('lets the conversation succeed when extraction fails', async () => {
      const { service, extract, saveCandidates } = setup(
        testConfig(),
        undefined,
        undefined,
        () => Promise.reject(new Error('extractor down')),
      );

      const result = await service.converse('hello');
      await flushMicrotasks();

      expect(result.reply).toBe('hi back');
      expect(extract).toHaveBeenCalledTimes(1);
      expect(saveCandidates).not.toHaveBeenCalled();
    });

    it('skips extraction when disabled', async () => {
      const { service, extract } = setup(
        testConfig({ memoryExtractionEnabled: false }),
      );

      await service.converse('hello');
      await flushMicrotasks();

      expect(extract).not.toHaveBeenCalled();
    });
  });

  describe('slash commands', () => {
    it('answers commands without touching the LLM, transcript, or extraction', async () => {
      const { service, repository, chat, extract, saveCandidates } = setup();

      const result = await service.converse('/health');

      expect(result.model).toBe('core');
      expect(result.reply).toContain('Core: healthy');
      expect(result.reply).toContain('Host System');
      expect(result.reply).toContain('Status: healthy');
      expect(result.command).toMatchObject({ kind: 'data' });
      expect(chat).not.toHaveBeenCalled();
      expect(extract).not.toHaveBeenCalled();
      await flushMicrotasks();
      expect(saveCandidates).not.toHaveBeenCalled();
      // No session conjured into existence as a side effect.
      expect(await repository.listSessions()).toHaveLength(0);
    });

    it('switches sessions on /new without deleting history', async () => {
      const { service, repository, chat } = setup();
      const first = await service.converse('hello');

      const created = await service.converse('/new', first.sessionId);

      expect(created.sessionId).not.toBe(first.sessionId);
      expect(created.command).toMatchObject({ kind: 'session' });
      expect(chat).toHaveBeenCalledTimes(1);
      expect(await repository.getMessages(first.sessionId)).toHaveLength(2);
    });

    it('rejects unknown and malformed commands without LLM contact', async () => {
      const { service, chat } = setup();

      await expect(service.converse('/nope')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.converse('/')).rejects.toThrow(BadRequestException);
      expect(chat).not.toHaveBeenCalled();
    });

    it('streams commands as meta then done with no tokens', async () => {
      const { service, chatStream } = setup();
      const events: ConversationStreamEvent[] = [];

      await service.converseStream('/health', undefined, (event) =>
        events.push(event),
      );

      expect(chatStream).not.toHaveBeenCalled();
      expect(events.some((e) => e.type === 'token')).toBe(false);
      const done = events[events.length - 1];
      expect(done.type).toBe('done');
      if (done.type === 'done') {
        expect(done.model).toBe('core');
        expect(done.reply).toContain('Core: healthy');
        expect(done.command).toMatchObject({ kind: 'data' });
      }
    });

    it('streams /new with a meta session switch', async () => {
      const { service } = setup();
      const events: ConversationStreamEvent[] = [];

      await service.converseStream('/new', undefined, (event) =>
        events.push(event),
      );

      expect(events[0]).toMatchObject({ type: 'meta', model: 'core' });
      const switched =
        events[0].type === 'meta' ? events[0].sessionId : undefined;
      expect(switched).toBeDefined();
      expect(events[events.length - 1]).toMatchObject({ type: 'done' });
    });

    it('streams command errors as error events', async () => {
      const { service, chatStream } = setup();
      const events: ConversationStreamEvent[] = [];

      await service.converseStream('/nope', undefined, (event) =>
        events.push(event),
      );

      expect(chatStream).not.toHaveBeenCalled();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: 'error' });
    });
  });
});
