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

export const MEMORY_CANDIDATE_KINDS: readonly MemoryCandidateKind[] = [
  'fact',
  'preference',
  'person',
  'relationship',
  'project',
  'work',
  'skill',
  'hobby',
  'interest',
  'goal',
  'decision',
  'event',
  'observation',
];

/** A candidate that passed deterministic validation. No provenance yet. */
export interface ValidatedCandidate {
  kind: MemoryCandidateKind;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  importance: number;
  stability: number;
  /**
   * Which side of the turn the extractor mined this from, per its own
   * report. 'unknown' is honest absence (old extractor versions omit
   * it) — never a default for a known side.
   */
  sourceRole: CandidateSourceRole;
}

/** Which side of the turn a candidate was mined from. */
export type CandidateSourceRole = 'user' | 'assistant' | 'unknown';

/** A validated candidate plus the provenance and extraction metadata. */
export interface NewMemoryCandidate extends ValidatedCandidate {
  source: {
    sessionId: string;
    messageId: number;
    role: CandidateSourceRole;
  };
  extractorModel: string;
  extractorVersion: string;
}

/**
 * A persisted evidence-ledger row. An observation about what might be
 * worth retaining — NOT epistemic memory, NOT a belief commitment.
 */
export interface MemoryCandidate extends NewMemoryCandidate {
  id: string;
  extractedAt: string;
}
