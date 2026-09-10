import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './database';

describe('openDatabase', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-db-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates parent directories and initializes the schema', () => {
    const db = openDatabase(join(dir, 'nested', 'core.sqlite'));
    try {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[];
      const names = tables.map((table) => table.name);
      expect(names).toEqual(
        expect.arrayContaining(['sessions', 'messages', 'messages_fts']),
      );
    } finally {
      db.close();
    }
  });

  it('is repeatable against an existing database', () => {
    const path = join(dir, 'core.sqlite');
    openDatabase(path).close();
    const db = openDatabase(path);
    try {
      db.prepare(
        'INSERT INTO sessions (id, created_at, updated_at) VALUES (?, ?, ?)',
      ).run('s1', 't', 't');
      expect(
        (
          db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as {
            n: number;
          }
        ).n,
      ).toBe(1);
    } finally {
      db.close();
    }
  });

  it('throws when the database cannot be created', () => {
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, 'not a directory');
    expect(() => openDatabase(join(blocker, 'core.sqlite'))).toThrow();
  });
});
