import { ChatMessage } from '../llm/llm.client';

/**
 * Smallest useful representation of the current situation (core.md:
 * "Context is constructed, not accumulated"). Milestone 1 inputs are
 * system prompt + bounded history + current user message only.
 * Memory recall, tasks, observations, and tool state join here later.
 */
export function buildContext(
  systemPrompt: string,
  history: ChatMessage[],
  input: string,
  maxHistory: number,
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const prompt = systemPrompt.trim();
  if (prompt) {
    messages.push({ role: 'system', content: prompt });
  }
  messages.push(...history.slice(-maxHistory));
  messages.push({ role: 'user', content: input });
  return messages;
}
