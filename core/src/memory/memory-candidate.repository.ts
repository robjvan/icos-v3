import type { MemoryCandidate, NewMemoryCandidate } from './memory-candidate';

/**
 * Evidence-ledger boundary. Persists extraction observations with
 * provenance — it never judges, promotes, or consolidates them.
 * That is future epistemic work.
 */
export abstract class MemoryCandidateRepository {
  abstract saveCandidates(
    candidates: NewMemoryCandidate[],
  ): Promise<MemoryCandidate[]>;

  /** Fetch one ledger row by id; null when unknown (never invent). */
  abstract getCandidate(id: string): Promise<MemoryCandidate | null>;

  abstract listCandidates(
    sessionId?: string,
    options?: { limit?: number },
  ): Promise<MemoryCandidate[]>;

  /** Cheap liveness probe for health checks. */
  abstract ping(): Promise<void>;
}
