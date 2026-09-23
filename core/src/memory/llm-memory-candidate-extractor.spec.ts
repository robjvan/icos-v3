import { LlmClient } from '../llm/llm.client';
import type { LlmChatRequest } from '../llm/llm-provider';
import { EXTRACTION_VERSION, buildExtractionPrompt } from './extraction.prompt';
import {
  ExtractionParseError,
  LlmMemoryCandidateExtractor,
} from './llm-memory-candidate-extractor';
import type { MemoryExtractionInput } from './memory-candidate-extractor';

const input: MemoryExtractionInput = {
  sessionId: 's1',
  userMessage: { role: 'user', content: 'I prefer TypeScript' },
  assistantMessage: { role: 'assistant', content: 'Noted!' },
  context: [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi' },
  ],
};

function extractorWith(
  response: string,
  onRequest?: (request: LlmChatRequest) => void,
) {
  const chat = jest.fn((request: LlmChatRequest) => {
    onRequest?.(request);
    return Promise.resolve({ content: response, model: 'm' });
  });
  const llm = { chat } as unknown as LlmClient;
  return { extractor: new LlmMemoryCandidateExtractor(llm), chat };
}

describe('buildExtractionPrompt', () => {
  it('includes the turn, bounded context, and schema instruction', () => {
    const prompt = buildExtractionPrompt(input);
    expect(prompt[0]?.role).toBe('system');
    const body = prompt[1]?.content ?? '';
    expect(body).toContain('I prefer TypeScript');
    expect(body).toContain('Noted!');
    expect(body).toContain('user: hello');
    expect(body).toContain('kind');
  });

  it('bounds prior context to the extraction window', () => {
    const long = {
      ...input,
      context: Array.from({ length: 20 }, (_, i) => ({
        role: 'user' as const,
        content: `old-${i}`,
      })),
    };
    const body = buildExtractionPrompt(long)[1]?.content ?? '';
    expect(body).not.toContain('old-0');
    expect(body).toContain('old-19');
  });
});

describe('LlmMemoryCandidateExtractor', () => {
  it('parses a bare JSON array', async () => {
    const { extractor, chat } = extractorWith(
      '[{"kind":"preference","subject":"user","predicate":"prefers","object":"TypeScript","confidence":0.9,"importance":0.7,"stability":0.8}]',
    );
    const candidates = await extractor.extract(input);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(candidates).toEqual([
      {
        kind: 'preference',
        subject: 'user',
        predicate: 'prefers',
        object: 'TypeScript',
        confidence: 0.9,
        importance: 0.7,
        stability: 0.8,
        sourceRole: 'unknown',
      },
    ]);
  });

  it('stamps the extractor-reported side, defaulting to unknown', async () => {
    const { extractor } = extractorWith(
      '[{"kind":"preference","subject":"user","predicate":"prefers","object":"Tea","confidence":0.9,"importance":0.7,"stability":0.8,"source":"user"},' +
        '{"kind":"fact","subject":"system","predicate":"runs_on","object":"Ollama","confidence":0.8,"importance":0.5,"stability":0.6,"source":"assistant"},' +
        '{"kind":"fact","subject":"x","predicate":"y","object":"z","confidence":0.8,"importance":0.5,"stability":0.6,"source":"nobody"}]',
    );
    const candidates = await extractor.extract(input);
    expect(candidates.map((c) => c.sourceRole)).toEqual([
      'user',
      'assistant',
      'unknown',
    ]);
  });

  it('parses envelope and chatty responses', async () => {
    const { extractor } = extractorWith(
      'Here are the candidates:\n{"candidates": [{"kind":"goal","subject":"user","predicate":"wants","object":"sleep","confidence":0.8,"importance":0.6,"stability":0.5}]}\nThat is all.',
    );
    expect(await extractor.extract(input)).toHaveLength(1);
  });

  it('returns [] for empty arrays and filters invalid entries', async () => {
    const { extractor } = extractorWith('[]');
    await expect(extractor.extract(input)).resolves.toEqual([]);

    const mixed = extractorWith(
      '[{"kind":"nope","subject":"","predicate":"","object":"","confidence":9,"importance":0,"stability":0}]',
    );
    await expect(mixed.extractor.extract(input)).resolves.toEqual([]);
  });

  it('throws a typed error on unparseable responses', async () => {
    const { extractor } = extractorWith('absolutely no json here');
    await expect(extractor.extract(input)).rejects.toBeInstanceOf(
      ExtractionParseError,
    );
  });

  it('propagates LLM failures to the caller', async () => {
    const llm = {
      chat: jest.fn(() => Promise.reject(new Error('down'))),
    } as unknown as LlmClient;
    const extractor = new LlmMemoryCandidateExtractor(llm);
    await expect(extractor.extract(input)).rejects.toThrow('down');
  });

  it('forwards the conversation session id to the LLM request', async () => {
    let seen: LlmChatRequest | undefined;
    const { extractor } = extractorWith('[]', (request) => {
      seen = request;
    });
    await extractor.extract(input);
    expect(seen?.sessionId).toBe('s1');
    expect(seen?.messages.length).toBeGreaterThan(0);
  });

  it('records the extraction version constant', () => {
    expect(EXTRACTION_VERSION).toBe('memory-extraction-v2');
  });
});
