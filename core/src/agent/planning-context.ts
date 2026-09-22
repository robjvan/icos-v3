import type { ChatMessage } from '../llm/llm.client';
import type { LlmMessage } from '../llm/llm.client';
import type { ToolDescriptor } from '../tools/tool-registry';

/**
 * M9c planning context: what the model needs to decide the next action
 * — the turn goal, tool policies, and total budget. Merged into the
 * system message, never the wire tool schema (which stays canonical).
 */
export interface PlanningProgress {
  /** Proposal rounds used so far (including this one). */
  stepsUsed: number;
  /** Tool executions completed so far. */
  toolCallsUsed: number;
  /** Tool names attempted this turn, in order. */
  priorActions: readonly string[];
  /** Approval gating this run, when one exists. */
  approval?: { id: string; decision: string };
}

export function buildPlanningBlock(input: {
  goal: string;
  tools: readonly ToolDescriptor[];
  maxToolSteps: number;
  maxIterations: number;
  progress?: PlanningProgress;
}): string {
  const lines = input.tools.map((tool) =>
    tool.approval === 'none'
      ? `- ${tool.name} (runs immediately)`
      : `- ${tool.name} (pauses for human approval and ends your turn)`,
  );
  const parts = [
    '<assignment>',
    `Goal for this turn: ${input.goal.trim()}`,
    'Tools:',
    ...lines,
    `Budget: at most ${input.maxToolSteps} tool steps across ${input.maxIterations} proposal rounds this turn.`,
  ];
  // M9k: per-step progress restated every round so the model always
  // sees remaining budget and what it already tried.
  if (input.progress) {
    const remaining = Math.max(
      0,
      input.maxToolSteps - input.progress.toolCallsUsed,
    );
    const prior =
      input.progress.priorActions.length > 0
        ? input.progress.priorActions.join(', ')
        : 'none';
    const steps =
      input.progress.toolCallsUsed === 1 ? 'tool step' : 'tool steps';
    parts.push(
      `Progress: ${input.progress.toolCallsUsed} ${steps} used ` +
        `(${remaining} remaining); prior actions: ${prior}.`,
    );
    if (input.progress.approval) {
      parts.push(
        `Approval ${input.progress.approval.id}: ${input.progress.approval.decision}.`,
      );
    }
  }
  parts.push('</assignment>');
  return parts.join('\n');
}

/**
 * M9k turn assembly: one system message (base prompt plus the current
 * step's suffix), then skill blocks, history, prior pairs, the user
 * message, and this turn's new pairs — in that order. Rebuilt every
 * proposal round so the planning frame never goes stale.
 */
export function assembleTurnMessages(input: {
  baseSystem: string | undefined;
  systemExtra: string;
  rest: LlmMessage[];
  pairs: LlmMessage[];
}): LlmMessage[] {
  const system: ChatMessage =
    input.baseSystem !== undefined
      ? {
          role: 'system',
          content: `${input.baseSystem}\n\n${input.systemExtra}`,
        }
      : { role: 'system', content: input.systemExtra };
  return [system, ...input.rest, ...input.pairs];
}
