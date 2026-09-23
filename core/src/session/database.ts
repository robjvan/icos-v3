import { dirname, resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';

export type DatabaseSchema = 'sessions' | 'memories';

/**
 * Canonical transcript schema. `messages` is the source of truth;
 * `messages_fts` is a derived search index, rebuildable at any time.
 * Lives in the sessions database only.
 */
const SESSIONS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    title TEXT
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    excluded_from_context INTEGER NOT NULL DEFAULT 0,

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

CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    action TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT,
    resolved_at TEXT,

    FOREIGN KEY (session_id)
        REFERENCES sessions(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_approvals_session_status
ON approvals(session_id, status);

CREATE TABLE IF NOT EXISTS approval_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    approval_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    event TEXT NOT NULL,
    created_at TEXT NOT NULL,

    FOREIGN KEY (approval_id)
        REFERENCES approvals(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_approval_events_approval
ON approval_events(approval_id);

CREATE TABLE IF NOT EXISTS clarifications (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    question TEXT NOT NULL,
    options TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    answer TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT,
    resolved_at TEXT,

    FOREIGN KEY (session_id)
        REFERENCES sessions(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_clarifications_session_status
ON clarifications(session_id, status);

CREATE TABLE IF NOT EXISTS clarification_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clarification_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    event TEXT NOT NULL,
    created_at TEXT NOT NULL,

    FOREIGN KEY (clarification_id)
        REFERENCES clarifications(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_clarification_events_clarification
ON clarification_events(clarification_id);

CREATE TABLE IF NOT EXISTS tool_requests (
    request_id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
    input_json TEXT NOT NULL CHECK (json_valid(input_json)),
    invocation_id TEXT UNIQUE,
    approval_id TEXT UNIQUE REFERENCES approvals(id) ON DELETE RESTRICT,
    state TEXT NOT NULL CHECK (state IN (
        'closed', 'invalid', 'validated', 'awaiting_approval',
        'executing', 'succeeded', 'failed',
        'rejected', 'cancelled', 'expired'
    )),
    validation_json TEXT NOT NULL CHECK (json_valid(validation_json)),
    execution_token TEXT,
    ownership TEXT NOT NULL DEFAULT 'unconfirmed' CHECK (ownership IN ('unconfirmed', 'released')),
    execution_json TEXT CHECK (execution_json IS NULL OR (
        json_valid(execution_json) AND length(CAST(execution_json AS BLOB)) <= 65536
    )),
    final_state TEXT NOT NULL CHECK (final_state IN (
        'not_required', 'pending', 'claimed', 'succeeded', 'failed'
    )),
    final_token TEXT,
    final_json TEXT NOT NULL CHECK (json_valid(final_json)),
    transcript_state TEXT NOT NULL DEFAULT 'pending' CHECK (transcript_state IN ('pending', 'written')),
    CHECK (state NOT IN ('executing', 'succeeded', 'failed') OR invocation_id IS NOT NULL),
    CHECK (state != 'awaiting_approval' OR approval_id IS NOT NULL),
    CHECK ((state IN ('succeeded', 'failed')) = (execution_json IS NOT NULL)),
    CHECK (state != 'executing' OR execution_token IS NOT NULL),
    CHECK (ownership = 'unconfirmed' OR state = 'executing'),
    CHECK (final_state NOT IN ('pending', 'claimed', 'succeeded', 'failed') OR execution_json IS NOT NULL),
    CHECK (final_state != 'claimed' OR final_token IS NOT NULL)
);

CREATE TRIGGER IF NOT EXISTS tool_requests_identity_immutable
BEFORE UPDATE OF request_id, session_id, input_json, invocation_id ON tool_requests
BEGIN
    SELECT RAISE(ABORT, 'immutable tool request');
END;

CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    goal TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN (
        'created', 'reasoning', 'action_proposed', 'executing',
        'observing', 'awaiting_approval',
        'completed', 'failed', 'cancelled', 'budget_exhausted'
    )),
    request_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(request_ids)),
    current_request_id TEXT,
    iteration_count INTEGER NOT NULL DEFAULT 0,
    tool_call_count INTEGER NOT NULL DEFAULT 0,
    limits_json TEXT NOT NULL CHECK (json_valid(limits_json)),
    approval_id TEXT,
    termination_json TEXT CHECK (
        termination_json IS NULL OR json_valid(termination_json)
    ),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_session
ON agent_runs(session_id);
`;

/**
 * Post-M8d `tool_requests` definition, used to rebuild pre-M8d tables
 * whose CHECK constraints cannot be altered in place. The base schema
 * above stays `IF NOT EXISTS`-safe for old files; `migrateToolRequests`
 * swaps in this definition while preserving rows.
 */
const TOOL_REQUESTS_TABLE_SQL = `
CREATE TABLE tool_requests (
    request_id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
    input_json TEXT NOT NULL CHECK (json_valid(input_json)),
    invocation_id TEXT UNIQUE,
    approval_id TEXT UNIQUE REFERENCES approvals(id) ON DELETE RESTRICT,
    state TEXT NOT NULL CHECK (state IN (
        'closed', 'invalid', 'validated', 'awaiting_approval',
        'executing', 'succeeded', 'failed',
        'rejected', 'cancelled', 'expired'
    )),
    validation_json TEXT NOT NULL CHECK (json_valid(validation_json)),
    execution_token TEXT,
    ownership TEXT NOT NULL DEFAULT 'unconfirmed' CHECK (ownership IN ('unconfirmed', 'released')),
    execution_json TEXT CHECK (execution_json IS NULL OR (
        json_valid(execution_json) AND length(CAST(execution_json AS BLOB)) <= 65536
    )),
    final_state TEXT NOT NULL CHECK (final_state IN (
        'not_required', 'pending', 'claimed', 'succeeded', 'failed'
    )),
    final_token TEXT,
    final_json TEXT NOT NULL CHECK (json_valid(final_json)),
    transcript_state TEXT NOT NULL DEFAULT 'pending' CHECK (transcript_state IN ('pending', 'written')),
    CHECK (state NOT IN ('executing', 'succeeded', 'failed') OR invocation_id IS NOT NULL),
    CHECK (state != 'awaiting_approval' OR approval_id IS NOT NULL),
    CHECK ((state IN ('succeeded', 'failed')) = (execution_json IS NOT NULL)),
    CHECK (state != 'executing' OR execution_token IS NOT NULL),
    CHECK (ownership = 'unconfirmed' OR state = 'executing'),
    CHECK (final_state NOT IN ('pending', 'claimed', 'succeeded', 'failed') OR execution_json IS NOT NULL),
    CHECK (final_state != 'claimed' OR final_token IS NOT NULL)
);
`;

/** Post-M9b `agent_runs` definition: the full lifecycle state set. */
const AGENT_RUNS_TABLE_SQL = `
CREATE TABLE agent_runs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    goal TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN (
        'created', 'reasoning', 'action_proposed', 'executing',
        'observing', 'awaiting_approval',
        'completed', 'failed', 'cancelled', 'budget_exhausted'
    )),
    request_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(request_ids)),
    current_request_id TEXT,
    iteration_count INTEGER NOT NULL DEFAULT 0,
    tool_call_count INTEGER NOT NULL DEFAULT 0,
    limits_json TEXT NOT NULL CHECK (json_valid(limits_json)),
    approval_id TEXT,
    termination_json TEXT CHECK (
        termination_json IS NULL OR json_valid(termination_json)
    ),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
`;

const AGENT_RUNS_COLUMNS =
  'id, session_id, goal, state, request_ids, current_request_id, ' +
  'iteration_count, tool_call_count, limits_json, approval_id, ' +
  'termination_json, created_at, updated_at';

/** Full-column immutability guard converged on by `migrateToolRequests`. */
const TOOL_REQUESTS_IMMUTABLE_TRIGGER_SQL = `
CREATE TRIGGER tool_requests_identity_immutable
BEFORE UPDATE OF request_id, session_id, input_json, invocation_id, approval_id ON tool_requests
BEGIN
    SELECT RAISE(ABORT, 'immutable tool request');
END;
`;

const TOOL_REQUESTS_COLUMNS =
  'request_id, session_id, input_json, invocation_id, state, ' +
  'validation_json, execution_token, ownership, execution_json, ' +
  'final_state, final_token, final_json';

/**
 * Memory candidate evidence ledger schema. Observations about what might
 * be worth retaining — NOT epistemic memory. No embeddings, no promotion
 * state, no decay: history stays history.
 *
 * Provenance (`session_id`, `message_id`) is deliberately NOT a foreign
 * key: the transcript lives in a different database file, and SQLite
 * cannot enforce cross-database references. Integrity is by convention
 * plus insertion order (candidates are saved for messages just written).
 */
const MEMORIES_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS memory_candidates (
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

    -- M10b: which side of the turn the candidate was mined from.
    -- Stamped at extraction; pre-stamp rows read 'unknown', never defaulted.
    source_role TEXT NOT NULL DEFAULT 'unknown'
);

CREATE INDEX IF NOT EXISTS idx_memory_candidates_session
ON memory_candidates(session_id);

CREATE INDEX IF NOT EXISTS idx_memory_candidates_message
ON memory_candidates(message_id);

CREATE INDEX IF NOT EXISTS idx_memory_candidates_kind
ON memory_candidates(kind);

/**
 * M10b belief store. Claims reference ledger rows (evidence_json);
 * they never edit them. Reserved columns (source_type, summary,
 * related_json, access_count, last_accessed_at, activation, locked,
 * emotional_json) exist so M11/M12 need no migration — each has one
 * future owner, and M10 paths leave them at defaults.
 */
CREATE TABLE IF NOT EXISTS claims (
    id TEXT PRIMARY KEY,

    subject TEXT NOT NULL,
    predicate TEXT NOT NULL,
    object TEXT NOT NULL,
    identity_key TEXT NOT NULL,

    -- M10c: normalized subject/predicate for conflict lookup
    -- (same subject+predicate, different object). Populated by the
    -- repository with the same normalization as identity_key.
    subject_norm TEXT NOT NULL DEFAULT '',
    predicate_norm TEXT NOT NULL DEFAULT '',

    category TEXT NOT NULL
        CHECK (category IN ('fact', 'preference', 'relationship', 'procedure')),
    status TEXT NOT NULL
        CHECK (status IN ('candidate', 'active', 'contradicted', 'retired')),

    extractor_confidence REAL NOT NULL,
    confidence REAL NOT NULL,

    first_asserted_at TEXT NOT NULL,
    last_surfaced_at TEXT NOT NULL,

    origin TEXT NOT NULL CHECK (origin IN ('user', 'agent')),

    source_type TEXT,
    summary TEXT,

    evidence_json TEXT NOT NULL,
    related_json TEXT NOT NULL DEFAULT '[]',
    entities_json TEXT NOT NULL DEFAULT '[]',

    times_observed INTEGER NOT NULL DEFAULT 1,
    access_count INTEGER NOT NULL DEFAULT 0,
    last_accessed_at TEXT,
    activation REAL,
    locked INTEGER NOT NULL DEFAULT 0,
    emotional_json TEXT,

    promotion TEXT NOT NULL,

    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_identity
ON claims(identity_key);

CREATE INDEX IF NOT EXISTS idx_claims_status
ON claims(status);

CREATE INDEX IF NOT EXISTS idx_claims_category
ON claims(category);

CREATE INDEX IF NOT EXISTS idx_claims_subject_predicate
ON claims(subject_norm, predicate_norm);

/**
 * M10c promotion journal. Exactly-once machinery for candidate →
 * belief promotion: one row per proposed candidate, approval id as
 * idempotency key, crash-recoverable states.
 */
CREATE TABLE IF NOT EXISTS promotion_journal (
    id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL UNIQUE,
    operation TEXT NOT NULL CHECK (operation IN ('NEW', 'REINFORCE', 'CONTRADICT')),
    state TEXT NOT NULL
        CHECK (state IN ('proposed', 'promoting', 'committed', 'denied', 'failed')),
    approval_id TEXT,
    claim_id TEXT,
    detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_promotion_journal_state
ON promotion_journal(state);
`;

const SCHEMAS: Record<
  DatabaseSchema,
  { sql: string; tables: string[]; triggers: string[] }
> = {
  sessions: {
    sql: SESSIONS_SCHEMA_SQL,
    tables: [
      'sessions',
      'messages',
      'messages_fts',
      'approvals',
      'approval_events',
      'clarifications',
      'clarification_events',
      'tool_requests',
      'agent_runs',
    ],
    triggers: [
      'messages_ai',
      'messages_ad',
      'messages_au',
      'tool_requests_identity_immutable',
    ],
  },
  memories: {
    sql: MEMORIES_SCHEMA_SQL,
    tables: ['memory_candidates', 'claims', 'promotion_journal'],
    triggers: [],
  },
};

/**
 * Open (creating parent directories as needed) and initialize a Core
 * database file. Deterministic and repeatable: safe to run on every
 * startup. Throws on any failure — Core must not run without its stores.
 */
export function openDatabase(
  dbPath: string,
  schema: DatabaseSchema,
): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMAS[schema].sql);
    migrateColumns(db, schema);
    verifySchema(db, schema);
    return db;
  } catch (err) {
    db.close();
    throw err;
  }
}

