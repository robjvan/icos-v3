import type { CoreConfig } from '../config';
import { FakeSessionRepository } from './fake-session.repository';
import { SessionStore } from './session.store';

function makeStore(maxHistory = 50): {
  store: SessionStore;
  repository: FakeSessionRepository;
} {
  const config: CoreConfig = {
    port: 3000,
    llmBaseUrl: 'http://localhost:11434/v1',
    llmModel: 'm',
    llmTimeoutMs: 1000,
    systemPrompt: 'sys',
    maxHistory,
    sessionDbPath: ':memory:',
    memoryDbPath: ':memory:',
    legacyDbPath: '/tmp/icos-test-legacy-missing.sqlite',
    memoryExtractionEnabled: false,
    memoryLlmBaseUrl: 'http://localhost:11434/v1',
    memoryLlmModel: 'm',
    memoryLlmTimeoutMs: 1000,
  };
  const repository = new FakeSessionRepository();
  return { store: new SessionStore(repository, config), repository };
}

describe('SessionStore', () => {
  it('creates a new session when no id is given', async () => {
    const { store, repository } = makeStore();
    const first = await store.resolve();
    const second = await store.resolve();
    expect(first.isNew).toBe(true);
    expect(first.id).not.toBe(second.id);
    expect(await repository.getSession(first.id)).not.toBeNull();
  });

  it('resolves an existing session without resetting history', async () => {
    const { store } = makeStore();
    const { id } = await store.resolve();
    await store.append(id, { role: 'user', content: 'hi' });
    expect(await store.resolve(id)).toEqual({ id, isNew: false });
    expect(await store.getHistory(id)).toHaveLength(1);
  });

  it('adopts a caller-provided id when unknown', async () => {
    const { store } = makeStore();
    expect(await store.resolve('custom-id')).toEqual({
      id: 'custom-id',
      isNew: true,
    });
  });

  it('bounds context messages to maxHistory but keeps full history', async () => {
    const { store } = makeStore(3);
    const { id } = await store.resolve();
    for (let i = 0; i < 5; i++) {
      await store.append(id, { role: 'user', content: `m${i}` });
    }
    expect((await store.getContextMessages(id)).map((m) => m.content)).toEqual([
      'm2',
      'm3',
      'm4',
    ]);
    expect(await store.getHistory(id)).toHaveLength(5);
  });

  it('returns undefined history for unknown sessions', async () => {
    const { store } = makeStore();
    await expect(store.getHistory('nope')).resolves.toBeUndefined();
  });
});
