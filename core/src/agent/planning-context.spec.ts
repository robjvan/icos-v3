import { ToolRegistry } from '../tools/tool-registry';
import { buildPlanningBlock } from './planning-context';

const tools = new ToolRegistry().list();

describe('buildPlanningBlock', () => {
  it('frames the goal with tool policies and the step budget', () => {
    const block = buildPlanningBlock({
      goal: 'find teal',
      tools,
      maxToolSteps: 5,
      maxIterations: 5,
    });
    expect(block).toContain('Goal for this turn: find teal');
    expect(block).toContain('- session.search (runs immediately)');
    expect(block).toContain(
      '- session.rename (pauses for human approval and ends your turn)',
    );
    expect(block).toContain('at most 5 tool steps across 5 proposal rounds');
  });

  it('trims the goal and tolerates an empty tool list', () => {
    const block = buildPlanningBlock({
      goal: '  spaced out  ',
      tools: [],
      maxToolSteps: 5,
      maxIterations: 5,
    });
    expect(block).toContain('Goal for this turn: spaced out');
    expect(block).toContain('Tools:\n');
  });
});
