import { Inject, Injectable } from '@nestjs/common';
import { LlmClient } from '../llm/llm.client';
import { validateCandidates } from './candidate-validation';
import { buildExtractionPrompt } from './extraction.prompt';
import {
  MemoryCandidateExtractor,
  MemoryExtractionInput,
} from './memory-candidate-extractor';
import type { ValidatedCandidate } from './memory-candidate';

/** Thrown when the extractor response is not parseable JSON. */
export class ExtractionParseError extends Error {
  constructor() {
    super('Extractor response was not parseable JSON');
    this.name = 'ExtractionParseError';
  }
}

/** DI token for the memory role's own `LlmClient` instance. */
export const MEMORY_LLM_CLIENT = 'MEMORY_LLM_CLIENT';

/**
 * LLM-backed extractor. Reuses the generic `LlmClient` (non-streaming
 * `chat`) against the memory model role — no provider-specific code.
 */
@Injectable()
export class LlmMemoryCandidateExtractor extends MemoryCandidateExtractor {
  constructor(@Inject(MEMORY_LLM_CLIENT) private readonly llm: LlmClient) {
    super();
  }

  async extract(input: MemoryExtractionInput): Promise<ValidatedCandidate[]> {
    const { content } = await this.llm.chat({
      messages: buildExtractionPrompt(input),
      sessionId: input.sessionId,
    });
    return validateCandidates(extractJson(content));
  }
}

/** Pull the largest JSON-looking span out of a chatty response. */
export function extractJson(content: string): unknown {
  const text = content.trim();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Fall through to span extraction.
  }
  const starts = [text.indexOf('['), text.indexOf('{')].filter((i) => i >= 0);
  const ends = [text.lastIndexOf(']'), text.lastIndexOf('}')].filter(
    (i) => i >= 0,
  );
  if (starts.length === 0 || ends.length === 0) {
    throw new ExtractionParseError();
  }
  const span = text.slice(Math.min(...starts), Math.max(...ends) + 1);
  try {
    return JSON.parse(span) as unknown;
  } catch {
    throw new ExtractionParseError();
  }
}
