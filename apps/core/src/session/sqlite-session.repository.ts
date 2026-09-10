/* eslint-disable @typescript-eslint/require-await --
   async is contractual (SessionRepository returns Promises);
   better-sqlite3 itself is synchronous. */
import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Database from 'better-sqlite3';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import type { ChatMessage } from '../llm/llm.client';
import { openDatabase } from './database';
import {
  InvalidSearchQueryError,
  SessionRepository,
} from './session.repository';
import type {
  MessageRecord,
  Session,
  SessionSearchResult,
  SessionSummary,
} from './session.repository';

const MAX_LIST_LIMIT = 100;
const MAX_SEARCH_LIMIT = 100;
const PREVIEW_LENGTH = 80;

function nowIso(): string {
  return new Date().toISOString();
}

@Injectable()
export class SqliteSessionRepository
  extends SessionRepository
  implements OnModuleInit, OnModuleDestroy
{
  private db: Database.Database | null = null;

  constructor(@Inject(CORE_CONFIG) private readonly config: CoreConfig) {
    super();
  }

  onModuleInit(): void {
    // Throws on failure: Core must fail startup without its transcript store.
    this.db = openDatabase(this.config.dbPath);
  }

  onModuleDestroy(): void {
    this.db?.close();
    this.db = null;
  }

  private get database(): Database.Database {
    if (!this.db) {
      throw new Error('Session database is not initialized');
    }
    return this.db;
  }

  async createSession(id: string): Promise<void> {
    const now = nowIso();
    this.database
      .prepare(
        'INSERT OR IGNORE INTO sessions (id, created_at, updated_at) VALUES (?, ?, ?)',
      )
      .run(id, now, now);
  }

  async getSession(id: string): Promise<Session | null> {
    const row = this.database
      .prepare('SELECT id, created_at, updated_at FROM sessions WHERE id = ?')
      .get(id) as
      { id: string; created_at: string; updated_at: string } | undefined;
    if (!row) return null;
    return { id: row.id, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  async appendMessage(
    sessionId: string,
    message: ChatMessage,
  ): Promise<MessageRecord> {
    if (message.role !== 'user' && message.role !== 'assistant') {
      throw new Error(`Unsupported message role "${message.role}"`);
    }
    const now = nowIso();
    const insert = this.database.transaction(
      (sid: string, role: string, content: string, createdAt: string) => {
        const info = this.database
          .prepare(
            'INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)',
          )
          .run(sid, role, content, createdAt);
        this.database
          .prepare('UPDATE sessions SET updated_at = ? WHERE id = ?')
          .run(createdAt, sid);
        return info.lastInsertRowid;
      },
    );
    const messageId = insert(sessionId, message.role, message.content, now);
    return {
      id: Number(messageId),
      sessionId,
      role: message.role,
      content: message.content,
      createdAt: now,
    };
  }

  async getMessages(
    sessionId: string,
    options?: { limit?: number; beforeId?: number },
  ): Promise<ChatMessage[]> {
    const clauses = ['session_id = ?'];
    const params: (string | number)[] = [sessionId];
    if (options?.beforeId !== undefined) {
      clauses.push('id < ?');
      params.push(options.beforeId);
    }
    let sql =
      `SELECT role, content FROM messages WHERE ${clauses.join(' AND ')} ` +
      `ORDER BY id DESC`;
    if (options?.limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }
    const rows = this.database.prepare(sql).all(...params) as {
      role: string;
      content: string;
    }[];
    return rows
      .reverse()
      .map((row) => ({ role: row.role, content: row.content }) as ChatMessage);
  }

  async listSessions(options?: {
    limit?: number;
    offset?: number;
  }): Promise<SessionSummary[]> {
    const limit = Math.min(options?.limit ?? 20, MAX_LIST_LIMIT);
    const offset = options?.offset ?? 0;
    const rows = this.database
      .prepare(
        `SELECT s.id, s.created_at, s.updated_at,
                COUNT(m.id) AS message_count,
                (SELECT content FROM messages
                   WHERE session_id = s.id AND role = 'user'
                   ORDER BY id ASC LIMIT 1) AS preview
           FROM sessions s
           LEFT JOIN messages m ON m.session_id = s.id
          GROUP BY s.id
          ORDER BY s.updated_at DESC
          LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as {
      id: string;
      created_at: string;
      updated_at: string;
      message_count: number;
      preview: string | null;
    }[];
    return rows.map((row) => ({
      sessionId: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: row.message_count,
      preview: row.preview ? row.preview.slice(0, PREVIEW_LENGTH) : undefined,
    }));
  }

  async searchMessages(
    query: string,
    options?: { limit?: number; sessionId?: string },
  ): Promise<SessionSearchResult[]> {
    try {
      return this.runSearch(query, options);
    } catch (err) {
      if (!isQueryError(err)) throw err;
      // Raw FTS5 syntax failed (e.g. "Phi-4", stray quotes): retry the
      // input as a literal phrase so ordinary text always searches.
      try {
        return this.runSearch(asPhrase(query), options);
      } catch (retryErr) {
        if (!isQueryError(retryErr)) throw retryErr;
        throw new InvalidSearchQueryError(query);
      }
    }
  }

  private runSearch(
    match: string,
    options?: { limit?: number; sessionId?: string },
  ): SessionSearchResult[] {
    const limit = Math.min(options?.limit ?? 20, MAX_SEARCH_LIMIT);
    const clauses = ['messages_fts MATCH ?'];
    const params: (string | number)[] = [match];
    if (options?.sessionId !== undefined) {
      clauses.push('m.session_id = ?');
      params.push(options.sessionId);
    }
    params.push(limit);
    const sql = `SELECT m.id, m.session_id, m.role, m.content, m.created_at
         FROM messages m
         JOIN messages_fts ON messages_fts.rowid = m.id
        WHERE ${clauses.join(' AND ')}
        ORDER BY messages_fts.rank
        LIMIT ?`;
    const rows = this.database.prepare(sql).all(...params) as {
      id: number;
      session_id: string;
      role: string;
      content: string;
      created_at: string;
    }[];
    return rows.map((row) => ({
      sessionId: row.session_id,
      messageId: row.id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
    }));
  }

  async rebuildSearchIndex(): Promise<void> {
    this.database.exec(
      `INSERT INTO messages_fts(messages_fts) VALUES('rebuild')`,
    );
  }
}

/** Quote raw text as an FTS5 literal phrase. */
function asPhrase(query: string): string {
  return `"${query.replace(/"/g, '""')}"`;
}

/**
 * True for errors caused by the MATCH expression (i.e. by user input).
 * The SQL skeleton is fixed and other params are validated upstream,
 * so anything else (IO, corruption, busy) must propagate as a 500.
 */
function isQueryError(err: unknown): boolean {
  return (
    err instanceof Error && (err as { code?: unknown }).code === 'SQLITE_ERROR'
  );
}
