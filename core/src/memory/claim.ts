import type { MemoryCandidateKind } from './memory-candidate';

/** Which side of the turn the evidence was mined from. */
export type ClaimOrigin = 'user' | 'agent';

/**
 * Lifecycle category. Stored in M10 from candidate kind where
 * available; per-category lifecycles are M12 — handling is uniform
 * until then.
 */
export type ClaimCategory =
  'fact' | 'preference' | 'relationship' | 'procedure';

export const CLAIM_CATEGORIES: readonly ClaimCategory[] = [
  'fact',
  'preference',
  'relationship',
  'procedure',
];

export type ClaimStatus = 'candidate' | 'active' | 'contradicted' | 'retired';

export const CLAIM_STATUSES: readonly ClaimStatus[] = [
  'candidate',
  'active',
  'contradicted',
  'retired',
];

/**
 * One evidence item behind a claim: a ledger reference plus the
 * origin it carried. References, never copies — the ledger is
 * never rewritten by belief work.
 */
export interface ClaimEvidence {
  candidateId: string;
  /** 'unknown' only for pre-role-stamp ledger rows; never defaulted. */
  role: 'user' | 'assistant' | 'unknown';
}

export interface NewClaim {
  subject: string;
  predicate: string;
  object: string;
  category: ClaimCategory;
  status: ClaimStatus;
  /** Extractor's number, stored as observed — never re-estimated. */
  extractorConfidence: number;
  /** Engine estimate, re-estimated on evidence change. */
  confidence: number;
  /** Originating evidence reference. Never rewritten by re-mining. */
  firstAssertedAt: string;
  /** Most recent supporting evidence reference. */
  lastSurfacedAt: string;
  origin: ClaimOrigin;
  evidence: ClaimEvidence[];
  entities: string[];
  promotion: string;
}

/**
 * A persisted belief record. A maintained commitment about what is
 * believed — distinct from a candidate, which is only an observation
 * about what might be worth retaining.
 *
 * Reserved fields (`sourceType`, `summary`, `related`, `timesObserved`
 * beyond its counter role, `accessCount`, `lastAccessedAt`,
 * `activation`, `locked`, `emotional`) exist so later milestones
 * need no migration. Each has exactly one future owner (see the M10
 * plan); M10 paths leave them at their defaults.
 */
export interface Claim extends NewClaim {
  id: string;
  sourceType: string | null;
  summary: string | null;
  related: string[];
  timesObserved: number;
  accessCount: number;
  lastAccessedAt: string | null;
  activation: number | null;
  locked: boolean;
  emotional: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Map a candidate kind onto a claim category (default: fact). */
export function categoryFromKind(kind: MemoryCandidateKind): ClaimCategory {
  switch (kind) {
    case 'preference':
      return 'preference';
    case 'relationship':
      return 'relationship';
    default:
      return 'fact';
  }
}
