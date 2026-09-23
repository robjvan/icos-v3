/** Skill catalog descriptor. Mirrors core `SkillsController.list` items. */
export interface SkillDescriptor {
  readonly name: string;
  readonly description: string;
  readonly version: string;
}

export interface SkippedSkill {
  readonly name: string;
  readonly reason: string;
}

/** Mirrors core `GET /core/skills` response. */
export interface SkillListResponse {
  readonly enabled: boolean;
  readonly skills: SkillDescriptor[];
  readonly skipped: SkippedSkill[];
}

export interface SkillMatch {
  readonly name: string;
  readonly score: number;
  readonly matchedOn: string[];
}

/** Mirrors core `GET /core/skills/discover?q=` response. */
export interface SkillDiscoverResponse {
  readonly query: string;
  readonly matches: SkillMatch[];
}

/** Mirrors core `GET /core/skills/active?sessionId=` response. */
export interface SkillActiveResponse {
  readonly sessionId: string;
  readonly explicit: string[];
  readonly requested: string[];
  readonly contextual: string[];
  readonly lastTurn: unknown;
}

/** Mirrors core `GET /core/skills/:name` response. */
export interface SkillBody {
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly body: string;
}
