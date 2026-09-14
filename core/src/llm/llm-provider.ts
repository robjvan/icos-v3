import { createRequire } from 'node:module';
import type { ChatMessage, LlmEndpointConfig } from './llm.client';

/**
 * Provider id prefix that opts into OpenCode session affinity.
 * Matched case-insensitively: `opencode`, `opencode-zen`, `opencode-go`,
 * or any future OpenCode-family id.
 */
export const OPENCODE_PROVIDER_ID = 'opencode';

export const OPENCODE_SESSION_HEADER = 'x-opencode-session';

export interface LlmRequestContext {
  sessionId?: string;
}

/**
 * Request contract. Conversation identity travels explicitly so the
 * client can mint provider metadata (e.g. session-affinity headers)
 * without inspecting sessions, databases, or HTTP internals.
 */
export interface LlmChatRequest {
  messages: ChatMessage[];
  sessionId?: string;
}

export function isSessionAffinityProvider(provider: string): boolean {
  const id = provider.trim().toLowerCase();
  return (
    id === OPENCODE_PROVIDER_ID || id.startsWith(`${OPENCODE_PROVIDER_ID}-`)
  );
}

/**
 * Header construction layer: base + auth + static extras + UA +
 * request metadata. Explicit static `headers` win over derived values.
 * The ONLY provider-conditional behavior is the OpenCode session
 * header, gated here in one place.
 */
export function buildRequestHeaders(
  config: LlmEndpointConfig,
  context?: LlmRequestContext,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': config.userAgent ?? defaultUserAgent(),
  };
  if (config.llmApiKey) {
    headers['Authorization'] = `Bearer ${config.llmApiKey}`;
  }
  Object.assign(headers, config.headers);
  const sessionId = context?.sessionId?.trim();
  if (sessionId && isSessionAffinityProvider(config.provider)) {
    headers[OPENCODE_SESSION_HEADER] = sessionId;
  }
  return headers;
}

let cachedUserAgent: string | null = null;

export function defaultUserAgent(): string {
  if (!cachedUserAgent) {
    cachedUserAgent = `icos/${packageVersion()}`;
  }
  return cachedUserAgent;
}

function packageVersion(): string {
  try {
    const require = createRequire(__filename);
    const pkg = require('../package.json') as { version?: unknown };
    if (typeof pkg.version === 'string' && pkg.version) return pkg.version;
  } catch {
    // Fall through to the static fallback.
  }
  return '0.0.0';
}
