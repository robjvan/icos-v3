import { buildContext } from './context.builder';
import { ChatMessage } from '../llm/llm.client';

describe('buildContext', () => {
  it('assembles system prompt + history + input in order', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ];
    expect(buildContext('sys', history, 'c', 50)).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ]);
  });

  it('omits the system message when the prompt is blank', () => {
    expect(buildContext('  ', [], 'hi', 50)).toEqual([
      { role: 'user', content: 'hi' },
    ]);
  });

  it('bounds history to maxHistory', () => {
    const history: ChatMessage[] = Array.from({ length: 10 }, (_, i) => ({
      role: 'user' as const,
      content: `m${i}`,
    }));
    const result = buildContext('sys', history, 'new', 4);
    expect(result.map((m) => m.content)).toEqual([
      'sys',
      'm6',
      'm7',
      'm8',
      'm9',
      'new',
    ]);
  });
});
