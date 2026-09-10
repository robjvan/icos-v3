import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { migrateLegacyDatabase, openDatabase } from './database';

const LEGACY_SCHEMA_SQL = `
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE VIRTUAL TABLE messages_fts USING fts5(content, content='messages', content_rowid='id');
CREATE TABLE memory_candidates (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    message_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    subject TEXT NOT NULL,
    predicate TEXT NOT NULL,
    object TEXT NOT NULL,
    confidence REAL NOT NULL,
    importance REAL NOT NULL,
    stability REAL NOT NULL,
    extractor_model TEXT NOT NULL,
    extractor_version TEXT NOT NULL,
    extracted_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);
`;

function seedLegacy(path: string): void {
  const db = new Database(path);
  try {
    db.exec(LEGACY_SCHEMA_SQL);
    db.prepare(
      'INSERT INTO sessions (id, created_at, updated_at) VALUES (?, ?, ?)',
    ).run('s1', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
    db.prepare(
      'INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(1, 's1', 'user', 'I like teal', '2026-01-01T00:00:00.000Z');
    db.prepare(
      `INSERT INTO memory_candidates
         (id, session_id, message_id, kind, subject, predicate, object,
          confidence, importance, stability,
          extractor_model, extractor_version, extracted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'c1',
      's1',
      1,
      'preference',
      'user',
      'prefers',
      'teal',
      0.9,
      0.7,
      0.8,
      'mem',
      'memory-extraction-v1',
      '2026-01-03T00:00:00.000Z',
    );
  } finally {
    db.close();
  }
}

describe('openDatabase', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-db-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates parent directories and initializes the sessions schema', () => {
    const db = openDatabase(join(dir, 'nested', 'sessions.sqlite'), 'sessions');
    try {
      const names = (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as {
          name: string;
        }[]
      ).map((row) => row.name);
      expect(names).toEqual(
        expect.arrayContaining(['sessions', 'messages', 'messages_fts']),
      );
      expect(names).not.toContain('memory_candidates');
    } finally {
      db.close();
    }
  });

  it('initializes the memories schema without transcript tables', () => {
    const db = openDatabase(join(dir, 'memories.sqlite'), 'memories');
    try {
      const names = (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as {
          name: string;
        }[]
      ).map((row) => row.name);
      expect(names).toEqual(['memory_candidates']);
    } finally {
      db.close();
    }
  });

  it('is repeatable against an existing database', () => {
    const path = join(dir, 'sessions.sqlite');
    openDatabase(path, 'sessions').close();
    const db = openDatabase(path, 'sessions');
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
    expect(() =>
      openDatabase(join(blocker, 'core.sqlite'), 'sessions'),
    ).toThrow();
  });
});

describe('migrateLegacyDatabase', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-migrate-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('copies transcript and candidates into the split files, preserving ids', () => {
    const legacy = join(dir, 'core.sqlite');
    const sessions = join(dir, 'sessions.sqlite');
    const memories = join(dir, 'memories.sqlite');
    seedLegacy(legacy);

    const result = migrateLegacyDatabase(legacy, sessions, memories);

    expect(result).toEqual({
      migratedSessions: true,
      migratedMemories: true,
      errors: [],
    });

    const sdb = openDatabase(sessions, 'sessions');
    try {
      expect(sdb.prepare('SELECT * FROM sessions').all()).toHaveLength(1);
      expect(
        sdb.prepare('SELECT id, role, content FROM messages').all(),
      ).toEqual([{ id: 1, role: 'user', content: 'I like teal' }]);
      // FTS triggers repopulated the index during the copy.
      expect(
        sdb
          .prepare('SELECT * FROM messages_fts WHERE messages_fts MATCH ?')
          .all('teal'),
      ).toHaveLength(1);
    } finally {
      sdb.close();
    }

    const mdb = openDatabase(memories, 'memories');
    try {
      expect(mdb.prepare('SELECT * FROM memory_candidates').all()).toHaveLength(
        1,
      );
      expect(
        mdb
          .prepare('SELECT id, message_id AS messageId FROM memory_candidates')
          .all(),
      ).toEqual([{ id: 'c1', messageId: 1 }]);
    } finally {
      mdb.close();
    }
  });

  it('leaves the legacy file untouched', () => {
    const legacy = join(dir, 'core.sqlite');
    seedLegacy(legacy);
    migrateLegacyDatabase(legacy, join(dir, 's.sqlite'), join(dir, 'm.sqlite'));

    const db = new Database(legacy);
    try {
      expect(
        (
          db.prepare('SELECT COUNT(*) AS n FROM messages').get() as {
            n: number;
          }
        ).n,
      ).toBe(1);
      expect(
        (
          db.prepare('SELECT COUNT(*) AS n FROM memory_candidates').get() as {
            n: number;
          }
        ).n,
      ).toBe(1);
    } finally {
      db.close();
    }
  });

  it('skips targets that already exist and missing legacy files', () => {
    const sessions = join(dir, 's.sqlite');
    openDatabase(sessions, 'sessions').close();

    expect(
      migrateLegacyDatabase(
        join(dir, 'nope.sqlite'),
        sessions,
        join(dir, 'm.sqlite'),
      ),
    ).toEqual({ migratedSessions: false, migratedMemories: false, errors: [] });
    expect(existsSync(join(dir, 'm.sqlite'))).toBe(false);

    const legacy = join(dir, 'core.sqlite');
    seedLegacy(legacy);
    expect(
      migrateLegacyDatabase(legacy, sessions, join(dir, 'm2.sqlite')),
    ).toEqual({
      migratedSessions: false,
      migratedMemories: true,
      errors: [],
    });
    // Pre-existing sessions file was not clobbered.
    const sdb = openDatabase(sessions, 'sessions');
    try {
      expect(
        (
          sdb.prepare('SELECT COUNT(*) AS n FROM sessions').get() as {
            n: number;
          }
        ).n,
      ).toBe(0);
    } finally {
      sdb.close();
    }
  });
});
