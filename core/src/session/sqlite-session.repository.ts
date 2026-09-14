/* eslint-disable @typescript-eslint/require-await --
   async is contractual (SessionRepository returns Promises);
   better-sqlite3 itself is synchronous. */
import { Injectable } from '@nestjs/common';
import Database from 'better-sqlite3';
import type { ChatMessage } from '../llm/llm.client';
import { SessionDatabaseService } from './session-database.service';
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
export class SqliteSessionRepository extends SessionRepository {
  constructor(private readonly databaseService: SessionDatabaseService) {
    super();
  }

  private get database(): Database.Database {
    return this.databaseService.connection;
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
      .prepare(
        'SELECT id, created_at, updated_at, title FROM sessions WHERE id = ?',
      )
      .get(id) as
      | {
          id: string;
          created_at: string;
          updated_at: string;
          title: string | null;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(row.title ? { title: row.title } : {}),
    };
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
      excludedFromContext: false,
    };
  }

  async getMessages(
    sessionId: string,
    options?: { limit?: number; beforeId?: number },
  ): Promise<ChatMessage[]> {
    const records = await this.getMessageRecords(sessionId, options);
    return records
      .filter((record) => !record.excludedFromContext)
      .map(
        (record) =>
          ({
            role: record.role,
            content: record.content,
          }) as ChatMessage,
      );
  }

  async getMessageRecords(
    sessionId: string,
    options?: { limit?: number; beforeId?: number },
  ): Promise<MessageRecord[]> {
    const clauses = ['session_id = ?'];
    const params: (string | number)[] = [sessionId];
    if (options?.beforeId !== undefined) {
      clauses.push('id < ?');
      params.push(options.beforeId);
    }
    let sql =
      `SELECT id, session_id, role, content, created_at, excluded_from_context ` +
      `FROM messages WHERE ${clauses.join(' AND ')} ORDER BY id DESC`;
    if (options?.limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }
    const rows = this.database.prepare(sql).all(...params) as {
      id: number;
      session_id: string;
      role: string;
      content: string;
      created_at: string;
      excluded_from_context: number;
    }[];
    return rows.reverse().map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
      excludedFromContext: row.excluded_from_context === 1,
    }));
  }

  async excludeLastTurn(sessionId: string): Promise<number[] | null> {
    const lastUser = this.database
      .prepare(
        `SELECT id FROM messages
          WHERE session_id = ? AND role = 'user' AND excluded_from_context = 0
          ORDER BY id DESC LIMIT 1`,
      )
      .get(sessionId) as { id: number } | undefined;
    if (!lastUser) return null;
    const following = this.database
      .prepare(
        `SELECT id, role FROM messages
          WHERE session_id = ? AND id >= ? AND excluded_from_context = 0
          ORDER BY id ASC`,
      )
      .all(sessionId, lastUser.id) as { id: number; role: string }[];
    // Stop at the next user message: only this turn is excluded.
    const ids: number[] = [];
    for (const row of following) {
      if (row.id !== lastUser.id && row.role === 'user') break;
      ids.push(row.id);
    }
    const mark = this.database.transaction((marks: number[]) => {
      const stmt = this.database.prepare(
        'UPDATE messages SET excluded_from_context = 1 WHERE id = ?',
      );
      for (const id of marks) stmt.run(id);
    });
    mark(ids);
    return ids;
  }

  async forkSession(sourceId: string, newId: string): Promise<void> {
    const source = await this.getSession(sourceId);
    if (!source) throw new Error(`Unknown session "${sourceId}"`);
    const records = await this.getMessageRecords(sourceId);
    const now = nowIso();
    const copy = this.database.transaction(() => {
      this.database
        .prepare(
          'INSERT OR IGNORE INTO sessions (id, created_at, updated_at, title) VALUES (?, ?, ?, ?)',
        )
        .run(newId, now, now, source.title ?? null);
      const insert = this.database.prepare(
        `INSERT INTO messages
           (session_id, role, content, created_at, excluded_from_context)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const record of records) {
        insert.run(
          newId,
          record.role,
          record.content,
          record.createdAt,
          record.excludedFromContext ? 1 : 0,
        );
      }
    });
    copy();
  }

  async renameSession(id: string, title: string): Promise<void> {
    const trimmed = title.trim();
    this.database
      .prepare('UPDATE sessions SET updated_at = ?, title = ? WHERE id = ?')
      .run(nowIso(), trimmed ? trimmed : null, id);
  }

  async ping(): Promise<void> {
    this.database.prepare('SELECT 1').get();
  }

  async listSessions(options?: {
    limit?: number;
    offset?: number;
  }): Promise<SessionSummary[]> {
    const limit = Math.min(options?.limit ?? 20, MAX_LIST_LIMIT);
    const offset = options?.offset ?? 0;
    const rows = this.database
      .prepare(
        `SELECT s.id, s.created_at, s.updated_at, s.title,
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
      title: string | null;
      message_count: number;
      preview: string | null;
    }[];
    return rows.map((row) => ({
      sessionId: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: row.message_count,
      title: row.title ?? undefined,
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
