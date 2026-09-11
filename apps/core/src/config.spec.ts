import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadConfig } from './config';

describe('loadConfig', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('applies defaults for optional values', () => {
    const config = loadConfig({ LLM_MODEL: 'llama3.1' });
    expect(config).toMatchObject({
      port: 3000,
      llmBaseUrl: 'http://localhost:11434/v1',
      llmModel: 'llama3.1',
      llmTimeoutMs: 60000,
      maxHistory: 50,
    });
    expect(config.llmApiKey).toBeUndefined();
  });

  it('strips trailing slashes from the base URL', () => {
    const config = loadConfig({
      LLM_MODEL: 'm',
      LLM_BASE_URL: 'http://x:8000/v1///',
    });
    expect(config.llmBaseUrl).toBe('http://x:8000/v1');
  });

  it('throws when LLM_MODEL is missing', () => {
    expect(() => loadConfig({})).toThrow(/LLM_MODEL is required/);
  });

  it('throws on non-positive integers', () => {
    expect(() => loadConfig({ LLM_MODEL: 'm', PORT: 'abc' })).toThrow(/PORT/);
  });

  it('defaults the split database paths under the home directory', () => {
    const config = loadConfig({ LLM_MODEL: 'm' });
    expect(config.sessionDbPath).toBe(
      join(homedir(), '.icos/data/sessions.db'),
    );
    expect(config.memoryDbPath).toBe(join(homedir(), '.icos/data/memories.db'));
    expect(config.legacyDbPath).toBe(
      resolve(process.cwd(), './data/core.sqlite'),
    );
  });

  it('resolves database path overrides absolutely', () => {
    const config = loadConfig({
      LLM_MODEL: 'm',
      SESSION_DB_PATH: './custom/s.sqlite',
      MEMORY_DB_PATH: './custom/m.sqlite',
      CORE_DB_PATH: './custom/legacy.sqlite',
    });
    expect(config.sessionDbPath).toBe(
      resolve(process.cwd(), './custom/s.sqlite'),
    );
    expect(config.memoryDbPath).toBe(
      resolve(process.cwd(), './custom/m.sqlite'),
    );
    expect(config.legacyDbPath).toBe(
      resolve(process.cwd(), './custom/legacy.sqlite'),
    );
  });

  it('defaults the provider to ollama and normalizes overrides', () => {
    expect(loadConfig({ LLM_MODEL: 'm' }).provider).toBe('ollama');
    expect(
      loadConfig({ LLM_MODEL: 'm', LLM_PROVIDER: 'OpenRouter' }).provider,
    ).toBe('openrouter');
  });

  it('parses static headers and rejects malformed values', () => {
    expect(loadConfig({ LLM_MODEL: 'm' }).llmHeaders).toBeUndefined();
    expect(
      loadConfig({
        LLM_MODEL: 'm',
        LLM_HEADERS: '{"HTTP-Referer":"https://example.com"}',
      }).llmHeaders,
    ).toEqual({ 'HTTP-Referer': 'https://example.com' });
    expect(() =>
      loadConfig({ LLM_MODEL: 'm', LLM_HEADERS: 'not-json' }),
    ).toThrow(/LLM_HEADERS/);
    expect(() =>
      loadConfig({ LLM_MODEL: 'm', LLM_HEADERS: '{"a":42}' }),
    ).toThrow(/LLM_HEADERS/);
  });

  it('leaves the User-Agent unset unless configured', () => {
    expect(loadConfig({ LLM_MODEL: 'm' }).userAgent).toBeUndefined();
    expect(
      loadConfig({ LLM_MODEL: 'm', LLM_USER_AGENT: 'my-agent/2.0' }).userAgent,
    ).toBe('my-agent/2.0');
  });

  it('mirrors provider, headers, and UA into the memory role by default', () => {
    const config = loadConfig({
      LLM_MODEL: 'm',
      LLM_PROVIDER: 'opencode',
      LLM_HEADERS: '{"X-Title":"t"}',
      LLM_USER_AGENT: 'my-agent/2.0',
    });
    expect(config.memoryProvider).toBe('opencode');
    expect(config.memoryLlmHeaders).toEqual({ 'X-Title': 't' });
    expect(config.memoryUserAgent).toBe('my-agent/2.0');

    const overridden = loadConfig({
      LLM_MODEL: 'm',
      LLM_PROVIDER: 'opencode',
      MEMORY_PROVIDER: 'ollama',
    });
    expect(overridden.memoryProvider).toBe('ollama');
  });
});
