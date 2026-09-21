import type { ToolDescriptor } from '../tools/tool-registry';

/**
 * M9c planning context: what the model needs to decide the next action
 * — the turn goal, tool policies, and total budget. Static per turn and
 * merged into the system message, never the wire tool schema (which
 * stays canonical). Step-varying state such as remaining budget belongs
 * to M9k context construction.
 */
export function buildPlanningBlock(input: {
  goal: string;
  tools: readonly ToolDescriptor[];
  maxToolSteps: number;
}): string {
  const lines = input.tools.map((tool) =>
    tool.approval === 'none'
      ? `- ${tool.name} (runs immediately)`
      : `- ${tool.name} (pauses for human approval and ends your turn)`,
  );
  return [
    '<assignment>',
    `Goal for this turn: ${input.goal.trim()}`,
    'Tools:',
    ...lines,
    `Budget: at most ${input.maxToolSteps} tool steps this turn; use tool results to decide each next step.`,
    '</assignment>',
  ].join('\n');
}
