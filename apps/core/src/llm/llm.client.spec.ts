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
});
