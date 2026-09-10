import { ChatMessage, LlmClient } from './llm.client';
import { CoreConfig } from '../config';

const baseConfig: CoreConfig = {
  port: 3000,
  llmBaseUrl: 'http://localhost:11434/v1',
  llmModel: 'test-model',
  llmTimeoutMs: 1000,
  systemPrompt: 'sys',
  maxHistory: 50,
};

function clientWith(overrides: Partial<CoreConfig> = {}): LlmClient {
  return new LlmClient({ ...baseConfig, ...overrides });
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

  it('POSTs model + messages to {baseUrl}/chat/completions and returns content', async () => {
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

    const result = await clientWith().chat(messages);

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

    await clientWith().chat([{ role: 'user', content: 'hi' }]);
    expect(seen[0]?.headers).not.toHaveProperty('Authorization');

    await clientWith({ llmApiKey: 'secret' }).chat([
      { role: 'user', content: 'hi' },
    ]);
    expect(seen[1]?.headers).toMatchObject({
      Authorization: 'Bearer secret',
    });
  });

  it('throws 502 when the endpoint returns an error status', async () => {
    global.fetch = () => Promise.resolve(new Response('boom', { status: 500 }));

    const err = await clientWith()
      .chat([{ role: 'user', content: 'hi' }])
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'LlmError', httpStatus: 502 });
  });

  it('throws 502 when choices are empty', async () => {
    global.fetch = () => Promise.resolve(okResponse({ choices: [] }));

    const err = await clientWith()
      .chat([{ role: 'user', content: 'hi' }])
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'LlmError', httpStatus: 502 });
  });

  it('throws 504 when the request fails (network error / abort)', async () => {
    global.fetch = (): Promise<Response> => {
      throw new DOMException('aborted', 'AbortError');
    };

    const err = await clientWith()
      .chat([{ role: 'user', content: 'hi' }])
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
        [{ role: 'user', content: 'hi' }],
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
        [{ role: 'user', content: 'hi' }],
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
        [{ role: 'user', content: 'hi' }],
        { onToken: () => {} },
      );

      expect(result.content).toBe('ok');
    });

    it('throws 502 on error status and on empty streams', async () => {
      global.fetch = () =>
        Promise.resolve(new Response('boom', { status: 500 }));
      await expect(
        clientWith().chatStream([{ role: 'user', content: 'hi' }], {
          onToken: () => {},
        }),
      ).rejects.toMatchObject({ name: 'LlmError', httpStatus: 502 });

      global.fetch = () => Promise.resolve(sseResponse(['data: [DONE]\n\n']));
      await expect(
        clientWith().chatStream([{ role: 'user', content: 'hi' }], {
          onToken: () => {},
        }),
      ).rejects.toMatchObject({ name: 'LlmError', httpStatus: 502 });
    });

    it('throws 504 when the request fails', async () => {
      global.fetch = (): Promise<Response> => {
        throw new DOMException('aborted', 'AbortError');
      };
      await expect(
        clientWith().chatStream([{ role: 'user', content: 'hi' }], {
          onToken: () => {},
        }),
      ).rejects.toMatchObject({ name: 'LlmError', httpStatus: 504 });
    });
  });
});
