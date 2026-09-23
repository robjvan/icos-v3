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
      expect(names).toEqual(['memory_candidates', 'claims']);
    } finally {
      db.close();
    }
  });

  it('migrates pre-M10b memories files with claims table and role column', () => {
    // Simulate a ledger file from before M10b: old candidates DDL
    // without source_role, no claims table, one live row to preserve.
    const path = join(dir, 'old-memories.sqlite');
    const old = new Database(path);
    try {
      old.exec(`
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
            extracted_at TEXT NOT NULL
        );`);
      old
        .prepare(
          `INSERT INTO memory_candidates
             (id, session_id, message_id, kind, subject, predicate, object,
              confidence, importance, stability,
              extractor_model, extractor_version, extracted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
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
      old.close();
    }

    const db = openDatabase(path, 'memories');
    try {
      const tables = (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as { name: string }[]
      ).map((row) => row.name);
      expect(tables).toEqual(
        expect.arrayContaining(['memory_candidates', 'claims']),
      );
      const row = db
        .prepare('SELECT source_role FROM memory_candidates WHERE id = ?')
        .get('c1') as { source_role: string };
      expect(row.source_role).toBe('unknown');
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

  it('migrates pre-M6 files with title and exclusion columns', () => {
    // Simulate a database created before M6: old DDL without the new
    // columns, plus live rows that must survive the upgrade.
    const path = join(dir, 'old.sqlite');
    const old = new Database(path);
    try {
      old.exec(`
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
        CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
            INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
        END;
        CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
            INSERT INTO messages_fts(messages_fts, rowid, content)
            VALUES ('delete', old.id, old.content);
        END;
        CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
            INSERT INTO messages_fts(messages_fts, rowid, content)
            VALUES ('delete', old.id, old.content);
            INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
        END;
      `);
      old
        .prepare(
          'INSERT INTO sessions (id, created_at, updated_at) VALUES (?, ?, ?)',
        )
        .run('s1', 't', 't');
      old
        .prepare(
          'INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)',
        )
        .run('s1', 'user', 'old row', 't');
    } finally {
      old.close();
    }

    const db = openDatabase(path, 'sessions');
    const columns = (
      db.prepare('PRAGMA table_info(messages)').all() as { name: string }[]
    ).map((row) => row.name);
    expect(columns).toContain('excluded_from_context');
    const sessionColumns = (
      db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]
    ).map((row) => row.name);
    expect(sessionColumns).toContain('title');
    // Live rows survive with sane defaults.
    expect(
      db
        .prepare('SELECT content, excluded_from_context AS e FROM messages')
        .get(),
    ).toEqual({ content: 'old row', e: 0 });
    db.close();
    // Re-open is idempotent.
    openDatabase(path, 'sessions').close();
  });

  it('rebuilds pre-M8d tool_requests, preserving rows and converging the trigger', () => {
    // Simulate an M8c-era database: no approval_id, no mirrored
    // terminal states, four-column immutability trigger.
    const path = join(dir, 'm8c.sqlite');
    const old = new Database(path);
    try {
      old.exec(`
        CREATE TABLE sessions (
            id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            title TEXT
        );
        CREATE TABLE approvals (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            action TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            expires_at TEXT,
            resolved_at TEXT,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        CREATE TABLE tool_requests (
            request_id TEXT PRIMARY KEY NOT NULL,
            session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
            input_json TEXT NOT NULL,
            invocation_id TEXT UNIQUE,
            state TEXT NOT NULL,
            validation_json TEXT NOT NULL,
            execution_token TEXT,
            ownership TEXT NOT NULL DEFAULT 'unconfirmed',
            execution_json TEXT,
            final_state TEXT NOT NULL,
            final_token TEXT,
            final_json TEXT NOT NULL
        );
        CREATE TRIGGER tool_requests_identity_immutable
        BEFORE UPDATE OF request_id, session_id, input_json, invocation_id ON tool_requests
        BEGIN
            SELECT RAISE(ABORT, 'immutable tool request');
        END;
      `);
      old
        .prepare(
          'INSERT INTO sessions (id, created_at, updated_at) VALUES (?, ?, ?)',
        )
        .run('s1', 't', 't');
      const insert = old.prepare(
        `INSERT INTO tool_requests
          (request_id, session_id, input_json, invocation_id, state,
           validation_json, execution_json, final_state, final_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      insert.run(
        'kept',
        's1',
        '{"requestId":"kept"}',
        'inv-1',
        'succeeded',
        '{"ok":true}',
        '{"ok":true,"matches":[]}',
        'pending',
        '{"state":"pending"}',
      );
      insert.run(
        'parked',
        's1',
        '{"requestId":"parked"}',
        'inv-2',
        'awaiting_approval',
        '{"ok":true}',
        null,
        'not_required',
        '{"state":"not_required"}',
      );
    } finally {
      old.close();
    }

    const db = openDatabase(path, 'sessions');
    try {
      const columns = (
        db.prepare('PRAGMA table_info(tool_requests)').all() as {
          name: string;
        }[]
      ).map((row) => row.name);
      expect(columns).toContain('approval_id');
      // Completed rows survive with a null binding.
      expect(
        db
          .prepare(
            'SELECT request_id, approval_id FROM tool_requests WHERE request_id = ?',
          )
          .get('kept'),
      ).toEqual({ request_id: 'kept', approval_id: null });
      // Approval-less parks are un-actionable and do not survive.
      expect(
        db.prepare('SELECT COUNT(*) AS n FROM tool_requests').get() as {
          n: number;
        },
      ).toEqual({ n: 1 });
      // Mirrored terminal states are accepted now.
      db.prepare(
        `INSERT INTO tool_requests
          (request_id, session_id, input_json, state,
           validation_json, final_state, final_json)
         VALUES (?, ?, ?, 'rejected', ?, 'not_required', ?)`,
      ).run(
        'mirrored',
        's1',
        '{"requestId":"mirrored"}',
        '{"ok":false}',
        '{"state":"not_required"}',
      );
      // The converged trigger guards the binding column too.
      expect(() =>
        db
          .prepare(
            "UPDATE tool_requests SET approval_id = 'x' WHERE request_id = 'kept'",
          )
          .run(),
      ).toThrow('immutable tool request');
    } finally {
      db.close();
    }
    // Re-open is idempotent.
    openDatabase(path, 'sessions').close();
  });

  it('rebuilds pre-M9b agent_runs, mapping stranded running rows to failed', () => {
    // Simulate an M9a-era database: provisional lifecycle states only.
    const path = join(dir, 'm9a.sqlite');
    const old = new Database(path);
    try {
      old.exec(`
        CREATE TABLE sessions (
            id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            title TEXT
        );
        CREATE TABLE agent_runs (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            goal TEXT NOT NULL,
            state TEXT NOT NULL CHECK (state IN (
                'running', 'awaiting_approval', 'completed', 'failed'
            )),
            request_ids TEXT NOT NULL DEFAULT '[]',
            current_request_id TEXT,
            iteration_count INTEGER NOT NULL DEFAULT 0,
            tool_call_count INTEGER NOT NULL DEFAULT 0,
            limits_json TEXT NOT NULL,
            approval_id TEXT,
            termination_json TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
      `);
      old
        .prepare(
          'INSERT INTO sessions (id, created_at, updated_at) VALUES (?, ?, ?)',
        )
        .run('s1', 't', 't');
      const insert = old.prepare(
        `INSERT INTO agent_runs
          (id, session_id, goal, state, request_ids, current_request_id,
           iteration_count, tool_call_count, limits_json, approval_id,
           termination_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      insert.run(
        'stranded',
        's1',
        'crashed turn',
        'running',
        '["req-1"]',
        'req-1',
        1,
        2,
        '{"maxToolSteps":5}',
        null,
        null,
        't',
        't',
      );
      insert.run(
        'parked',
        's1',
        'rename it',
        'awaiting_approval',
        '["req-2"]',
        'req-2',
        1,
        1,
        '{"maxToolSteps":5}',
        'appr-1',
        null,
        't',
        't',
      );
    } finally {
      old.close();
    }

    const db = openDatabase(path, 'sessions');
    try {
      const rows = db
        .prepare(
          `SELECT id, state, tool_call_count, termination_json
           FROM agent_runs ORDER BY id`,
        )
        .all() as {
        id: string;
        state: string;
        tool_call_count: number;
        termination_json: string | null;
      }[];
      // Stranded provisional rows become failed with their executed count.
      expect(rows).toEqual([
        {
          id: 'parked',
          state: 'awaiting_approval',
          tool_call_count: 1,
          termination_json: null,
        },
        {
          id: 'stranded',
          state: 'failed',
          tool_call_count: 2,
          termination_json: '{"reason":"turn_error","toolSteps":2}',
        },
      ]);
      // The new lifecycle states are accepted now.
      db.prepare(
        `UPDATE agent_runs SET state = 'observing' WHERE id = 'parked'`,
      ).run();
      expect(() =>
        db
          .prepare(
            `UPDATE agent_runs SET state = 'running' WHERE id = 'parked'`,
          )
          .run(),
      ).toThrow();
    } finally {
      db.close();
    }
    // Re-open is idempotent.
    openDatabase(path, 'sessions').close();
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