/**
 * Idempotent additive migrations for databases created before a column
 * existed. `CREATE TABLE IF NOT EXISTS` only covers fresh files; live
 * files need explicit `ALTER TABLE`. Additive-only: never rename, drop,
 * or reinterpret an existing column.
 */
function migrateColumns(db: Database.Database, schema: DatabaseSchema): void {
  if (schema === 'sessions') {
    addColumnIfMissing(db, 'sessions', 'title', 'TEXT');
    addColumnIfMissing(
      db,
      'messages',
      'excluded_from_context',
      'INTEGER NOT NULL DEFAULT 0',
    );
    migrateToolRequests(db);
    migrateAgentRuns(db);
    addColumnIfMissing(
      db,
      'tool_requests',
      'transcript_state',
      `TEXT NOT NULL DEFAULT 'pending' CHECK (transcript_state IN ('pending', 'written'))`,
    );
  }
  if (schema === 'memories') {
    // M10b: live ledger files predate the origin stamp.
    addColumnIfMissing(
      db,
      'memory_candidates',
      'source_role',
      `TEXT NOT NULL DEFAULT 'unknown'`,
    );
    // M10c: live claim files predate conflict-lookup columns.
    addColumnIfMissing(
      db,
      'claims',
      'subject_norm',
      `TEXT NOT NULL DEFAULT ''`,
    );
    addColumnIfMissing(
      db,
      'claims',
      'predicate_norm',
      `TEXT NOT NULL DEFAULT ''`,
    );
    backfillClaimNorms(db);
  }
}

