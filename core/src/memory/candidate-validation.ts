import { MEMORY_CANDIDATE_KINDS, ValidatedCandidate } from './memory-candidate';
import type { MemoryCandidateKind } from './memory-candidate';

const MAX_FIELD_LENGTH = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_FIELD_LENGTH) return null;
  return trimmed;
}

function cleanScore(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 0 || value > 1) return null;
  return value;
}

function cleanKind(value: unknown): MemoryCandidateKind | null {
  if (typeof value !== 'string') return null;
  const kind = value.trim().toLowerCase();
  return (MEMORY_CANDIDATE_KINDS as readonly string[]).includes(kind)
    ? (kind as MemoryCandidateKind)
    : null;
}

function validateOne(raw: unknown): ValidatedCandidate | null {
  if (!isRecord(raw)) return null;
  const kind = cleanKind(raw.kind);
  const subject = cleanText(raw.subject);
  const predicate = cleanText(raw.predicate);
  const object = cleanText(raw.object);
  const confidence = cleanScore(raw.confidence);
  const importance = cleanScore(raw.importance);
  const stability = cleanScore(raw.stability);
  if (
    !kind ||
    !subject ||
    !predicate ||
    !object ||
    confidence === null ||
    importance === null ||
    stability === null
  ) {
    return null;
  }
  return {
    kind,
    subject,
    predicate,
    object,
    confidence,
    importance,
    stability,
  };
}

/**
 * Deterministically validate raw extractor output. Accepts an array, a
 * `{ candidates: [...] }` envelope, or a single candidate object.
 * Invalid entries are dropped (never repaired); exact duplicates within
 * the result are collapsed. No importance threshold — the goal is to
 * observe what the extractor produces.
 */
export function validateCandidates(raw: unknown): ValidatedCandidate[] {
  const items: unknown[] = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.candidates)
      ? (raw.candidates as unknown[])
      : isRecord(raw)
        ? [raw]
        : [];
  const seen = new Set<string>();
  const valid: ValidatedCandidate[] = [];
  for (const item of items) {
    const candidate = validateOne(item);
    if (!candidate) continue;
    const key = [
      candidate.kind,
      candidate.subject.toLowerCase(),
      candidate.predicate.toLowerCase(),
      candidate.object.toLowerCase(),
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(candidate);
  }
  return valid;
}
