/**
 * Skill type contracts (M7). Skills are versioned prompt bundles on disk;
 * discovery finds them, loading reads them, activation scopes them, and
 * context construction makes them available to the model. Memory is not
 * involved. See `.reference/plans/milestone-7-skills.md`.
 */

/** Catalog metadata — obtainable without reading any skill body. */
export interface SkillDescriptor {
  name: string;
  description: string;
  version: string;
}

/** A fully loaded skill, body injected verbatim when in context. */
export interface LoadedSkill extends SkillDescriptor {
  /** Raw Markdown body (trimmed). */
  body: string;
  /** Approx. size for budgeting (char length; token estimate derived). */
  bodyChars: number;
}

/** A skill skipped at scan time, with a machine-readable reason. */
export interface SkillSkipped {
  name: string;
  reason: string;
}

/** Outcome of one `SkillService.refresh()` scan. */
export interface SkillLoadReport {
  dir: string;
  scanned: number;
  loaded: number;
  skipped: SkillSkipped[];
}

/** One deterministic discovery candidate (M7b). Discovery is pure:
 * input + registry ⇒ matches. It never mutates runtime state. */
export interface SkillMatch {
  skill: SkillDescriptor;
  score: number;
  matchedOn: Array<'name' | 'description'>;
}

/** Budget governing per-turn skill selection (M7c). */
export interface SelectionBudget {
  maxSkills: number;
  maxChars: number;
}

/** Scope of a skill injected into model context (delimiter-visible). */
export type SkillScope = 'explicit' | 'turn-explicit' | 'contextual';

/** Per-session record of the most recent turn's skill usage (M7c).
 * Memory-only observability — never persisted, never a memory event. */
export interface TurnSkillReport {
  sessionId: string;
  /** Session-pinned names injected (`/skills use`). */
  explicit: string[];
  /** Automatically discovered names injected (this turn only). */
  contextual: string[];
  /** Explicitly requested one-shot names injected (this turn only). */
  requested: string[];
  /** Discovery candidates admitted or budget-rejected. */
  considered: SkillMatch[];
  /** Injected body chars per scope, summed at injection time. */
  chars: { explicit: number; requested: number; contextual: number };
}