/**
 * M8d upgrade for the M8c-era `tool_requests` table: pre-M8d tables
 * lack `approval_id` and the mirrored terminal states (`rejected`,
 * `cancelled`, `expired`), and CHECK constraints cannot be altered in
 * place. Rebuilds the table preserving every row, then converges the
 * immutability trigger on the full column list. Fresh databases take
 * the same path for the trigger. Idempotent: current tables are left
 * alone.
 */
function migrateToolRequests(db: Database.Database): void {
  const table = db
    .prepare(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tool_requests'`,
    )
    .get() as { sql: string } | undefined;
  if (!table) return;
  const columns = db.prepare(`PRAGMA table_info(tool_requests)`).all() as {
    name: string;
  }[];
  const names = new Set(columns.map((column) => column.name));
  if (names.has('approval_id') && table.sql.includes(`'rejected'`)) {
    ensureToolRequestsTrigger(db);
    return;
  }
  db.transaction(() => {
    db.exec(`ALTER TABLE tool_requests RENAME TO tool_requests_legacy;`);
    if (!names.has('approval_id')) {
      // Pre-M8d parks never created an approval, so nothing can ever
      // authorize them; drop rather than carry un-actionable rows.
      db.exec(
        `DELETE FROM tool_requests_legacy WHERE state = 'awaiting_approval';`,
      );
    }
    db.exec(TOOL_REQUESTS_TABLE_SQL);
    db.exec(
      `INSERT INTO tool_requests (${TOOL_REQUESTS_COLUMNS})
       SELECT ${TOOL_REQUESTS_COLUMNS} FROM tool_requests_legacy;`,
    );
    db.exec(`DROP TABLE tool_requests_legacy;`);
  }).immediate();
  ensureToolRequestsTrigger(db);
}

