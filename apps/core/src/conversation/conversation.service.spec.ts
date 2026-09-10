import {
  BadGatewayException,
  GatewayTimeoutException,
  NotFoundException,
} from '@nestjs/common';
import { CoreConfig } from '../config';
import { LlmClient, LlmError } from '../llm/llm.client';
import type { ChatMessage, ChatResult, StreamSink } from '../llm/llm.client';
import { ConversationService } from './conversation.service';
import type { ConversationStreamEvent } from './conversation.service';
import { SessionStore } from './session.store';

const config: CoreConfig = {
  port: 3000,
  llmBaseUrl: 'http://localhost:11434/v1',
  llmModel: 'test-model',
  llmTimeoutMs: 1000,
  systemPrompt: 'test-system',
  maxHistory: 50,
};

type ChatFn = (messages: ChatMessage[]) => Promise<ChatResult>;
type ChatStreamFn = (
  messages: ChatMessage[],
  sink: StreamSink,
  signal?: AbortSignal,
) => Promise<ChatResult>;

function setup(chatImpl?: ChatFn, chatStreamImpl?: ChatStreamFn) {
  const store = new SessionStore(config);
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
  return {
    service: new ConversationService(store, llm, config),
    store,
    chat,
    chatStream,
  };
}

describe('ConversationService', () => {
  it('creates a session, calls the LLM with system context, and stores history', async () => {
    const { service, store, chat } = setup();

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
    expect(store.get(result.sessionId)).toEqual([
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

  it('maps LLM timeouts to 504 and other failures to 502', async () => {
    const timeout = setup(() =>
      Promise.reject(new LlmError(504, 'timed out', true)),
    );
    await expect(timeout.service.converse('hi')).rejects.toBeInstanceOf(
      GatewayTimeoutException,
    );

    const failure = setup(() =>
      Promise.reject(new LlmError(502, 'bad', false)),
    );
    await expect(failure.service.converse('hi')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('returns history and 404s unknown sessions', async () => {
    const { service } = setup();
    const { sessionId } = await service.converse('hello');
    expect(service.history(sessionId).messages).toHaveLength(2);
    expect(() =>
      service.history('00000000-0000-0000-0000-000000000000'),
    ).toThrow(NotFoundException);
  });

  describe('converseStream', () => {
    it('emits meta, tokens, done in order and stores history', async () => {
      const { service, store } = setup();
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
      expect(store.get(sessionId ?? '')).toEqual([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi back' },
      ]);
    });

    it('emits error and stores nothing when the LLM fails', async () => {
      const { service, store } = setup(undefined, () =>
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
      expect(store.get(sessionId)).toEqual([]);
    });
  });
});
