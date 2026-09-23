import type { Claim } from './claim';

export interface SimilarClaim {
  claimId: string;
  /** Distance — lower is closer (RuVector convention). */
  score: number;
}

/** Thrown when the semantic surface is unavailable (fail-closed). */
export class ClaimIndexUnavailableError extends Error {
  constructor(reason: string) {
    super(`Claim index unavailable: ${reason}`);
    this.name = 'ClaimIndexUnavailableError';
  }
}

/**
 * Semantic-surface boundary. SQLite remains the system of record;
 * this index is a recall accelerator only — losing it degrades
 * retrieval, never truth. Claim text is immutable, so indexing
 * happens once per claim at commit; there is no update path.
 */
export abstract class ClaimIndex {
  abstract indexClaim(claim: Claim): Promise<void>;

  abstract searchSimilar(text: string, k: number): Promise<SimilarClaim[]>;

  abstract status(): Promise<{
    enabled: boolean;
    native?: boolean;
    count?: number;
    reason?: string;
  }>;
}
