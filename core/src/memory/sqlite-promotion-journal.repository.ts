/* eslint-disable @typescript-eslint/require-await --
   async is contractual (repository returns Promises);
   better-sqlite3 itself is synchronous. */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type {
  JournalState,
  PromotionJournalEntry,
  PromotionOperation,
} from './promotion';
import { JOURNAL_STATES, PROMOTION_OPERATIONS } from './promotion';
import { PromotionJournalRepository } from './promotion-journal.repository';
import { MemoryDatabaseService } from './memory-database.service';

function nowIso(): string {
  return new Date().toISOString();
}

const TERMINAL: readonly JournalState[] = ['committed', 'denied', 'failed'];

const ALLOWED: Record<JournalState, readonly JournalState[]> = {
  proposed: ['promoting', 'committed', 'denied', 'failed'],
  promoting: ['proposed', 'committed', 'denied', 'failed'],
  committed: [],
  denied: [],
  failed: [],
};

interface JournalRow {
  id: string;
  candidate_id: string;
  operation: string;
  state: string;
  approval_id: string | null;
  claim_id: string | null;
  detail: string;
  created_at: string;
  updated_at: string;
}

function toEntry(row: JournalRow): PromotionJournalEntry {
  if (!(PROMOTION_OPERATIONS as readonly string[]).includes(row.operation)) {
    throw new Error(`Journal ${row.id} has unknown operation`);
  }
  if (!(JOURNAL_STATES as readonly string[]).includes(row.state)) {
    throw new Error(`Journal ${row.id} has unknown state`);
  }
  return {
    id: row.id,
    candidateId: row.candidate_id,
    operation: row.operation as PromotionOperation,
    state: row.state as JournalState,
    approvalId: row.approval_id,
    claimId: row.claim_id,
    detail: row.detail,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class SqlitePromotionJournalRepository extends PromotionJournalRepository {
  constructor(private readonly databaseService: MemoryDatabaseService) {
    super();
  }

  private get database(): Database.Database {
    return this.databaseService.connection;
  }

  private rowById(id: string): JournalRow | undefined {
    return this.database
      .prepare('SELECT * FROM promotion_journal WHERE id = ?')
      .get(id) as JournalRow | undefined;
  }

  async recordProposal(input: {
    candidateId: string;
    operation: PromotionOperation;
    approvalId?: string;
    detail?: string;
  }): Promise<PromotionJournalEntry> {
    const existing = this.database
      .prepare('SELECT * FROM promotion_journal WHERE candidate_id = ?')
      .get(input.candidateId) as JournalRow | undefined;
    if (existing) return toEntry(existing);
    const id = randomUUID();
    const now = nowIso();
    this.database
      .prepare(
        `INSERT INTO promotion_journal
           (id, candidate_id, operation, state,
            approval_id, claim_id, detail, created_at, updated_at)
         VALUES (?, ?, ?, 'proposed', ?, NULL, ?, ?, ?)`,
      )
      .run(
        id,
        input.candidateId,
        input.operation,
        input.approvalId ?? null,
        input.detail ?? '',
        now,
        now,
      );
    const row = this.rowById(id);
    if (!row) throw new Error(`Journal ${id} vanished after insert`);
    return toEntry(row);
  }

  async getEntry(id: string): Promise<PromotionJournalEntry | null> {
    const row = this.rowById(id);
    return row ? toEntry(row) : null;
  }

  async getByCandidate(
    candidateId: string,
  ): Promise<PromotionJournalEntry | null> {
    const row = this.database
      .prepare('SELECT * FROM promotion_journal WHERE candidate_id = ?')
      .get(candidateId) as JournalRow | undefined;
    return row ? toEntry(row) : null;
  }

  async listByState(states: JournalState[]): Promise<PromotionJournalEntry[]> {
    if (states.length === 0) return [];
    const placeholders = states.map(() => '?').join(', ');
    const rows = this.database
      .prepare(
        `SELECT * FROM promotion_journal WHERE state IN (${placeholders}) ORDER BY rowid ASC`,
      )
      .all(...states) as JournalRow[];
    return rows.map(toEntry);
  }

  async listByClaimId(claimId: string): Promise<PromotionJournalEntry[]> {
    const rows = this.database
      .prepare(
        'SELECT * FROM promotion_journal WHERE claim_id = ? ORDER BY rowid ASC',
      )
      .all(claimId) as JournalRow[];
    return rows.map(toEntry);
  }

  async setState(
    id: string,
    state: JournalState,
    options?: {
      operation?: PromotionOperation;
      claimId?: string;
      detail?: string;
    },
  ): Promise<PromotionJournalEntry | null> {
    const row = this.rowById(id);
    if (!row) return null;
    const current = toEntry(row);
    if (current.state === state && !options?.operation && !options?.claimId) {
      return current;
    }
    if (
      TERMINAL.includes(current.state) ||
      !ALLOWED[current.state].includes(state)
    ) {
      return null;
    }
    this.database
      .prepare(
        `UPDATE promotion_journal
            SET state = ?,
                operation = COALESCE(?, operation),
                claim_id = COALESCE(?, claim_id),
                detail = COALESCE(?, detail),
                updated_at = ?
          WHERE id = ?`,
      )
      .run(
        state,
        options?.operation ?? null,
        options?.claimId ?? null,
        options?.detail ?? null,
        nowIso(),
        id,
      );
    const updated = this.rowById(id);
    if (!updated) throw new Error(`Journal ${id} vanished during update`);
    return toEntry(updated);
  }

  async ping(): Promise<void> {
    this.database.prepare('SELECT 1').get();
  }
}
