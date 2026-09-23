import { categoryFromKind } from './claim';
import { identityKey, normalizeTripleField } from './claim-identity';

describe('normalizeTripleField', () => {
  it('lowercases, trims, and collapses whitespace', () => {
    expect(normalizeTripleField('  Explicit   Provenance ')).toBe(
      'explicit provenance',
    );
  });

  it('treats underscores as separators', () => {
    expect(normalizeTripleField('working_on')).toBe('working on');
  });

  it('strips edge quotes without touching inner text', () => {
    expect(normalizeTripleField('"TypeScript"')).toBe('typescript');
  });

  it('is conservative: no stemming or synonym folding', () => {
    expect(normalizeTripleField('preferences')).not.toBe(
      normalizeTripleField('preference'),
    );
  });
});

describe('identityKey', () => {
  it('converges case/whitespace variants to one key', () => {
    const a = identityKey({
      subject: 'user',
      predicate: 'prefers',
      object: 'TypeScript',
    });
    const b = identityKey({
      subject: ' User ',
      predicate: 'PREFERS',
      object: '  typescript ',
    });
    expect(a).toBe(b);
  });

  it('distinguishes genuinely different triples', () => {
    const a = identityKey({
      subject: 'user',
      predicate: 'prefers',
      object: 'typescript',
    });
    const b = identityKey({
      subject: 'user',
      predicate: 'prefers',
      object: 'rust',
    });
    expect(a).not.toBe(b);
  });
});

describe('categoryFromKind', () => {
  it('maps preference and relationship, defaults the rest to fact', () => {
    expect(categoryFromKind('preference')).toBe('preference');
    expect(categoryFromKind('relationship')).toBe('relationship');
    expect(categoryFromKind('goal')).toBe('fact');
    expect(categoryFromKind('decision')).toBe('fact');
  });
});
