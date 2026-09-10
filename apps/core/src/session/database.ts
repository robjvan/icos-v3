import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';

/**
 * Canonical transcript schema. `messages` is the source of truth;
 * `messages_fts` is a derived search index, rebuildable at any time.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,

    FOREIGN KEY (session_id)
        REFERENCES sessions(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_session_id
ON messages(session_id);

CREATE INDEX IF NOT EXISTS idx_messages_session_created
ON messages(session_id, created_at);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts
USING fts5(
    content,
    content='messages',
    content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content)
    VALUES ('delete', old.id, old.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content)
    VALUES ('delete', old.id, old.content);
    INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;
`;

const REQUIRED_TABLES = ['sessions', 'messages', 'messages_fts'];
const REQUIRED_TRIGGERS = ['messages_ai', 'messages_ad', 'messages_au'];

/**
 * Open (creating parent directories as needed) and initialize the
 * transcript database. Deterministic and repeatable: safe to run on
 * every startup. Throws on any failure — Core must not run without
 * its transcript store.
 */
export function openDatabase(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA_SQL);
    verifySchema(db);
    return db;
  } catch (err) {
    db.close();
    throw err;
  }
}

function verifySchema(db: Database.Database): void {
  const rows = db
    .prepare(
      "SELECT name, type FROM sqlite_master WHERE name IN ('sessions', 'messages', 'messages_fts', 'messages_ai', 'messages_ad', 'messages_au')",
    )
    .all() as { name: string; type: string }[];
  const byName = new Map(rows.map((row) => [row.name, row.type]));
  for (const table of REQUIRED_TABLES) {
    if (byName.get(table) !== 'table') {
      throw new Error(`Transcript database missing required table "${table}"`);
    }
  }
  for (const trigger of REQUIRED_TRIGGERS) {
    if (byName.get(trigger) !== 'trigger') {
      throw new Error(
        `Transcript database missing required trigger "${trigger}"`,
      );
    }
  }
}
