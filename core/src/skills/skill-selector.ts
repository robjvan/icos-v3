import type {
  SelectionBudget,
  SkillDescriptor,
  SkillMatch,
} from './skill.types';

/**
 * Turn-scoped selection seam (M7b defines it, M7c wires it). Picks which
 * discovered candidates actually load this turn. Future selectors
 * (semantic, model-assisted, learned) implement this interface without
 * re-plumbing the conversation path.
 */
export interface SkillSelector {
  select(matches: SkillMatch[], budget: SelectionBudget): SkillDescriptor[];
}

/**
 * Deterministic default: top-ranked matches up to `maxSkills`, in the
 * discovery rank order (score desc, name asc). Char budgeting
 * (`maxChars`) is enforced downstream at injection time (M7c), where body
 * sizes are known — descriptors carry no body content by design.
 */
export class TopBudgetedSelector implements SkillSelector {
  select(matches: SkillMatch[], budget: SelectionBudget): SkillDescriptor[] {
    if (budget.maxSkills <= 0) return [];
    return matches.slice(0, budget.maxSkills).map((match) => match.skill);
  }
}
