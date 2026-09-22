import { ToolRegistry } from '../tools/tool-registry';
import { LlmClient, LlmError } from './llm.client';
import type { LlmMessage, LlmToolRequest } from './llm.protocol';

const tools = new ToolRegistry().list();
const request: LlmToolRequest = {
  messages: [{ role: 'user', content: 'find it' }],
  tools,
};
const client = (
  llmBaseUrl = 'http://localhost:11434/v1',
  llmTimeoutMs = 1000,
) =>
  new LlmClient({
    provider: 'custom',
    llmBaseUrl,
    llmModel: 'muse-test',
    llmTimeoutMs,
  });
const call = (
  id = 'c1',
  name = 'session_search',
  args = '{"query":"hello"}',
) => ({
  id,
  type: 'function',
  function: { name, arguments: args },
});
const completion = (
  calls: unknown = [call()],
  content: unknown = null,
  finish: unknown = 'tool_calls',
) => ({
  model: 'upstream',
  choices: [
    {
      message: { role: 'assistant', content, tool_calls: calls },
      finish_reason: finish,
    },
  ],
});
const event = (delta: unknown, finish: unknown = null) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
const first = (
  index = 0,
  id = 'c1',
  name = 'session_search',
  args = '{"query":',
) => ({
  index,
  ...call(id, name, args),
});
const last = (index = 0, args = '"hello"}') => ({
  index,
  function: { arguments: args },
});
const done = 'data: [DONE]\n\n';
const finish = event({}, 'tool_calls');
const streamText =
  event({ tool_calls: [first()] }) +
  event({ tool_calls: [last()] }) +
  finish +
  done;

function respond(value: unknown) {
  const mock = jest.fn(() =>
    Promise.resolve(new Response(JSON.stringify(value))),
  );
  global.fetch = mock;
  return mock;
}

function stream(text: string, bytewise = false, close = true) {
  const cancel = jest.fn();
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      if (bytewise) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      } else {
        controller.enqueue(bytes);
      }
      if (close) controller.close();
    },
    cancel,
  });
  global.fetch = jest.fn(() => Promise.resolve(new Response(body)));
  return { body, cancel };
}

async function rejected(promise: Promise<unknown>) {
  const error: unknown = await promise.catch((err: unknown) => err);
  expect(error).toBeInstanceOf(LlmError);
  expect(error).toMatchObject({ httpStatus: 502, cause: undefined });
  expect((error as Error).message).not.toMatch(/hello|secret|SyntaxError/);
}