/**
 * M9b upgrade for the M9a-era `agent_runs` table: pre-M9b tables only
 * know the provisional states (`running`, `awaiting_approval`,
 * `completed`, `failed`), and CHECK constraints cannot be altered in
 * place. Rebuilds the table preserving every row. Rows stranded in
 * provisional `running` never reached a terminal state (crash or
 * pre-lifecycle code), so they are recorded as failed with their
 * executed tool count; every other state carries over unchanged.
 * Idempotent: current tables are left alone.
 */
function migrateAgentRuns(db: Database.Database): void {
  const table = db
    .prepare(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'agent_runs'`,
    )
    .get() as { sql: string } | undefined;
  if (!table) return;
  if (table.sql.includes(`'budget_exhausted'`)) return;
  db.transaction(() => {
    db.exec(`ALTER TABLE agent_runs RENAME TO agent_runs_legacy;`);
    db.exec(AGENT_RUNS_TABLE_SQL);
    db.exec(
      `INSERT INTO agent_runs (${AGENT_RUNS_COLUMNS})
       SELECT id, session_id, goal,
         CASE WHEN state = 'running' THEN 'failed' ELSE state END,
         request_ids, current_request_id, iteration_count, tool_call_count,
         limits_json, approval_id,
         CASE WHEN state = 'running'
           THEN '{"reason":"turn_error","toolSteps":' || tool_call_count || '}'
           ELSE termination_json END,
         created_at, updated_at
       FROM agent_runs_legacy;`,
    );
    db.exec(`DROP TABLE agent_runs_legacy;`);
  }).immediate();
}

function ensureToolRequestsTrigger(db: Database.Database): void {
  const trigger = db
    .prepare(
      `SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'tool_requests_identity_immutable'`,
    )
    .get() as { sql: string } | undefined;
  if (trigger && trigger.sql.includes('approval_id')) return;
  db.exec(`DROP TRIGGER IF EXISTS tool_requests_identity_immutable;`);
  db.exec(TOOL_REQUESTS_IMMUTABLE_TRIGGER_SQL);
}
/**
 * M10c backfill for claim rows predating the norm columns. SQL-level
 * approximation (case/whitespace/underscores) — close enough for
 * conflict lookup on legacy rows; every row written by the
 * repository carries exact norms. Only touches rows never populated.
 */
function backfillClaimNorms(db: Database.Database): void {
  db.exec(`
    UPDATE claims
       SET subject_norm = lower(trim(replace(subject, '_', ' '))),
           predicate_norm = lower(trim(replace(predicate, '_', ' ')))
     WHERE subject_norm = '' OR predicate_norm = '';`);
}

function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  if (rows.some((row) => row.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function verifySchema(db: Database.Database, schema: DatabaseSchema): void {
  const expected = SCHEMAS[schema];
  const names = [...expected.tables, ...expected.triggers].map((n) => `'${n}'`);
  const rows = db
    .prepare(
      `SELECT name, type FROM sqlite_master WHERE name IN (${names.join(', ')})`,
    )
    .all() as { name: string; type: string }[];
  const byName = new Map(rows.map((row) => [row.name, row.type]));
  for (const table of expected.tables) {
    if (byName.get(table) !== 'table') {
      throw new Error(`Database missing required table "${table}"`);
    }
  }
  for (const trigger of expected.triggers) {
    if (byName.get(trigger) !== 'trigger') {
      throw new Error(`Database missing required trigger "${trigger}"`);
    }
  }
}

function quotePath(path: string): string {
  return `'${path.replace(/'/g, "''")}'`;
}

