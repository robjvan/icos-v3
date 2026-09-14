import type { ChatMessage } from '../llm/llm.client';
import type { ValidatedCandidate } from './memory-candidate';

export interface MemoryExtractionInput {
  sessionId: string;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  context?: ChatMessage[];
}

/**
 * Boundary between Core and candidate extraction. Core depends on this
 * interface — never on the LLM implementation behind it.
 */
export abstract class MemoryCandidateExtractor {
  abstract extract(input: MemoryExtractionInput): Promise<ValidatedCandidate[]>;
}
