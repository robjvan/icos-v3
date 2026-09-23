import type { Claim, ClaimEvidence, ClaimStatus, NewClaim } from './claim';
import type { Triple } from './claim-identity';

/**
 * Belief-store boundary. Persists claims derived from the evidence
 * ledger — it never extracts, never promotes on its own, and never
 * touches ledger rows. M10d may add a vector-backed implementation
 * behind this same interface; consumers must not assume SQLite.
 */
export abstract class ClaimRepository {
  abstract createClaim(claim: NewClaim): Promise<Claim>;

  abstract getClaim(id: string): Promise<Claim | null>;

  /** Find by normalized triple identity (dedup / convergence). */
  abstract findByTriple(triple: Triple): Promise<Claim | null>;

  /**
   * REINFORCE: append evidence, touch lastSurfacedAt, bump
   * timesObserved. Never rewrites firstAssertedAt or origin.
   */
  abstract appendEvidence(
    id: string,
    evidence: ClaimEvidence[],
    confidence: number,
  ): Promise<Claim | null>;

  /**
   * Status transition with lifecycle enforcement:
   * candidate → active, active → contradicted, any → retired.
   * Returns null when the claim is missing or the transition illegal.
   */
  abstract setStatus(id: string, status: ClaimStatus): Promise<Claim | null>;

  abstract listClaims(options?: {
    status?: ClaimStatus;
    limit?: number;
  }): Promise<Claim[]>;

  /** Cheap liveness probe for health checks. */
  abstract ping(): Promise<void>;
}
