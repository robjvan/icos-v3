import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  NotFoundException,
} from '@nestjs/common';
import type { CoreConfig } from '../config';
import { LlmClient, LlmError } from '../llm/llm.client';
import type { ChatMessage, ChatResult, StreamSink } from '../llm/llm.client';
import { InvalidSearchQueryError } from '../session/session.repository';
import type { ValidatedCandidate } from '../memory/memory-candidate';
import type { NewMemoryCandidate } from '../memory/memory-candidate';
import { MemoryCandidateExtractor } from '../memory/memory-candidate-extractor';
import type { MemoryExtractionInput } from '../memory/memory-candidate-extractor';
import { MemoryCandidateRepository } from '../memory/memory-candidate.repository';
import type { MemoryCandidate } from '../memory/memory-candidate';
import { ConversationService } from './conversation.service';
import type { ConversationStreamEvent } from './conversation.service';
import { FakeSessionRepository } from './fake-session.repository';
import { SessionStore } from './session.store';

function testConfig(overrides: Partial<CoreConfig> = {}): CoreConfig {
  return {
    port: 3000,
    llmBaseUrl: 'http://localhost:11434/v1',
    llmModel: 'test-model',
    llmTimeoutMs: 1000,
    systemPrompt: 'test-system',
    maxHistory: 50,
    dbPath: ':memory:',
    memoryExtractionEnabled: true,
    memoryLlmBaseUrl: 'http://localhost:11434/v1',
    memoryLlmModel: 'test-model',
    memoryLlmTimeoutMs: 1000,
    ...overrides,
  };
}

const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

type ChatFn = (messages: ChatMessage[]) => Promise<ChatResult>;
type ChatStreamFn = (
  messages: ChatMessage[],
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
  const chat = jest.fn<Promise<ChatResult>, [ChatMessage[]]>(
    chatImpl ?? (() => Promise.resolve({ content: 'hi back', model: 'm' })),
  );
  const chatStream = jest.fn<Promise<ChatResult>, [ChatMessage[], StreamSink]>(
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
  } as unknown as MemoryCandidateRepository;
  return {
    service: new ConversationService(store, llm, extractor, candidates, config),
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
    expect(sent[0]).toEqual({ role: 'system', content: 'test-system' });
    expect(sent[sent.length - 1]).toEqual({
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
    expect(secondCall.map((m) => m.content)).toEqual([
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
    expect(sent.map((m) => m.content)).toEqual([
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
});
