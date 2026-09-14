/* eslint-disable @typescript-eslint/require-await --
   async is contractual (ClarificationRepository returns Promises);
   better-sqlite3 itself is synchronous. */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { SessionDatabaseService } from '../session/session-database.service';
import {
  ClarificationNotFoundError,
  ClarificationRepository,
  InvalidClarificationAnswerError,
  InvalidClarificationTransitionError,
} from './clarification.repository';
import type {
  ClarificationEvent,
  ClarificationEventType,
  ClarificationRequest,
  ClarificationStatus,
  NewClarification,
} from './clarification.repository';

function nowIso(): string {
  return new Date().toISOString();
}

interface ClarificationRow {
  id: string;
  session_id: string;
  question: string;
  options: string | null;
  status: ClarificationStatus;
  answer: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  resolved_at: string | null;
}

function parseOptions(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.every((item): item is string => typeof item === 'string')
    ) {
      return parsed;
    }
  } catch {
    // Own writes are always valid JSON; treat anything else as absent.
  }
  return undefined;
}

function toRequest(row: ClarificationRow): ClarificationRequest {
  const options = parseOptions(row.options);
  return {
    id: row.id,
    sessionId: row.session_id,
    question: row.question,
    ...(options !== undefined ? { options } : {}),
    status: row.status,
    ...(row.answer !== null ? { answer: row.answer } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
    ...(row.resolved_at ? { resolvedAt: row.resolved_at } : {}),
  };
}

@Injectable()
export class SqliteClarificationRepository extends ClarificationRepository {
  constructor(private readonly databaseService: SessionDatabaseService) {
    super();
  }

  private get database(): Database.Database {
    return this.databaseService.connection;
  }

  async createClarification(
    input: NewClarification,
  ): Promise<ClarificationRequest> {
    const now = nowIso();
    const id = randomUUID();
    const create = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO clarifications
             (id, session_id, question, options, status, answer,
              created_at, updated_at, expires_at)
           VALUES (?, ?, ?, ?, 'pending', NULL, ?, ?, ?)`,
        )
        .run(
          id,
          input.sessionId,
          input.question,
          input.options ? JSON.stringify(input.options) : null,
          now,
          now,
          input.expiresAt ?? null,
        );
      this.recordEvent(id, input.sessionId, 'created', now);
    });
    create();
    const created = await this.getClarification(id);
    if (!created) throw new ClarificationNotFoundError(id);
    return created;
  }

  async getClarification(id: string): Promise<ClarificationRequest | null> {
    const row = this.database
      .prepare('SELECT * FROM clarifications WHERE id = ?')
      .get(id) as ClarificationRow | undefined;
    if (!row) return null;
    return toRequest(this.applyLazyExpiry(row));
  }

  async listClarifications(options?: {
    sessionId?: string;
    status?: ClarificationStatus;
  }): Promise<ClarificationRequest[]> {
    this.expireLapsed(options?.sessionId);
    const clauses: string[] = [];
    const params: string[] = [];
    if (options?.sessionId !== undefined) {
      clauses.push('session_id = ?');
      params.push(options.sessionId);
    }
    if (options?.status !== undefined) {
      clauses.push('status = ?');
      params.push(options.status);
    }
    const rows = this.database
      .prepare(
        `SELECT * FROM clarifications` +
          (clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '') +
          ` ORDER BY created_at ASC, id ASC`,
      )
      .all(...params) as ClarificationRow[];
    return rows.map(toRequest);
  }

  async answerClarification(
    id: string,
    answer: string,
  ): Promise<ClarificationRequest> {
    const row = this.database
      .prepare('SELECT * FROM clarifications WHERE id = ?')
      .get(id) as ClarificationRow | undefined;
    if (!row) throw new ClarificationNotFoundError(id);
    const current = toRequest(this.applyLazyExpiry(row));
    if (current.status !== 'pending') {
      throw new InvalidClarificationTransitionError(
        id,
        current.status,
        'answered',
      );
    }
    const trimmed = answer.trim();
    if (!trimmed) {
      throw new InvalidClarificationAnswerError(id, 'answer must not be empty');
    }
    if (current.options && !current.options.includes(trimmed)) {
      throw new InvalidClarificationAnswerError(
        id,
        'answer must be one of the offered options',
      );
    }
    const now = nowIso();
    const resolve = this.database.transaction(() => {
      const info = this.database
        .prepare(
          `UPDATE clarifications
              SET status = 'answered', answer = ?, updated_at = ?, resolved_at = ?
            WHERE id = ? AND status = 'pending'`,
        )
        .run(trimmed, now, now, id);
      if (info.changes === 0) {
        // A concurrent resolution landed first; report the real state.
        const loser = this.database
          .prepare('SELECT status FROM clarifications WHERE id = ?')
          .get(id) as { status: ClarificationStatus };
        throw new InvalidClarificationTransitionError(
          id,
          loser.status,
          'answered',
        );
      }
      this.recordEvent(id, current.sessionId, 'answered', now);
    });
    resolve();
    const answered = await this.getClarification(id);
    if (!answered) throw new ClarificationNotFoundError(id);
    return answered;
  }

  async cancelClarification(id: string): Promise<ClarificationRequest> {
    const row = this.database
      .prepare('SELECT * FROM clarifications WHERE id = ?')
      .get(id) as ClarificationRow | undefined;
    if (!row) throw new ClarificationNotFoundError(id);
    const current = toRequest(this.applyLazyExpiry(row));
    if (current.status !== 'pending') {
      throw new InvalidClarificationTransitionError(
        id,
        current.status,
        'cancelled',
      );
    }
    const now = nowIso();
    const cancel = this.database.transaction(() => {
      const info = this.database
        .prepare(
          `UPDATE clarifications
              SET status = 'cancelled', updated_at = ?, resolved_at = ?
            WHERE id = ? AND status = 'pending'`,
        )
        .run(now, now, id);
      if (info.changes === 0) {
        const loser = this.database
          .prepare('SELECT status FROM clarifications WHERE id = ?')
          .get(id) as { status: ClarificationStatus };
        throw new InvalidClarificationTransitionError(
          id,
          loser.status,
          'cancelled',
        );
      }
      this.recordEvent(id, current.sessionId, 'cancelled', now);
    });
    cancel();
    const cancelled = await this.getClarification(id);
    if (!cancelled) throw new ClarificationNotFoundError(id);
    return cancelled;
  }

  async listEvents(clarificationId: string): Promise<ClarificationEvent[]> {
    const rows = this.database
      .prepare(
        `SELECT id, clarification_id, session_id, event, created_at
           FROM clarification_events
          WHERE clarification_id = ?
          ORDER BY id ASC`,
      )
      .all(clarificationId) as {
      id: number;
      clarification_id: string;
      session_id: string;
      event: ClarificationEventType;
      created_at: string;
    }[];
    return rows.map((row) => ({
      id: row.id,
      clarificationId: row.clarification_id,
      sessionId: row.session_id,
      event: row.event,
      createdAt: row.created_at,
    }));
  }

  async ping(): Promise<void> {
    this.database.prepare('SELECT 1 FROM clarifications LIMIT 1').get();
  }

  private applyLazyExpiry(row: ClarificationRow): ClarificationRow {
    if (row.status !== 'pending' || !row.expires_at) return row;
    if (row.expires_at > nowIso()) return row;
    const now = nowIso();
    const expire = this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE clarifications
              SET status = 'expired', updated_at = ?, resolved_at = ?
            WHERE id = ? AND status = 'pending'`,
        )
        .run(now, now, row.id);
      this.recordEvent(row.id, row.session_id, 'expired', now);
    });
    expire();
    return { ...row, status: 'expired', updated_at: now, resolved_at: now };
  }

  private expireLapsed(sessionId?: string): void {
    const now = nowIso();
    const params: string[] = [now];
    let scope = '';
    if (sessionId !== undefined) {
      scope = ' AND session_id = ?';
      params.push(sessionId);
    }
    const lapsed = this.database
      .prepare(
        `SELECT id, session_id FROM clarifications
          WHERE status = 'pending' AND expires_at IS NOT NULL
            AND expires_at <= ?${scope}`,
      )
      .all(...params) as { id: string; session_id: string }[];
    const expire = this.database.transaction(
      (rows: { id: string; session_id: string }[]) => {
        const mark = this.database.prepare(
          `UPDATE clarifications
              SET status = 'expired', updated_at = ?, resolved_at = ?
            WHERE id = ? AND status = 'pending'`,
        );
        for (const lapsedRow of rows) {
          const info = mark.run(now, now, lapsedRow.id);
          if (info.changes > 0) {
            this.recordEvent(
              lapsedRow.id,
              lapsedRow.session_id,
              'expired',
              now,
            );
          }
        }
      },
    );
    expire(lapsed);
  }

  private recordEvent(
    clarificationId: string,
    sessionId: string,
    event: ClarificationEventType,
    at: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO clarification_events
           (clarification_id, session_id, event, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(clarificationId, sessionId, event, at);
  }
}
