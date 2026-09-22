import { ToolRegistry } from '../tools/tool-registry';
import { assembleTurnMessages, buildPlanningBlock } from './planning-context';

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

  it('restates remaining budget, prior actions, and approval', () => {
    const block = buildPlanningBlock({
      goal: 'find teal',
      tools,
      maxToolSteps: 5,
      maxIterations: 5,
      progress: {
        stepsUsed: 2,
        toolCallsUsed: 1,
        priorActions: ['session.search'],
        approval: { id: 'appr-1', decision: 'approved' },
      },
    });
    expect(block).toContain('1 tool step used (4 remaining)');
    expect(block).toContain('prior actions: session.search');
    expect(block).toContain('Approval appr-1: approved.');
  });

  it('renders empty progress without an approval line', () => {
    const block = buildPlanningBlock({
      goal: 'find teal',
      tools,
      maxToolSteps: 5,
      maxIterations: 5,
      progress: { stepsUsed: 0, toolCallsUsed: 0, priorActions: [] },
    });
    expect(block).toContain('0 tool steps used (5 remaining)');
    expect(block).toContain('prior actions: none.');
    expect(block).not.toContain('Approval');
  });
});

describe('assembleTurnMessages', () => {
  it('orders system, skills, tail, then pairs', () => {
    const messages = assembleTurnMessages({
      baseSystem: 'prompt',
      systemExtra: 'extra',
      rest: [
        { role: 'system', content: 'skill' },
        { role: 'user', content: 'hi' },
      ],
      pairs: [{ role: 'tool', callId: 'c1', content: '{}' }],
    });
    expect(messages.map((m) => m.role)).toEqual([
      'system',
      'system',
      'user',
      'tool',
    ]);
    expect(messages[0]).toEqual({
      role: 'system',
      content: 'prompt\n\nextra',
    });
  });

  it('stages a system message when no base prompt exists', () => {
    const messages = assembleTurnMessages({
      baseSystem: undefined,
      systemExtra: 'extra',
      rest: [],
      pairs: [],
    });
    expect(messages).toEqual([{ role: 'system', content: 'extra' }]);
  });
});