describe('M8b tool protocol', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it.each([
    ['http://localhost:11434/v1', 'http://localhost:11434/v1/chat/completions'],
    [
      'http://localhost:11434/v1/',
      'http://localhost:11434/v1/chat/completions',
    ],
    [
      'http://localhost:11434/v1/chat/completions/',
      'http://localhost:11434/v1/chat/completions',
    ],
    [
      'http://localhost:11434/v1/chat/completions?key=x',
      'http://localhost:11434/v1/chat/completions?key=x',
    ],
    [
      'http://localhost:11434/v1/?key=x',
      'http://localhost:11434/v1/chat/completions?key=x',
    ],
  ])('normalizes %s without model-specific routing', (base, expected) => {
    expect(client(base).buildUrl()).toBe(expected);
  });

  it('offers canonical schemas through explicit aliases and preserves raw unvalidated args', async () => {
    const raw =
      '{"query":9,"sessionId":"other","version":99,"approval":"none","extra":true}';
    const mock = respond(completion([call('c1', 'session_rename', raw)]));
    expect(await client().chatWithTools(request)).toEqual({
      kind: 'tool_calls',
      content: null,
      model: 'upstream',
      toolCalls: [
        {
          id: 'c1',
          name: 'session.rename',
          version: 1,
          rawArguments: raw,
          args: JSON.parse(raw) as unknown,
        },
      ],
    });
    const [, init] = mock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'muse-test',
      messages: request.messages,
      stream: false,
      tool_choice: 'auto',
      tools: tools.map((tool) => ({
        type: 'function',
        function: {
          name:
            tool.name === 'session.search'
              ? 'session_search'
              : 'session_rename',
          description: tool.description,
          parameters: tool.argsSchema,
        },
      })),
    });
    expect(tools[1].approval).toBe('required');
  });

  it.each([null, 'I will search'])(
    'returns tool-only or mixed content (%s)',
    async (content) => {
      respond(completion([call()], content));
      expect(await client().chatWithTools(request)).toMatchObject({
        kind: 'tool_calls',
        content,
      });
    },
  );

  it('returns discriminated text and serializes assistant/result pairing', async () => {
    respond(completion());
    const result = await client().chatWithTools(request);
    if (result.kind !== 'tool_calls') throw new Error('expected calls');
    const messages: LlmMessage[] = [
      ...request.messages,
      {
        role: 'assistant',
        content: result.content,
        toolCalls: result.toolCalls,
      },
      { role: 'tool', callId: 'c1', content: '{"matches":[]}' },
    ];
    const mock = respond({
      choices: [
        {
          message: { role: 'assistant', content: ' Done ' },
          finish_reason: 'stop',
        },
      ],
    });
    expect(await client().chatWithTools({ ...request, messages })).toEqual({
      kind: 'text',
      content: 'Done',
      model: 'muse-test',
    });
    const [, init] = mock.mock.calls[0] as unknown as [string, RequestInit];
    expect(
      (JSON.parse(init.body as string) as { messages: unknown }).messages,
    ).toEqual([
      ...request.messages,
      { role: 'assistant', content: null, tool_calls: [call()] },
      { role: 'tool', tool_call_id: 'c1', content: '{"matches":[]}' },
    ]);
  });

  it.each(['legacy', 'offered', 'none'] as const)(
    'accepts empty tool_calls as absent in complete and stream %s mode',
    async (mode) => {
      const toolRequest = {
        ...request,
        toolChoice: mode === 'none' ? ('none' as const) : ('auto' as const),
      };
      respond(completion([], 'hello', 'stop'));
      const result =
        mode === 'legacy'
          ? await client().chat({ messages: [] })
          : await client().chatWithTools(toolRequest);
      expect(result).toEqual({
        ...(mode === 'legacy' ? {} : { kind: 'text' }),
        content: 'hello',
        model: 'upstream',
      });
      stream(
        event({ content: 'hello', tool_calls: [] }) + event({}, 'stop') + done,
      );
      const onToken = jest.fn();
      const streamed =
        mode === 'legacy'
          ? await client().chatStream({ messages: [] }, { onToken })
          : await client().chatStreamWithTools(toolRequest, { onToken });
      expect(streamed).toEqual({
        ...(mode === 'legacy' ? {} : { kind: 'text' }),
        content: 'hello',
        model: 'muse-test',
      });
      expect(onToken.mock.calls).toEqual([['hello']]);
    },
  );

  it('rejects sink abort before publishing a buffered mixed tool result', async () => {
    const controller = new AbortController();
    const { body, cancel } = stream(
      event({
        content: 'Searching',
        tool_calls: [first(0, 'c1', 'session_search', '{}')],
      }) +
        finish +
        done,
      false,
      false,
    );
    const onToken = jest.fn(() => controller.abort());
    const onResult = jest.fn();
    const result = client()
      .chatStreamWithTools(request, { onToken }, controller.signal)
      .then(onResult);
    await expect(result).rejects.toMatchObject({
      name: 'LlmError',
      httpStatus: 504,
      retryable: false,
      cause: undefined,
    });
    expect(onToken.mock.calls).toEqual([['Searching']]);
    expect(onResult).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  it('rejects orphan results before transport', async () => {
    const mock = respond(completion());
    await expect(
      client().chatWithTools({
        ...request,
        messages: [{ role: 'tool', callId: 'absent', content: 'x' }],
      }),
    ).rejects.toThrow();
    expect(mock).not.toHaveBeenCalled();
  });

  it('honors explicit none and request-local offers', async () => {
    const mock = respond(completion());
    await rejected(client().chatWithTools({ ...request, toolChoice: 'none' }));
    const [, init] = mock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toHaveProperty(
      'tool_choice',
      'none',
    );
    respond(completion([call('c1', 'session_rename')]));
    await rejected(client().chatWithTools({ ...request, tools: [tools[0]] }));
    respond(completion());
    await rejected(client().chatWithTools({ ...request, tools: [] }));
  });

  it.each([
    null,
    [],
    {},
    { choices: [] },
    { choices: [null] },
    completion([call()], 4),
    completion([call()], null, 'length'),
    completion([call()], null, 'stop'),
    completion([call()], null, null),
    completion([]),
    completion({}),
    completion([null]),
    completion([call(), call()]),
    completion([call('')]),
    completion([call('c1', 'session.search')]),
    completion([call('c1', 'unoffered')]),
    completion([call('c1', 'session_search', '{secret')]),
    completion([call('c1', 'session_search', 'null')]),
    completion([call('c1', 'session_search', '[]')]),
    completion([call('c1', 'session_search', '1')]),
    completion([
      { id: 'c1', function: { name: 'session_search', arguments: '{}' } },
    ]),
    completion([
      { ...call(), function: { name: 'session_search', arguments: {} } },
    ]),
    completion([call('x'.repeat(129))]),
    completion([call('c1', 'x'.repeat(129))]),
  ])(
    'rejects invalid completion %# atomically without leaking details',
    async (value) => {
      respond(value);
      await rejected(client().chatWithTools(request));
    },
  );

  it('sanitizes malformed JSON and upstream error bodies', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(new Response('secret bad json')),
    );
    await rejected(client().chatWithTools(request));
    global.fetch = jest.fn(() =>
      Promise.resolve(new Response('secret', { status: 500 })),
    );
    await rejected(client().chatWithTools(request));
  });

  it('bounds complete call count and UTF8 argument bytes', async () => {
    respond(completion(Array.from({ length: 9 }, (_, i) => call(`c${i}`))));
    await rejected(client().chatWithTools(request));
    respond(
      completion([
        call(
          'c1',
          'session_search',
          JSON.stringify({ query: 'é'.repeat(32768) }),
        ),
      ]),
    );
    await rejected(client().chatWithTools(request));
    respond(
      completion(
        Array.from({ length: 5 }, (_, i) =>
          call(
            `c${i}`,
            'session_search',
            JSON.stringify({ query: 'x'.repeat(60000) }),
          ),
        ),
      ),
    );
    await rejected(client().chatWithTools(request));
    respond(completion(Array.from({ length: 8 }, (_, i) => call(`c${i}`))));
    expect(await client().chatWithTools(request)).toMatchObject({
      kind: 'tool_calls',
      toolCalls: expect.any(Array) as unknown,
    });
  });

  it('assembles interleaved calls across UTF8 byte splits with only text tokens', async () => {
    const { body } = stream(
      event({ role: 'assistant', content: 'Searching é' }) +
        event({ tool_calls: [first(1, 'b', 'session_rename', '{"title":')] }) +
        event({ tool_calls: [first(0, 'a')] }) +
        event({ tool_calls: [last(1, '"café"}'), last(0)] }) +
        finish +
        done,
      true,
    );
    const onToken = jest.fn();
    const result = await client().chatStreamWithTools(request, { onToken });
    expect(result).toEqual({
      kind: 'tool_calls',
      content: 'Searching é',
      model: 'muse-test',
      toolCalls: [
        {
          id: 'a',
          name: 'session.search',
          version: 1,
          rawArguments: '{"query":"hello"}',
          args: { query: 'hello' },
        },
        {
          id: 'b',
          name: 'session.rename',
          version: 1,
          rawArguments: '{"title":"café"}',
          args: { title: 'café' },
        },
      ],
    });
    expect(onToken.mock.calls).toEqual([['Searching é']]);
    expect(body.locked).toBe(false);
  });

  it('streams tool-only and text-only results with the shared request body', async () => {
    stream(streamText);
    const onToken = jest.fn();
    expect(
      await client().chatStreamWithTools(request, { onToken }),
    ).toMatchObject({ kind: 'tool_calls', content: null });
    expect(onToken).not.toHaveBeenCalled();
    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(init.body as string)).toMatchObject({
      stream: true,
      tool_choice: 'auto',
    });
    stream(event({ content: 'Hi' }) + event({}, 'stop') + done);
    expect(await client().chatStreamWithTools(request, { onToken })).toEqual({
      kind: 'text',
      content: 'Hi',
      model: 'muse-test',
    });
  });

  it.each([
    event({ tool_calls: [first()] }) + event({ tool_calls: [last()] }) + done,
    event({ tool_calls: [first()] }) + event({ tool_calls: [last()] }) + finish,
    event({ tool_calls: [first()] }) +
      event({ tool_calls: [last()] }, 'length') +
      done,
    event({ tool_calls: [first()] }) +
      event({ tool_calls: [last()] }, 'stop') +
      done,
    event({ tool_calls: [first()] }) + finish + done,
    event({
      tool_calls: [
        first(0, 'c1', 'session_search', '{}'),
        first(1, 'c1', 'session_search', '{}'),
      ],
    }) +
      finish +
      done,
    event({ tool_calls: [last(0, '{}')] }) + finish + done,
    event({ tool_calls: [first(-1)] }) + finish + done,
    event({ tool_calls: [first(8)] }) + finish + done,
    event({ tool_calls: [first(0.5)] }) + finish + done,
    event({ tool_calls: [{ ...first(), index: '0' }] }) + finish + done,
    event({ tool_calls: [first(1)] }) +
      event({ tool_calls: [last(1)] }) +
      finish +
      done,
    event({ tool_calls: [first(0, 'c1', 'unoffered', '{}')] }) + finish + done,
    event({ tool_calls: [first(0, 'c1', 'session_search', '[]')] }) +
      finish +
      done,
    event({
      tool_calls: [
        { ...first(), function: { name: 'session_search', arguments: {} } },
      ],
    }) +
      finish +
      done,
    event({ tool_calls: [first(0, 'x'.repeat(129))] }) + finish + done,
    event({ tool_calls: [null] }) + done,
    event({ tool_calls: {} }) + done,
    event({ content: {} }) + done,
    event(null) + done,
    'data: null\n\n' + done,
    'data: {"choices":{}}\n\n' + done,
    'data: not-json-secret\n\n' + done,
    streamText.replace(finish, finish + event({ content: 'after finish' })),
    event({ tool_calls: [first(0, 'c1', 'session_search', '{}')] }) +
      finish +
      'data: broken\n\n' +
      done,
  ])(
    'rejects invalid stream %# without exposing partial calls',
    async (text) => {
      const { body } = stream(text);
      const onToken = jest.fn();
      await rejected(client().chatStreamWithTools(request, { onToken }));
      expect(onToken).not.toHaveBeenCalled();
      expect(body.locked).toBe(false);
    },
  );

  it('rejects streamed calls for explicit none and unoffered tools', async () => {
    stream(streamText);
    await rejected(
      client().chatStreamWithTools(
        { ...request, toolChoice: 'none' },
        { onToken: jest.fn() },
      ),
    );
    stream(streamText);
    await rejected(
      client().chatStreamWithTools(
        { ...request, tools: [] },
        { onToken: jest.fn() },
      ),
    );
  });

  it('bounds streamed argument accumulation and SSE lines', async () => {
    stream(
      event({ tool_calls: [first(0, 'c1', 'session_search', '{"query":"')] }) +
        event({ tool_calls: [last(0, 'x'.repeat(40000))] }) +
        event({ tool_calls: [last(0, 'x'.repeat(40000) + '"}')] }) +
        finish +
        done,
    );
    await rejected(
      client().chatStreamWithTools(request, { onToken: jest.fn() }),
    );
    stream(
      Array.from({ length: 5 }, (_, i) =>
        event({
          tool_calls: [
            first(
              i,
              `c${i}`,
              'session_search',
              JSON.stringify({ query: 'x'.repeat(60000) }),
            ),
          ],
        }),
      ).join('') +
        finish +
        done,
    );
    await rejected(
      client().chatStreamWithTools(request, { onToken: jest.fn() }),
    );
    stream('data: ' + ' '.repeat(128 * 1024));
    await rejected(
      client().chatStreamWithTools(request, { onToken: jest.fn() }),
    );
  });

  it('cancels and releases on DONE and malformed data without waiting for EOF', async () => {
    for (const text of [streamText, 'data: bad\n\n']) {
      const { body, cancel } = stream(text, false, false);
      await client()
        .chatStreamWithTools(request, { onToken: jest.fn() })
        .catch(() => undefined);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(body.locked).toBe(false);
    }
  });

  it('handles pre-aborted signals without fetching for both streaming APIs', async () => {
    const controller = new AbortController();
    controller.abort();
    const mock = respond(completion());
    await expect(
      client().chatStreamWithTools(
        request,
        { onToken: jest.fn() },
        controller.signal,
      ),
    ).rejects.toMatchObject({ httpStatus: 504 });
    await expect(
      client().chatStream(
        { messages: [] },
        { onToken: jest.fn() },
        controller.signal,
      ),
    ).rejects.toMatchObject({ httpStatus: 504 });
    await expect(
      client().chatWithTools(request, controller.signal),
    ).rejects.toMatchObject({ httpStatus: 504 });
    expect(mock).not.toHaveBeenCalled();
  });

  it.each(['abort', 'timeout'])(
    'cancels a stalled reader on %s',
    async (mode) => {
      jest.useFakeTimers();
      const controller = new AbortController();
      const { body, cancel } = stream(
        event({ tool_calls: [first()] }),
        false,
        false,
      );
      const result = client(undefined, 20).chatStreamWithTools(
        request,
        { onToken: jest.fn() },
        controller.signal,
      );
      const assertion = expect(result).rejects.toMatchObject({
        httpStatus: 504,
        retryable: mode === 'timeout',
      });
      await jest.advanceTimersByTimeAsync(0);
      if (mode === 'abort') controller.abort();
      else await jest.advanceTimersByTimeAsync(20);
      await assertion;
      expect(cancel).toHaveBeenCalled();
      expect(body.locked).toBe(false);
    },
  );

  it('preserves exact argument limits for complete and streamed calls', async () => {
    const raw = JSON.stringify({ query: '' });
    const args = JSON.stringify({
      query: 'x'.repeat(64 * 1024 - Buffer.byteLength(raw)),
    });
    const calls = Array.from({ length: 4 }, (_, i) =>
      call(`c${i}`, 'session_search', args),
    );
    respond(completion(calls));
    const complete = await client().chatWithTools(request);
    expect(complete.kind).toBe('tool_calls');
    stream(
      calls
        .map((value, index) => event({ tool_calls: [{ ...value, index }] }))
        .join('') +
        finish +
        done,
    );
    expect(
      await client().chatStreamWithTools(request, { onToken: jest.fn() }),
    ).toEqual({ ...complete, model: 'muse-test' });
  });

  it('keeps alias authority isolated across concurrent requests', async () => {
    respond(completion());
    const [allowed, denied] = await Promise.allSettled([
      client().chatWithTools(request),
      client().chatWithTools({ ...request, tools: [tools[1]] }),
    ]);
    expect(allowed.status).toBe('fulfilled');
    expect(denied.status).toBe('rejected');
  });

  it('requires one result for every preceding call before another message', async () => {
    respond(completion());
    const result = await client().chatWithTools(request);
    if (result.kind !== 'tool_calls') throw new Error('expected calls');
    const assistant: LlmMessage = {
      role: 'assistant',
      content: null,
      toolCalls: result.toolCalls,
    };
    const toolResult: LlmMessage = {
      role: 'tool',
      callId: 'c1',
      content: 'done',
    };
    const invalid: LlmMessage[][] = [
      [assistant],
      [assistant, { role: 'user', content: 'next' }, toolResult],
      [assistant, toolResult, toolResult],
      [assistant, { ...toolResult, callId: 'wrong' }],
    ];
    const mock = respond(completion());
    for (const messages of invalid)
      await rejected(client().chatWithTools({ ...request, messages }));
    expect(mock).not.toHaveBeenCalled();
  });

  it.each([
    { choices: [{ message: { content: 'hello' }, finish_reason: 'length' }] },
    { ...completion(), model: {} },
    { ...completion(), model: 'x'.repeat(129) },
    { choices: [{ message: null, finish_reason: 'tool_calls' }] },
    {
      choices: [
        { message: { role: 'tool', content: 'hello' }, finish_reason: 'stop' },
      ],
    },
    completion([{ ...call(), function: { name: 'session_search' } }]),
    completion([{ ...call(), type: 'other' }]),
    completion([call('c1'), call('c2', 'session_search', '{secret')]),
  ])('rejects additional complete shape errors %#', async (value) => {
    respond(value);
    await rejected(client().chatWithTools(request));
  });

  it.each([
    'data: {"model":{},"choices":[{"delta":{}}]}\n\n',
    'data: {"choices":[null]}\n\n',
    event({ tool_calls: [first()] }) +
      event({ tool_calls: [first()] }) +
      finish +
      done,
    event({ tool_calls: [first()] }) +
      event({ tool_calls: [{ index: 0, type: 'other' }] }) +
      finish +
      done,
    event({ tool_calls: [first()] }) +
      event({ tool_calls: [{ index: 0, function: null }] }) +
      finish +
      done,
    event({ tool_calls: [first()] }) +
      event({ tool_calls: [last(0, 'null')] }) +
      finish +
      done,
    event({}, 'tool_calls') + done,
    event({ content: 'hello' }, 'length') + done,
  ])('rejects additional streamed shape errors %#', async (value) => {
    stream(value);
    await rejected(
      client().chatStreamWithTools(request, { onToken: jest.fn() }),
    );
  });

  it('accepts usage-only chunks after finish and SSE comments', async () => {
    stream(
      ': ping\n\n' +
        streamText.replace(
          done,
          'data: {"choices":[],"usage":{"total_tokens":2}}\n\n' + done,
        ),
    );
    expect(
      await client().chatStreamWithTools(request, { onToken: jest.fn() }),
    ).toMatchObject({ kind: 'tool_calls' });
  });

  it('accepts gateway usage echoes of the terminal choice', async () => {
    // OpenRouter appends a usage chunk repeating the terminal delta.
    const echo = (finishReason: string) =>
      `data: ${JSON.stringify({
        choices: [
          {
            index: 0,
            delta: { content: '', role: 'assistant' },
            finish_reason: finishReason,
          },
        ],
        usage: { total_tokens: 2 },
      })}\n\n`;
    stream(event({ content: 'Hi' }) + event({}, 'stop') + echo('stop') + done);
    const onToken = jest.fn();
    expect(await client().chatStreamWithTools(request, { onToken })).toEqual({
      kind: 'text',
      content: 'Hi',
      model: 'muse-test',
    });
    expect(onToken.mock.calls).toEqual([['Hi']]);
    stream(streamText.replace(done, echo('tool_calls') + done));
    expect(
      await client().chatStreamWithTools(request, { onToken: jest.fn() }),
    ).toMatchObject({ kind: 'tool_calls' });
  });

  it('still rejects post-finish echoes that add payload', async () => {
    const echo = (delta: unknown, finishReason: unknown) =>
      `data: ${JSON.stringify({
        choices: [{ index: 0, delta, finish_reason: finishReason }],
        usage: { total_tokens: 2 },
      })}\n\n`;
    for (const text of [
      event({ content: 'Hi' }) +
        event({}, 'stop') +
        echo({ content: 'again' }, 'stop') +
        done,
      event({ content: 'Hi' }) +
        event({}, 'stop') +
        echo({ content: '' }, 'length') +
        done,
      streamText.replace(
        done,
        echo({ tool_calls: [first()] }, 'tool_calls') + done,
      ),
    ]) {
      stream(text);
      await rejected(
        client().chatStreamWithTools(request, { onToken: jest.fn() }),
      );
    }
  });

  it.each(['abort', 'timeout'])(
    'cancels a non-stream response body on %s',
    async (mode) => {
      jest.useFakeTimers();
      const controller = new AbortController();
      const { body, cancel } = stream('{', false, false);
      const result = client(undefined, 20).chatWithTools(
        request,
        controller.signal,
      );
      const assertion = expect(result).rejects.toMatchObject({
        httpStatus: 504,
        retryable: mode === 'timeout',
        cause: undefined,
      });
      await jest.advanceTimersByTimeAsync(0);
      if (mode === 'abort') controller.abort();
      else await jest.advanceTimersByTimeAsync(20);
      await assertion;
      expect(cancel).toHaveBeenCalled();
      expect(body.locked).toBe(false);
    },
  );

  it('aborts fetch on timeout without returning parser causes', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new Error('secret')),
            { once: true },
          );
        }),
    );
    const result = client(undefined, 20).chatWithTools(request);
    const assertion = expect(result).rejects.toMatchObject({
      httpStatus: 504,
      retryable: true,
      cause: undefined,
    });
    await jest.advanceTimersByTimeAsync(20);
    await assertion;
  });

  it('legacy calls reject unexpected calls even alongside text', async () => {
    respond(completion([call()], 'hello'));
    await rejected(client().chat({ messages: [] }));
    stream(event({ content: 'hello', tool_calls: [first()] }) + done);
    const onToken = jest.fn();
    await rejected(client().chatStream({ messages: [] }, { onToken }));
    expect(onToken).not.toHaveBeenCalled();
  });
});
