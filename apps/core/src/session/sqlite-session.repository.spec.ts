import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { CoreConfig } from '../config';
import { SqliteSessionRepository } from './sqlite-session.repository';

function testConfig(dbPath: string): CoreConfig {
  return {
    port: 3000,
    llmBaseUrl: 'http://localhost:11434/v1',
    llmModel: 'm',
    llmTimeoutMs: 1000,
    systemPrompt: 'sys',
    maxHistory: 50,
    dbPath,
  };
}

describe('SqliteSessionRepository', () => {
  let dir = '';
  let repo: SqliteSessionRepository | null = null;

  const openRepo = (name = 'core.sqlite'): SqliteSessionRepository => {
    const instance = new SqliteSessionRepository(testConfig(join(dir, name)));
    instance.onModuleInit();
    repo = instance;
    return instance;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-repo-'));
  });

  afterEach(() => {
    repo?.onModuleDestroy();
    repo = null;
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates sessions and reads messages back in order', async () => {
    const repository = openRepo();
    await repository.createSession('s1');
    await repository.appendMessage('s1', { role: 'user', content: 'a' });
    await repository.appendMessage('s1', { role: 'assistant', content: 'b' });
    await repository.appendMessage('s1', { role: 'user', content: 'c' });

    expect(await repository.getSession('s1')).toMatchObject({ id: 's1' });
    expect(await repository.getSession('missing')).toBeNull();
    expect(await repository.getMessages('s1')).toEqual([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ]);
  });

  it('keeps sessions isolated', async () => {
    const repository = openRepo();
    await repository.createSession('s1');
    await repository.createSession('s2');
    await repository.appendMessage('s1', { role: 'user', content: 'one' });
    await repository.appendMessage('s2', { role: 'user', content: 'two' });

    expect(await repository.getMessages('s1')).toEqual([
      { role: 'user', content: 'one' },
    ]);
    expect(await repository.getMessages('s2')).toEqual([
      { role: 'user', content: 'two' },
    ]);
  });

  it('supports limit and beforeId cursors', async () => {
    const repository = openRepo();
    await repository.createSession('s1');
    for (let i = 0; i < 5; i++) {
      await repository.appendMessage('s1', {
        role: 'user',
        content: `m${i}`,
      });
    }

    expect(
      (await repository.getMessages('s1', { limit: 2 })).map((m) => m.content),
    ).toEqual(['m3', 'm4']);
    expect(
      (await repository.getMessages('s1', { limit: 2, beforeId: 4 })).map(
        (m) => m.content,
      ),
    ).toEqual(['m1', 'm2']);
  });

  it('rejects unsupported roles', async () => {
    const repository = openRepo();
    await repository.createSession('s1');
    await expect(
      repository.appendMessage('s1', {
        role: 'system',
        content: 'x',
      } as never),
    ).rejects.toThrow(/role/);
  });

  it('lists sessions newest-first with counts and previews', async () => {
    const repository = openRepo();
    await repository.createSession('s1');
    await repository.appendMessage('s1', {
      role: 'user',
      content: 'first session opener',
    });
    await repository.appendMessage('s1', {
      role: 'assistant',
      content: 'reply',
    });
    await repository.createSession('s2');
    // Touch s1 again so it sorts first despite s2 being newer.
    await repository.appendMessage('s1', { role: 'user', content: 'again' });

    const sessions = await repository.listSessions();
    expect(sessions.map((s) => s.sessionId)).toEqual(['s1', 's2']);
    expect(sessions[0]).toMatchObject({
      messageCount: 3,
      preview: 'first session opener',
    });
    expect(sessions[1]).toMatchObject({ messageCount: 0 });
  });

  it('searches message content across sessions', async () => {
    const repository = openRepo();
    await repository.createSession('s1');
    await repository.createSession('s2');
    await repository.appendMessage('s1', {
      role: 'user',
      content: 'I like teal',
    });
    await repository.appendMessage('s1', {
      role: 'assistant',
      content: 'The Phi-4 test was strange',
    });
    await repository.appendMessage('s2', {
      role: 'user',
      content: 'RuVector will come later',
    });

    const results = await repository.searchMessages('Phi-4');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      sessionId: 's1',
      role: 'assistant',
      content: 'The Phi-4 test was strange',
    });
    expect(results[0]?.messageId).toBeDefined();

    expect(
      await repository.searchMessages('teal', { sessionId: 's2' }),
    ).toHaveLength(0);
    expect(
      await repository.searchMessages('teal', { sessionId: 's1' }),
    ).toHaveLength(1);
  });

  it('falls back to a literal phrase when raw FTS syntax fails', async () => {
    const repository = openRepo();
    await repository.createSession('s1');
    await repository.appendMessage('s1', {
      role: 'user',
      content: 'I like teal',
    });

    // A lone quote is invalid FTS5 but a valid literal phrase (no match).
    await expect(repository.searchMessages('"')).resolves.toHaveLength(0);
    // Hyphenated text would otherwise fail to parse ("no such column").
    await repository.appendMessage('s1', {
      role: 'assistant',
      content: 'The Phi-4 test was strange',
    });
    expect(
      await repository.searchMessages('well-known-nobody-said-this'),
    ).toHaveLength(0);
  });

  it('survives close and reopen against the same file', async () => {
    const path = join(dir, 'persist.sqlite');
    const first = new SqliteSessionRepository(testConfig(path));
    first.onModuleInit();
    await first.createSession('s1');
    await first.appendMessage('s1', { role: 'user', content: 'hello' });
    first.onModuleDestroy();

    const second = new SqliteSessionRepository(testConfig(path));
    second.onModuleInit();
    repo = second;
    try {
      expect(await second.getMessages('s1')).toEqual([
        { role: 'user', content: 'hello' },
      ]);
      expect(await second.searchMessages('hello')).toHaveLength(1);
    } finally {
      second.onModuleDestroy();
      repo = null;
    }
  });

  it('rebuilds the FTS index from canonical messages', async () => {
    const path = join(dir, 'rebuild.sqlite');
    const repository = new SqliteSessionRepository(testConfig(path));
    repository.onModuleInit();
    repo = repository;
    await repository.createSession('s1');
    await repository.appendMessage('s1', {
      role: 'user',
      content: 'rebuildable content',
    });
    expect(await repository.searchMessages('rebuildable')).toHaveLength(1);

    const direct = new Database(path);
    try {
      direct.exec(
        `INSERT INTO messages_fts(messages_fts) VALUES('delete-all')`,
      );
    } finally {
      direct.close();
    }
    expect(await repository.searchMessages('rebuildable')).toHaveLength(0);

    await repository.rebuildSearchIndex();
    expect(await repository.searchMessages('rebuildable')).toHaveLength(1);
  });
});
