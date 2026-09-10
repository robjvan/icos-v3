import { CoreConfig } from '../config';
import { SessionStore } from './session.store';

function makeStore(maxHistory = 50): SessionStore {
  const config: CoreConfig = {
    port: 3000,
    llmBaseUrl: 'http://localhost:11434/v1',
    llmModel: 'm',
    llmTimeoutMs: 1000,
    systemPrompt: 'sys',
    maxHistory,
  };
  return new SessionStore(config);
}

describe('SessionStore', () => {
  it('creates a new session when no id is given', () => {
    const store = makeStore();
    const first = store.resolve();
    const second = store.resolve();
    expect(first.isNew).toBe(true);
    expect(first.id).not.toBe(second.id);
    expect(store.get(first.id)).toEqual([]);
  });

  it('resolves an existing session without resetting history', () => {
    const store = makeStore();
    const { id } = store.resolve();
    store.append(id, { role: 'user', content: 'hi' });
    expect(store.resolve(id).isNew).toBe(false);
    expect(store.get(id)).toHaveLength(1);
  });

  it('adopts a caller-provided id when unknown', () => {
    const store = makeStore();
    expect(store.resolve('custom-id')).toEqual({
      id: 'custom-id',
      isNew: true,
    });
  });

  it('trims history to maxHistory', () => {
    const store = makeStore(3);
    const { id } = store.resolve();
    for (let i = 0; i < 5; i++) {
      store.append(id, { role: 'user', content: `m${i}` });
    }
    expect(store.get(id)?.map((m) => m.content)).toEqual(['m2', 'm3', 'm4']);
  });

  it('returns undefined for unknown sessions', () => {
    expect(makeStore().get('nope')).toBeUndefined();
  });
});
