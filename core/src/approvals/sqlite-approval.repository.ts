/* eslint-disable @typescript-eslint/require-await --
   async is contractual (ApprovalRepository returns Promises);
   better-sqlite3 itself is synchronous. */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { SessionDatabaseService } from '../session/session-database.service';
import {
  ApprovalNotFoundError,
  ApprovalRepository,
  InvalidApprovalTransitionError,
} from './approval.repository';
import type {
  ApprovalEvent,
  ApprovalEventType,
  ApprovalRequest,
  ApprovalStatus,
  NewApproval,
} from './approval.repository';

function nowIso(): string {
  return new Date().toISOString();
}

interface ApprovalRow {
  id: string;
  session_id: string;
  action: string;
  description: string;
  status: ApprovalStatus;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  resolved_at: string | null;
}

function toRequest(row: ApprovalRow): ApprovalRequest {
  return {
    id: row.id,
    sessionId: row.session_id,
    action: row.action,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
    ...(row.resolved_at ? { resolvedAt: row.resolved_at } : {}),
  };
}

@Injectable()
export class SqliteApprovalRepository extends ApprovalRepository {
  constructor(private readonly databaseService: SessionDatabaseService) {
    super();
  }

  private get database(): Database.Database {
    return this.databaseService.connection;
  }

  async createApproval(input: NewApproval): Promise<ApprovalRequest> {
    const now = nowIso();
    const id = randomUUID();
    const create = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO approvals
             (id, session_id, action, description, status,
              created_at, updated_at, expires_at)
           VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
        )
        .run(
          id,
          input.sessionId,
          input.action,
          input.description ?? '',
          now,
          now,
          input.expiresAt ?? null,
        );
      this.recordEvent(id, input.sessionId, 'created', now);
    });
    create();
    const created = await this.getApproval(id);
    if (!created) throw new ApprovalNotFoundError(id);
    return created;
  }

  async getApproval(id: string): Promise<ApprovalRequest | null> {
    const row = this.database
      .prepare('SELECT * FROM approvals WHERE id = ?')
      .get(id) as ApprovalRow | undefined;
    if (!row) return null;
    return toRequest(this.applyLazyExpiry(row));
  }

  async listApprovals(options?: {
    sessionId?: string;
    status?: ApprovalStatus;
  }): Promise<ApprovalRequest[]> {
    // Expire-then-list so lapsed requests never surface as pending.
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
        `SELECT * FROM approvals` +
          (clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '') +
          ` ORDER BY created_at ASC, id ASC`,
      )
      .all(...params) as ApprovalRow[];
    return rows.map(toRequest);
  }

  async resolveApproval(
    id: string,
    to: Exclude<ApprovalStatus, 'pending' | 'expired'>,
  ): Promise<ApprovalRequest> {
    const row = this.database
      .prepare('SELECT * FROM approvals WHERE id = ?')
      .get(id) as ApprovalRow | undefined;
    if (!row) throw new ApprovalNotFoundError(id);
    const current = toRequest(this.applyLazyExpiry(row));
    if (current.status !== 'pending') {
      throw new InvalidApprovalTransitionError(id, current.status, to);
    }
    const now = nowIso();
    const resolve = this.database.transaction(() => {
      const info = this.database
        .prepare(
          `UPDATE approvals
              SET status = ?, updated_at = ?, resolved_at = ?
            WHERE id = ? AND status = 'pending'`,
        )
        .run(to, now, now, id);
      if (info.changes === 0) {
        const loser = this.database
          .prepare('SELECT status FROM approvals WHERE id = ?')
          .get(id) as { status: ApprovalStatus };
        throw new InvalidApprovalTransitionError(id, loser.status, to);
      }
      this.recordEvent(id, current.sessionId, to, now);
    });
    resolve();
    const resolved = await this.getApproval(id);
    if (!resolved) throw new ApprovalNotFoundError(id);
    return resolved;
  }

  async listEvents(approvalId: string): Promise<ApprovalEvent[]> {
    const rows = this.database
      .prepare(
        `SELECT id, approval_id, session_id, event, created_at
           FROM approval_events
          WHERE approval_id = ?
          ORDER BY id ASC`,
      )
      .all(approvalId) as {
      id: number;
      approval_id: string;
      session_id: string;
      event: ApprovalEventType;
      created_at: string;
    }[];
    return rows.map((row) => ({
      id: row.id,
      approvalId: row.approval_id,
      sessionId: row.session_id,
      event: row.event,
      createdAt: row.created_at,
    }));
  }

  async ping(): Promise<void> {
    this.database.prepare('SELECT 1 FROM approvals LIMIT 1').get();
  }

  /**
   * Flip a single lapsed row to `expired` (with event) and return the
   * fresh row. No background sweeper: expiry is evaluated on every
   * read, so the stored state is always current when observed.
   */
  private applyLazyExpiry(row: ApprovalRow): ApprovalRow {
    if (row.status !== 'pending' || !row.expires_at) return row;
    if (row.expires_at > nowIso()) return row;
    const now = nowIso();
    const expire = this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE approvals
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
        `SELECT id, session_id FROM approvals
          WHERE status = 'pending' AND expires_at IS NOT NULL
            AND expires_at <= ?${scope}`,
      )
      .all(...params) as { id: string; session_id: string }[];
    const expire = this.database.transaction(
      (rows: { id: string; session_id: string }[]) => {
        const mark = this.database.prepare(
          `UPDATE approvals
              SET status = 'expired', updated_at = ?, resolved_at = ?
            WHERE id = ? AND status = 'pending'`,
        );
        for (const lapsedRow of rows) {
          // `changes` guards the concurrent-expiry race: only the
          // transition that lands records the event.
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
    approvalId: string,
    sessionId: string,
    event: ApprovalEventType,
    at: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO approval_events
           (approval_id, session_id, event, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(approvalId, sessionId, event, at);
  }
}