function legacyTables(db: Database.Database): Set<string> {
  const rows = db
    .prepare(
      "SELECT name FROM legacy.sqlite_master WHERE name IN ('sessions', 'messages', 'memory_candidates')",
    )
    .all() as { name: string }[];
  return new Set(rows.map((row) => row.name));
}

export interface SplitMigrationResult {
  migratedSessions: boolean;
  migratedMemories: boolean;
  /** Non-fatal errors; the legacy file is never modified, so a retry is safe. */
  errors: string[];
}

/**
 * One-time migration from the pre-split single-file database: copy rows
 * (not files) into the fresh per-concern databases, preserving ids so
 * provenance survives. The legacy file is never modified. Idempotent —
 * targets that already exist are left alone. Best-effort per file: a
 * failure is reported in the result, never thrown, so boot can proceed
 * with empty stores rather than bricking on a half-migratable legacy.
 */
export function migrateLegacyDatabase(
  legacyPath: string | undefined,
  sessionsPath: string,
  memoriesPath: string,
): SplitMigrationResult {
  const result: SplitMigrationResult = {
    migratedSessions: false,
    migratedMemories: false,
    errors: [],
  };
  if (!legacyPath || !existsSync(legacyPath)) return result;

  if (!existsSync(sessionsPath) && !resolveSameFile(legacyPath, sessionsPath)) {
    try {
      const db = openDatabase(sessionsPath, 'sessions');
      try {
        db.exec(`ATTACH DATABASE ${quotePath(legacyPath)} AS legacy`);
        try {
          const tables = legacyTables(db);
          if (tables.has('sessions')) {
            db.exec(
              'INSERT INTO sessions (id, created_at, updated_at) SELECT id, created_at, updated_at FROM legacy.sessions',
            );
          }
          if (tables.has('messages')) {
            // Triggers repopulate messages_fts automatically.
            db.exec(
              'INSERT INTO messages (id, session_id, role, content, created_at) SELECT id, session_id, role, content, created_at FROM legacy.messages',
            );
          }
        } finally {
          db.exec('DETACH DATABASE legacy');
        }
      } finally {
        db.close();
      }
      result.migratedSessions = true;
    } catch (err) {
      result.migratedSessions = false;
      result.errors.push(
        `sessions migration failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (!existsSync(memoriesPath) && !resolveSameFile(legacyPath, memoriesPath)) {
    try {
      const db = openDatabase(memoriesPath, 'memories');
      try {
        db.exec(`ATTACH DATABASE ${quotePath(legacyPath)} AS legacy`);
        try {
          if (legacyTables(db).has('memory_candidates')) {
            db.exec(
              `INSERT INTO memory_candidates
                 (id, session_id, message_id, kind, subject, predicate, object,
                  confidence, importance, stability,
                  extractor_model, extractor_version, extracted_at)
               SELECT id, session_id, message_id, kind, subject, predicate, object,
                      confidence, importance, stability,
                      extractor_model, extractor_version, extracted_at
                 FROM legacy.memory_candidates`,
            );
          }
        } finally {
          db.exec('DETACH DATABASE legacy');
        }
      } finally {
        db.close();
      }
      result.migratedMemories = true;
    } catch (err) {
      result.migratedMemories = false;
      result.errors.push(
        `memories migration failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return result;
}

function resolveSameFile(a: string, b: string): boolean {
  // Avoid copying a file onto itself when a target is explicitly
  // pointed at the legacy location.
  return resolve(a) === resolve(b);
}
