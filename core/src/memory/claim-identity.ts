/**
 * Claim identity: the normalized (subject, predicate, object) triple.
 * Normalization is deliberately conservative — case, whitespace, and
 * edge punctuation only. Anything cleverer (morphology, synonymy) is
 * model judgment and does not belong in an identity function.
 */
export function normalizeTripleField(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, ' ')
    .replace(/^['"“”‘’`]+|['"“”‘’`]+$/g, '')
    .trim();
}

export interface Triple {
  subject: string;
  predicate: string;
  object: string;
}

/** Canonical identity key for deduplication and convergence. */
export function identityKey(triple: Triple): string {
  return [
    normalizeTripleField(triple.subject),
    normalizeTripleField(triple.predicate),
    normalizeTripleField(triple.object),
  ].join('|');
}
