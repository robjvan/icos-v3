import {
  BadGatewayException,
  GatewayTimeoutException,
  NotFoundException,
} from '@nestjs/common';
import { CoreConfig } from '../config';
import { LlmClient, LlmError } from '../llm/llm.client';
import type { ChatMessage, ChatResult } from '../llm/llm.client';
import { ConversationService } from './conversation.service';
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

function setup(chatImpl?: ChatFn) {
  const store = new SessionStore(config);
  const chat = jest.fn<Promise<ChatResult>, [ChatMessage[]]>(
    chatImpl ?? (() => Promise.resolve({ content: 'hi back', model: 'm' })),
  );
  const llm = { chat } as unknown as LlmClient;
  return { service: new ConversationService(store, llm, config), store, chat };
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
});
