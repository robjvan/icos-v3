import type { ChatMessage } from '../llm/llm.client';
import type { LoadedSkill, SkillScope } from '../skills/skill.types';

export interface ContextSkills {
  /** Prebuilt catalog block (names + descriptions); empty when disabled. */
  catalog: string;
  /** Session-pinned bodies, injected first. */
  explicit: LoadedSkill[];
  /** Staged one-shot bodies, injected second. */
  requested: LoadedSkill[];
  /** Auto-discovered bodies in selector rank order, injected third. */
  contextual: LoadedSkill[];
}

/**
 * Smallest useful representation of the current situation (core.md:
 * "Context is constructed, not accumulated"). Milestone 1 inputs are
 * system prompt + bounded history + current user message only.
 * Memory recall, tasks, observations, and tool state join here later.
 *
 * Skills (M7c) enter as system-scope, delimited, verbatim prompt data —
 * session-pinned first (alphabetical), then requested one-shots
 * (alphabetical), then contextual discoveries (selector rank order).
 * Skill names match ^[a-z0-9-]+$, so the delimiter attribute cannot break
 * out. Omitting `skills` yields byte-identical pre-M7 context.
 */
export function buildContext(
  systemPrompt: string,
  history: ChatMessage[],
  input: string,
  maxHistory: number,
  skills?: ContextSkills,
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const prompt = systemPrompt.trim();
  const catalog = skills?.catalog.trim() ?? '';
  const system = [prompt, catalog].filter((part) => part !== '').join('\n\n');
  if (system) {
    messages.push({ role: 'system', content: system });
  }
  const scoped: Array<{ skill: LoadedSkill; scope: SkillScope }> = [
    ...[...(skills?.explicit ?? [])]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((skill) => ({ skill, scope: 'explicit' as const })),
    ...[...(skills?.requested ?? [])]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((skill) => ({ skill, scope: 'turn-explicit' as const })),
    ...(skills?.contextual ?? []).map((skill) => ({
      skill,
      scope: 'contextual' as const,
    })),
  ];
  for (const { skill, scope } of scoped) {
    messages.push({
      role: 'system',
      content: `<skill name="${skill.name}" scope="${scope}">\n${skill.body}\n</skill>`,
    });
  }
  messages.push(...history.slice(-maxHistory));
  messages.push({ role: 'user', content: input });
  return messages;
}
