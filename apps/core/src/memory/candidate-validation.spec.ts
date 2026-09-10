import { validateCandidates } from './candidate-validation';

const good = {
  kind: 'preference',
  subject: 'user',
  predicate: 'prefers',
  object: 'TypeScript',
  confidence: 0.94,
  importance: 0.72,
  stability: 0.88,
};

describe('validateCandidates', () => {
  it('accepts a well-formed candidate, trimming text', () => {
    expect(validateCandidates([{ ...good, subject: '  user  ' }])).toEqual([
      { ...good, subject: 'user' },
    ]);
  });

  it('accepts envelope and single-object shapes', () => {
    expect(validateCandidates({ candidates: [good] })).toHaveLength(1);
    expect(validateCandidates(good)).toHaveLength(1);
  });

  it('normalizes kind casing', () => {
    expect(
      validateCandidates([{ ...good, kind: 'Decision' }])[0],
    ).toMatchObject({ kind: 'decision' });
  });

  it.each([
    ['unknown kind', { ...good, kind: 'vibe' }],
    ['missing subject', { ...good, subject: '   ' }],
    ['missing predicate', { ...good, predicate: '' }],
    ['missing object', { ...good, object: null }],
    ['confidence above range', { ...good, confidence: 1.5 }],
    ['confidence below range', { ...good, confidence: -0.1 }],
    ['non-numeric importance', { ...good, importance: 'high' }],
    ['NaN stability', { ...good, stability: NaN }],
    ['absurdly long object', { ...good, object: 'x'.repeat(501) }],
    ['non-object entry', 'just a string'],
    ['null entry', null],
  ])('rejects %s', (_label, raw) => {
    expect(validateCandidates([raw])).toHaveLength(0);
  });

  it('rejects non-array, non-object input', () => {
    expect(validateCandidates('nope')).toHaveLength(0);
    expect(validateCandidates(42)).toHaveLength(0);
    expect(validateCandidates(null)).toHaveLength(0);
  });

  it('collapses exact duplicates within one result', () => {
    const dupe = { ...good, subject: 'USER' };
    expect(validateCandidates([good, dupe, { ...good }])).toHaveLength(1);
  });

  it('keeps distinct candidates from one turn', () => {
    const project = {
      kind: 'project',
      subject: 'user',
      predicate: 'working_on',
      object: 'ICOS v3',
      confidence: 0.99,
      importance: 0.91,
      stability: 0.95,
    };
    expect(validateCandidates([good, project])).toHaveLength(2);
  });
});
