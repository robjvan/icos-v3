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

  abstract listCandidates(
    sessionId?: string,
    options?: { limit?: number },
  ): Promise<MemoryCandidate[]>;
}
