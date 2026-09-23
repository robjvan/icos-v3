import type {
  JournalState,
  PromotionJournalEntry,
  PromotionOperation,
} from './promotion';

/**
 * Promotion-journal boundary. Exactly-once machinery for candidate →
 * belief promotion: one row per proposed candidate, approval id as
 * idempotency key, crash-recoverable states. Terminal states
 * (committed/denied/failed) never transition.
 */
export abstract class PromotionJournalRepository {
  /**
   * Record a proposal. Idempotent per candidate: proposing twice
   * returns the existing row instead of duplicating.
   */
  abstract recordProposal(input: {
    candidateId: string;
    operation: PromotionOperation;
    approvalId?: string;
    detail?: string;
  }): Promise<PromotionJournalEntry>;

  abstract getEntry(id: string): Promise<PromotionJournalEntry | null>;

  abstract getByCandidate(
    candidateId: string,
  ): Promise<PromotionJournalEntry | null>;

  abstract listByState(
    states: JournalState[],
  ): Promise<PromotionJournalEntry[]>;

  /** Trace a claim back to the journal rows that built it. */
  abstract listByClaimId(claimId: string): Promise<PromotionJournalEntry[]>;

  /**
   * Transition a row. Returns null when missing, terminal, or the
   * transition is illegal (promoting rows may return to proposed
   * for recovery replay).
   */
  abstract setState(
    id: string,
    state: JournalState,
    options?: {
      operation?: PromotionOperation;
      claimId?: string;
      detail?: string;
    },
  ): Promise<PromotionJournalEntry | null>;

  /** Cheap liveness probe for health checks. */
  abstract ping(): Promise<void>;
}
