import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { LlmClient } from '../llm/llm.client';
import type { LlmEndpointConfig } from '../llm/llm.client';
import { MEMORY_LLM_CLIENT } from '../memory/llm-memory-candidate-extractor';

/** Map the LLM_* role configuration to endpoint values. */
export function conversationEndpointConfig(
  config: CoreConfig,
): LlmEndpointConfig {
  return {
    provider: config.provider,
    llmBaseUrl: config.llmBaseUrl,
    llmModel: config.llmModel,
    llmApiKey: config.llmApiKey,
    headers: config.llmHeaders,
    userAgent: config.userAgent,
    llmTimeoutMs: config.llmTimeoutMs,
  };
}

/** Map the MEMORY_* role configuration to endpoint values. */
export function memoryEndpointConfig(config: CoreConfig): LlmEndpointConfig {
  return {
    provider: config.memoryProvider,
    llmBaseUrl: config.memoryLlmBaseUrl,
    llmModel: config.memoryLlmModel,
    llmApiKey: config.memoryLlmApiKey,
    headers: config.memoryLlmHeaders,
    userAgent: config.memoryUserAgent,
    llmTimeoutMs: config.memoryLlmTimeoutMs,
  };
}

/**
 * The conversation role's client instance, mapped from the LLM_*
 * configuration. Same mapping shape as the memory role below.
 */
export const conversationLlmClientProvider = {
  provide: LlmClient,
  useFactory: (config: CoreConfig): LlmClient =>
    new LlmClient(conversationEndpointConfig(config)),
  inject: [CORE_CONFIG],
};

/**
 * The memory role's own client instance, built from the MEMORY_* config.
 * Same generic client class as conversation — different values, so the
 * two roles never share a provider, model, endpoint, or timeout unless
 * explicitly configured to.
 */
export const memoryLlmClientProvider = {
  provide: MEMORY_LLM_CLIENT,
  useFactory: (config: CoreConfig): LlmClient =>
    new LlmClient(memoryEndpointConfig(config)),
  inject: [CORE_CONFIG],
};
