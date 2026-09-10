import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { LlmClient } from '../llm/llm.client';
import { MEMORY_LLM_CLIENT } from '../memory/llm-memory-candidate-extractor';

/**
 * The memory role's own client instance, built from the MEMORY_* config.
 * Same generic client class as conversation — different values, so the
 * two roles never share a provider, model, endpoint, or timeout unless
 * explicitly configured to.
 */
export const memoryLlmClientProvider = {
  provide: MEMORY_LLM_CLIENT,
  useFactory: (config: CoreConfig): LlmClient =>
    new LlmClient({
      llmBaseUrl: config.memoryLlmBaseUrl,
      llmModel: config.memoryLlmModel,
      llmApiKey: config.memoryLlmApiKey,
      llmTimeoutMs: config.memoryLlmTimeoutMs,
    }),
  inject: [CORE_CONFIG],
};
