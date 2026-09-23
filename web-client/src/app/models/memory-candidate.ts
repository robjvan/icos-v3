export type MemoryCandidateKind =
  | 'fact'
  | 'preference'
  | 'person'
  | 'relationship'
  | 'project'
  | 'work'
  | 'skill'
  | 'hobby'
  | 'interest'
  | 'goal'
  | 'decision'
  | 'event'
  | 'observation';

/**
 * Persisted evidence-ledger row. Mirrors core `MemoryCandidate`
 * (`core/src/memory/memory-candidate.ts`): an observation about what might
 * be worth retaining — NOT epistemic memory, NOT a belief commitment.
 */
export interface MemoryCandidate {
  readonly id: string;
  readonly kind: MemoryCandidateKind;
  readonly subject: string;
  readonly predicate: string;
  readonly object: string;
  readonly confidence: number;
  readonly importance: number;
  readonly stability: number;
  readonly source: {
    readonly sessionId: string;
    readonly messageId: number;
  };
  readonly extractorModel: string;
  readonly extractorVersion: string;
  readonly extractedAt: string;
}

/** Mirrors core `GET /core/memory-candidates` response. */
export interface ListCandidatesResponse {
  readonly candidates: MemoryCandidate[];
}
