import type { SkillDescriptor, SkillMatch } from './skill.types';

/**
 * Deterministic skill discovery (M7b). Matches caller input against skill
 * names and descriptions only — no embeddings, no vectors, no LLM.
 *
 * Pure function: descriptors + input ⇒ ranked matches. Never reads bodies,
 * never mutates state. Same input + same catalog ⇒ byte-identical output.
 *
 * Scoring (documented, deliberately simple):
 * - each distinct input token scoring a name-substring hit: +2 (matchedOn name)
 * - else each distinct token scoring a description-substring hit: +1
 * - tokens shorter than MIN_TOKEN_CHARS are ignored (single letters would
 *   match nearly every description and drown the ranking)
 * - rank: score desc, then name asc. Zero-score skills never match.
 */
export const DISCOVERY_DEFAULT_LIMIT = 5;
const MIN_TOKEN_CHARS = 2;
const NAME_HIT_SCORE = 2;
const DESCRIPTION_HIT_SCORE = 1;

export function tokenizeInput(input: string): string[] {
  const tokens = new Set<string>();
  for (const token of input.toLowerCase().split(/[^a-z0-9]+/)) {
    if (token.length >= MIN_TOKEN_CHARS) tokens.add(token);
  }
  return [...tokens];
}

export function discoverSkills(
  descriptors: SkillDescriptor[],
  input: string,
  limit: number = DISCOVERY_DEFAULT_LIMIT,
): SkillMatch[] {
  const tokens = tokenizeInput(input);
  if (tokens.length === 0 || limit <= 0) return [];
  const matches: SkillMatch[] = [];
  for (const skill of descriptors) {
    const name = skill.name.toLowerCase();
    const description = skill.description.toLowerCase();
    let score = 0;
    const matchedOn = new Set<'name' | 'description'>();
    for (const token of tokens) {
      if (name.includes(token)) {
        score += NAME_HIT_SCORE;
        matchedOn.add('name');
      } else if (description.includes(token)) {
        score += DESCRIPTION_HIT_SCORE;
        matchedOn.add('description');
      }
    }
    if (score > 0) {
      matches.push({ skill, score, matchedOn: [...matchedOn] });
    }
  }
  matches.sort(
    (a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name),
  );
  return matches.slice(0, limit);
}
