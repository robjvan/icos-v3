/**
 * Derivation operations. Every promotion is exactly one of NEW
 * (no claim shares the triple), REINFORCE (triple exists —
 * append evidence), or CONTRADICT (same subject+predicate, new
 * object — old claim recorded, never rewritten).
 */
export type PromotionOperation = 'NEW' | 'REINFORCE' | 'CONTRADICT';

export const PROMOTION_OPERATIONS: readonly PromotionOperation[] = [
  'NEW',
  'REINFORCE',
  'CONTRADICT',
];

/**
 * Journal lifecycle. proposed = awaiting approval (or auto pickup);
 * promoting = execution claimed the row; committed/denied/failed are
 * terminal. Recovery resets promoting → proposed; terminal states
 * never transition.
 */
export type JournalState =
  'proposed' | 'promoting' | 'committed' | 'denied' | 'failed';

export const JOURNAL_STATES: readonly JournalState[] = [
  'proposed',
  'promoting',
  'committed',
  'denied',
  'failed',
];

export interface PromotionJournalEntry {
  id: string;
  candidateId: string;
  /** Intent at proposal; updated to the actual operation on commit. */
  operation: PromotionOperation;
  state: JournalState;
  /** Null for automatic promotions (default-off, config-gated). */
  approvalId: string | null;
  claimId: string | null;
  /** Intent-vs-actual notes, conflict ids, failure reasons. */
  detail: string;
  createdAt: string;
  updatedAt: string;
}

export interface SweepSummary {
  new: number;
  reinforced: number;
  contradicted: number;
  denied: number;
  failed: number;
  skipped: number;
}

export const EMPTY_SWEEP: SweepSummary = {
  new: 0,
  reinforced: 0,
  contradicted: 0,
  denied: 0,
  failed: 0,
  skipped: 0,
};
