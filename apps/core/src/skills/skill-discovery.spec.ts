import type { SkillDescriptor } from './skill.types';
import { discoverSkills, tokenizeInput } from './skill-discovery';

function descriptor(name: string, description: string): SkillDescriptor {
  return { name, description, version: '0.0.0' };
}

const CATALOG: SkillDescriptor[] = [
  descriptor(
    'icos-v3-stack',
    'Architecture and conventions of the ICOS v3 stack.',
  ),
  descriptor('daily-journal', 'Capture the day as a structured journal entry.'),
  descriptor('capture-idea', 'Capture an idea in the knowledge base.'),
  descriptor(
    'comments-pass',
    'Swagger and JSDoc comment pass over a codebase.',
  ),
];

describe('tokenizeInput', () => {
  it('lowercases and splits on non-alphanumerics', () => {
    expect(tokenizeInput('Working on ICOS-v3 stack!')).toEqual([
      'working',
      'on',
      'icos',
      'v3',
      'stack',
    ]);
  });

  it('drops single-character noise tokens', () => {
    expect(tokenizeInput('a I x')).toEqual([]);
  });

  it('dedupes repeated tokens', () => {
    expect(tokenizeInput('stack stack STACK')).toEqual(['stack']);
  });
});

describe('discoverSkills', () => {
  it('matches the demo anchor query to icos-v3-stack', () => {
    const matches = discoverSkills(CATALOG, 'working on the ICOS v3 stack');
    expect(matches[0]?.skill.name).toBe('icos-v3-stack');
    expect(matches[0]?.matchedOn).toContain('name');
  });

  it('ranks name hits above description hits', () => {
    const catalog = [
      descriptor('journal-club', 'A reading group.'),
      descriptor('unrelated', 'Daily journal prompts.'),
    ];
    const matches = discoverSkills(catalog, 'journal');
    expect(matches.map((m) => m.skill.name)).toEqual([
      'journal-club',
      'unrelated',
    ]);
    expect(matches[0]?.score).toBeGreaterThan(matches[1]?.score ?? 0);
    expect(matches[0]?.matchedOn).toEqual(['name']);
    expect(matches[1]?.matchedOn).toEqual(['description']);
  });

  it('sums multi-token partial credit', () => {
    const matches = discoverSkills(CATALOG, 'capture idea knowledge');
    expect(matches[0]?.skill.name).toBe('capture-idea');
    // capture(name) + idea(name) + knowledge(description) = 2+2+1
    expect(matches[0]?.score).toBe(5);
  });

  it('breaks score ties alphabetically', () => {
    const catalog = [
      descriptor('zebra-skill', 'Common description.'),
      descriptor('alpha-skill', 'Common description.'),
    ];
    expect(discoverSkills(catalog, 'common').map((m) => m.skill.name)).toEqual([
      'alpha-skill',
      'zebra-skill',
    ]);
  });

  it('is deterministic across runs', () => {
    const first = discoverSkills(CATALOG, 'icos stack journal idea');
    const second = discoverSkills(CATALOG, 'icos stack journal idea');
    expect(second).toEqual(first);
  });

  it('returns empty for blank or unmatched input — never everything', () => {
    expect(discoverSkills(CATALOG, '')).toEqual([]);
    expect(discoverSkills(CATALOG, '   ')).toEqual([]);
    expect(discoverSkills(CATALOG, 'bread baking sourdough')).toEqual([]);
    expect(discoverSkills(CATALOG, 'a')).toEqual([]);
  });

  it('bounds results to the limit (default 5)', () => {
    const catalog = Array.from({ length: 8 }, (_, i) =>
      descriptor(`skill-${String(i).padStart(2, '0')}`, 'Shared skill token.'),
    );
    expect(discoverSkills(catalog, 'skill')).toHaveLength(5);
    expect(discoverSkills(catalog, 'skill', 3)).toHaveLength(3);
    expect(discoverSkills(catalog, 'skill', 0)).toEqual([]);
  });

  it('is case-insensitive on both sides', () => {
    const matches = discoverSkills(CATALOG, 'DAILY-JOURNAL');
    expect(matches[0]?.skill.name).toBe('daily-journal');
  });
});
