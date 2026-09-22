import type { CoreConfig } from '../config';
import { LlmClient } from './llm.client';
import type { ChatMessage } from './llm.client';
import { conversationEndpointConfig } from './llm-client.providers';
import { defaultUserAgent } from './llm-provider';

const baseConfig: CoreConfig = {
  port: 3000,
  provider: 'ollama',
  llmBaseUrl: 'http://localhost:11434/v1/chat/completions',
  llmModel: 'test-model',
  llmTimeoutMs: 1000,
  systemPrompt: 'sys',
  maxHistory: 50,
  sessionDbPath: ':memory:',
  memoryDbPath: ':memory:',
  legacyDbPath: '/tmp/icos-test-legacy-missing.sqlite',
  memoryExtractionEnabled: false,
  memoryProvider: 'ollama',
  memoryLlmBaseUrl: 'http://localhost:11434/v1/chat/completions',
  memoryLlmModel: 'test-model',
  memoryLlmTimeoutMs: 1000,
  skillsDirPath: '/tmp/icos-test-skills-missing',
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

function clientWith(overrides: Partial<CoreConfig> = {}): LlmClient {
  return new LlmClient(
    conversationEndpointConfig({ ...baseConfig, ...overrides }),
  );
}

function okResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('LlmClient', () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('POSTs model + messages to {baseUrl} and returns content', async () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'hi' }];
    const fetchMock = jest.fn(() =>
      Promise.resolve(
        okResponse({
          model: 'test-model',
          choices: [{ message: { content: 'hello there' } }],
        }),
      ),
    );
    global.fetch = fetchMock;

    const result = await clientWith().chat({ messages });

    expect(result).toEqual({ content: 'hello there', model: 'test-model' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'test-model',
      messages,
      stream: false,
    });
  });

  it('adds Authorization header only when an API key is configured', async () => {
    const seen: RequestInit[] = [];
    global.fetch = (_url: unknown, init?: RequestInit) => {
      seen.push(init ?? {});
      return Promise.resolve(
        okResponse({
          choices: [{ message: { content: 'x' } }],
        }),
      );
    };

    await clientWith().chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(seen[0]?.headers).not.toHaveProperty('Authorization');

    await clientWith({ llmApiKey: 'secret' }).chat({
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(seen[1]?.headers).toMatchObject({
      Authorization: 'Bearer secret',
    });
  });

  it('sends a stable application User-Agent by default', async () => {
    const seen: RequestInit[] = [];
    global.fetch = (_url: unknown, init?: RequestInit) => {
      seen.push(init ?? {});
      return Promise.resolve(
        okResponse({ choices: [{ message: { content: 'x' } }] }),
      );
    };

    await clientWith().chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(seen[0]?.headers).toMatchObject({
      'User-Agent': defaultUserAgent(),
    });
    expect(defaultUserAgent()).toMatch(/^icos\//);

    await clientWith({ userAgent: 'custom-agent/9.9' }).chat({
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(seen[1]?.headers).toMatchObject({
      'User-Agent': 'custom-agent/9.9',
    });
  });

  it('tags errors with the provider id', async () => {
    global.fetch = () => Promise.resolve(new Response('nope', { status: 401 }));

    const err = await clientWith({ provider: 'openrouter' })
      .chat({ messages: [{ role: 'user', content: 'hi' }] })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'LlmError', httpStatus: 502 });
    expect((err as Error).message).toContain('[openrouter]');
  });

  it('throws 502 when the endpoint returns an error status', async () => {
    global.fetch = () => Promise.resolve(new Response('boom', { status: 500 }));

    const err = await clientWith()
      .chat({ messages: [{ role: 'user', content: 'hi' }] })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'LlmError', httpStatus: 502 });
  });

  it('throws 502 when choices are empty', async () => {
    global.fetch = () => Promise.resolve(okResponse({ choices: [] }));

    const err = await clientWith()
      .chat({ messages: [{ role: 'user', content: 'hi' }] })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'LlmError', httpStatus: 502 });
  });

  it('throws 504 when the request fails (network error / abort)', async () => {
    global.fetch = (): Promise<Response> => {
      throw new DOMException('aborted', 'AbortError');
    };

    const err = await clientWith()
      .chat({ messages: [{ role: 'user', content: 'hi' }] })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'LlmError', httpStatus: 504 });
  });

  describe('chatStream', () => {
    function sseResponse(chunks: string[]): Response {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }

    function tokenChunk(content: string): string {
      return `data: ${JSON.stringify({
        model: 'test-model',
        choices: [{ delta: { content } }],
      })}\n\n`;
    }

    it('sends stream:true, forwards tokens in order, returns assembled reply', async () => {
      const fetchMock = jest.fn(() =>
        Promise.resolve(
          sseResponse([
            tokenChunk('Hel'),
            tokenChunk('lo'),
            'data: [DONE]\n\n',
          ]),
        ),
      );
      global.fetch = fetchMock;
      const tokens: string[] = [];

      const result = await clientWith().chatStream(
        { messages: [{ role: 'user', content: 'hi' }] },
        { onToken: (token) => tokens.push(token) },
      );

      expect(result).toEqual({ content: 'Hello', model: 'test-model' });
      expect(tokens).toEqual(['Hel', 'lo']);
      const [, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(JSON.parse(init.body as string)).toMatchObject({
        model: 'test-model',
        stream: true,
      });
    });

    it('reassembles payloads split across chunk boundaries', async () => {
      global.fetch = () =>
        Promise.resolve(
          sseResponse([
            'data: {"model":"test-mo',
            'del","choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n',
          ]),
        );
      const tokens: string[] = [];

      const result = await clientWith().chatStream(
        { messages: [{ role: 'user', content: 'hi' }] },
        { onToken: (token) => tokens.push(token) },
      );

      expect(result.content).toBe('Hi');
      expect(tokens).toEqual(['Hi']);
    });

    it('ignores keep-alive comments and malformed lines', async () => {
      global.fetch = () =>
        Promise.resolve(
          sseResponse([
            ': ping\n\ndata: not-json\n\n' +
              tokenChunk('ok') +
              'data: [DONE]\n\n',
          ]),
        );

      const result = await clientWith().chatStream(
        { messages: [{ role: 'user', content: 'hi' }] },
        { onToken: () => {} },
      );

      expect(result.content).toBe('ok');
    });

    it('throws 502 on error status and on empty streams', async () => {
      global.fetch = () =>
        Promise.resolve(new Response('boom', { status: 500 }));
      await expect(
        clientWith().chatStream(
          { messages: [{ role: 'user', content: 'hi' }] },
          { onToken: () => {} },
        ),
      ).rejects.toMatchObject({ name: 'LlmError', httpStatus: 502 });

      global.fetch = () => Promise.resolve(sseResponse(['data: [DONE]\n\n']));
      await expect(
        clientWith().chatStream(
          { messages: [{ role: 'user', content: 'hi' }] },
          { onToken: () => {} },
        ),
      ).rejects.toMatchObject({ name: 'LlmError', httpStatus: 502 });
    });

    it('throws 504 when the request fails', async () => {
      global.fetch = (): Promise<Response> => {
        throw new DOMException('aborted', 'AbortError');
      };
      await expect(
        clientWith().chatStream(
          { messages: [{ role: 'user', content: 'hi' }] },
          { onToken: () => {} },
        ),
      ).rejects.toMatchObject({ name: 'LlmError', httpStatus: 504 });
    });
  });

  describe('provider session affinity', () => {
    function captureFetch() {
      const seen: RequestInit[] = [];
      global.fetch = (_url: unknown, init?: RequestInit) => {
        seen.push(init ?? {});
        return Promise.resolve(
          okResponse({ choices: [{ message: { content: 'x' } }] }),
        );
      };
      return seen;
    }

    const messages: ChatMessage[] = [{ role: 'user', content: 'hi' }];

    it('sends x-opencode-session for the opencode provider', async () => {
      const seen = captureFetch();
      const client = clientWith({ provider: 'opencode' });

      await client.chat({ messages, sessionId: 'session-a' });
      await client.chat({ messages, sessionId: 'session-a' });

      expect(seen).toHaveLength(2);
      expect(seen[0]?.headers).toMatchObject({
        'x-opencode-session': 'session-a',
      });
      // Stable across requests in the same conversation.
      expect(seen[1]?.headers).toMatchObject({
        'x-opencode-session': 'session-a',
      });
    });

    it('uses distinct session values for distinct conversations', async () => {
      const seen = captureFetch();
      const client = clientWith({ provider: 'opencode' });

      await client.chat({ messages, sessionId: 'session-a' });
      await client.chat({ messages, sessionId: 'session-b' });

      expect(seen[0]?.headers).toMatchObject({
        'x-opencode-session': 'session-a',
      });
      expect(seen[1]?.headers).toMatchObject({
        'x-opencode-session': 'session-b',
      });
    });

    it('matches the provider family case-insensitively', async () => {
      const seen = captureFetch();

      await clientWith({ provider: 'OpenCode' }).chat({
        messages,
        sessionId: 's',
      });
      expect(seen[0]?.headers).toMatchObject({ 'x-opencode-session': 's' });

      const zenSeen = captureFetch();
      await clientWith({ provider: 'opencode-zen' }).chat({
        messages,
        sessionId: 's',
      });
      expect(zenSeen[0]?.headers).toMatchObject({
        'x-opencode-session': 's',
      });
    });

    it('omits the session header without a session id', async () => {
      const seen = captureFetch();

      await clientWith({ provider: 'opencode' }).chat({ messages });

      expect(seen[0]?.headers).not.toHaveProperty('x-opencode-session');
    });

    it('never sends the session header for other providers', async () => {
      for (const provider of ['ollama', 'llama.cpp', 'openrouter', 'custom']) {
        const seen = captureFetch();

        await clientWith({ provider }).chat({ messages, sessionId: 's' });

        expect(seen[0]?.headers).not.toHaveProperty('x-opencode-session');
      }
    });

    it('sends the session header on streamed requests too', async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(tokenChunk('x') + 'data: [DONE]\n\n'),
          );
          controller.close();
        },
      });
      const seen: RequestInit[] = [];
      global.fetch = (_url: unknown, init?: RequestInit) => {
        seen.push(init ?? {});
        return Promise.resolve(
          new Response(stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        );
      };

      function tokenChunk(content: string): string {
        return `data: ${JSON.stringify({
          choices: [{ delta: { content } }],
        })}\n\n`;
      }

      await clientWith({ provider: 'opencode' }).chatStream(
        { messages, sessionId: 'session-a' },
        { onToken: () => {} },
      );

      expect(seen[0]?.headers).toMatchObject({
        'x-opencode-session': 'session-a',
      });
    });

    it('merges static headers, with explicit values winning', async () => {
      const seen = captureFetch();

      await clientWith({
        provider: 'openrouter',
        llmApiKey: 'secret',
        llmHeaders: {
          'HTTP-Referer': 'https://example.com',
          Authorization: 'Bearer override',
        },
      }).chat({ messages });

      expect(seen[0]?.headers).toMatchObject({
        'HTTP-Referer': 'https://example.com',
        Authorization: 'Bearer override',
      });
    });
  });
});
