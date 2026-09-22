import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const CORE_CONFIG = 'CORE_CONFIG';

export interface CoreConfig {
  port: number;
  provider: string;
  llmBaseUrl: string;
  llmModel: string;
  llmApiKey?: string;
  llmHeaders?: Record<string, string>;
  userAgent?: string;
  llmTimeoutMs: number;
  systemPrompt: string;
  maxHistory: number;
  sessionDbPath: string;
  memoryDbPath: string;
  /**
   * Pre-split single-file database, probed once as a migration source.
   * Explicit CORE_DB_PATH wins; otherwise the historical default
   * ./data/core.sqlite. Never written to; ignored when absent.
   */
  legacyDbPath: string;
  memoryExtractionEnabled: boolean;
  memoryProvider: string;
  memoryLlmBaseUrl: string;
  memoryLlmModel: string;
  memoryLlmApiKey?: string;
  memoryLlmHeaders?: Record<string, string>;
  memoryUserAgent?: string;
  memoryLlmTimeoutMs: number;
  /** Filesystem skill catalog root (M7). One `<name>/SKILL.md` per skill. */
  skillsDirPath: string;
  /** Kill-switch: false restores pre-M7 behavior exactly. */
  skillsEnabled: boolean;
  /** Per-skill body cap, applied after trimming. */
  skillsMaxBodyChars: number;
  /** Cap on catalog summaries injected into model context. */
  skillsMaxCatalogItems: number;
  /** Cap on explicitly session-pinned skills. */
  skillsMaxActivePerSession: number;
  /** Cap on automatically loaded skills per turn (provisional). */
  skillsMaxAutoLoadedPerTurn: number;
  /** Cap on total skill-body chars injected per turn (provisional). */
  skillsMaxContextChars: number;
  /** Max proposal rounds per turn (M9g execution budget). */
  agentMaxIterations: number;
  /** Max tool executions per turn (M9g execution budget). */
  agentMaxToolSteps: number;
  /** Backstop turn duration in ms (M9g execution budget). */
  agentMaxTurnDurationMs: number;
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  name: string,
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer (got "${raw}")`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CoreConfig {
  const llmModel = (env.LLM_MODEL ?? '').trim();
  if (!llmModel) {
    throw new Error(
      'LLM_MODEL is required (e.g. LLM_MODEL=llama3.1). See .env.sample.',
    );
  }
  const llmBaseUrl = (env.LLM_BASE_URL ?? 'http://localhost:11434/v1')
    .trim()
    .replace(/\/+$/, '');

  return {
    port: parsePositiveInt(env.PORT, 3000, 'PORT'),
    provider: (env.LLM_PROVIDER ?? 'ollama').trim().toLowerCase() || 'ollama',
    llmBaseUrl,
    llmModel,
    llmApiKey: (env.LLM_API_KEY ?? '').trim() || undefined,
    llmHeaders: parseHeaders(env.LLM_HEADERS, 'LLM_HEADERS'),
    userAgent: (env.LLM_USER_AGENT ?? '').trim() || undefined,
    llmTimeoutMs: parsePositiveInt(env.LLM_TIMEOUT_MS, 60000, 'LLM_TIMEOUT_MS'),
    systemPrompt:
      (env.SYSTEM_PROMPT ?? 'You are Isabel, a helpful assistant.').trim() ||
      'You are Isabel, a helpful assistant.',
    maxHistory: parsePositiveInt(env.MAX_HISTORY, 50, 'MAX_HISTORY'),
    sessionDbPath: resolvePath(env.SESSION_DB_PATH, '~/.icos/data/sessions.db'),
    memoryDbPath: resolvePath(env.MEMORY_DB_PATH, '~/.icos/data/memories.db'),
    legacyDbPath: resolveLegacyDbPath(env.CORE_DB_PATH),
    memoryExtractionEnabled: parseBoolean(env.MEMORY_EXTRACTION_ENABLED, true),
    // Each falls back to its primary counterpart: the extraction role has
    // an explicit boundary (own client, own values) with zero-config default.
    memoryProvider:
      (env.MEMORY_PROVIDER ?? '').trim().toLowerCase() ||
      (env.LLM_PROVIDER ?? 'ollama').trim().toLowerCase() ||
      'ollama',
    memoryLlmBaseUrl: (env.MEMORY_LLM_BASE_URL ?? llmBaseUrl)
      .trim()
      .replace(/\/+$/, ''),
    memoryLlmModel: (env.MEMORY_LLM_MODEL ?? '').trim() || llmModel,
    memoryLlmApiKey:
      (env.MEMORY_LLM_API_KEY ?? env.LLM_API_KEY ?? '').trim() || undefined,
    memoryLlmHeaders: parseHeaders(
      env.MEMORY_LLM_HEADERS ?? env.LLM_HEADERS,
      'MEMORY_LLM_HEADERS',
    ),
    memoryUserAgent:
      (env.MEMORY_USER_AGENT ?? env.LLM_USER_AGENT ?? '').trim() || undefined,
    memoryLlmTimeoutMs: parsePositiveInt(
      env.MEMORY_LLM_TIMEOUT_MS,
      60000,
      'MEMORY_LLM_TIMEOUT_MS',
    ),
    skillsDirPath: resolvePath(env.SKILLS_DIR_PATH, '~/.icos/skills'),
    skillsEnabled: parseBoolean(env.SKILLS_ENABLED, true),
    skillsMaxBodyChars: parsePositiveInt(
      env.SKILLS_MAX_BODY_CHARS,
      12000,
      'SKILLS_MAX_BODY_CHARS',
    ),
    skillsMaxCatalogItems: parsePositiveInt(
      env.SKILLS_MAX_CATALOG_ITEMS,
      50,
      'SKILLS_MAX_CATALOG_ITEMS',
    ),
    skillsMaxActivePerSession: parsePositiveInt(
      env.SKILLS_MAX_ACTIVE_PER_SESSION,
      5,
      'SKILLS_MAX_ACTIVE_PER_SESSION',
    ),
    skillsMaxAutoLoadedPerTurn: parsePositiveInt(
      env.SKILLS_MAX_AUTO_LOADED_PER_TURN,
      2,
      'SKILLS_MAX_AUTO_LOADED_PER_TURN',
    ),
    skillsMaxContextChars: parsePositiveInt(
      env.SKILLS_MAX_CONTEXT_CHARS,
      8000,
      'SKILLS_MAX_CONTEXT_CHARS',
    ),
    agentMaxIterations: parsePositiveInt(
      env.AGENT_MAX_ITERATIONS,
      5,
      'AGENT_MAX_ITERATIONS',
    ),
    agentMaxToolSteps: parsePositiveInt(
      env.AGENT_MAX_TOOL_STEPS,
      5,
      'AGENT_MAX_TOOL_STEPS',
    ),
    agentMaxTurnDurationMs: parsePositiveInt(
      env.AGENT_MAX_TURN_DURATION_MS,
      15 * 60 * 1000,
      'AGENT_MAX_TURN_DURATION_MS',
    ),
  };
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = raw.trim().toLowerCase();
  if (value === 'true' || value === '1' || value === 'yes') return true;
  if (value === 'false' || value === '0' || value === 'no') return false;
  throw new Error(`Expected a boolean (got "${raw}")`);
}

/**
 * Arbitrary static headers from a JSON object string, e.g.
 * `{"HTTP-Referer": "https://example.com", "X-Title": "My App"}`.
 * Keys/values must be non-empty strings.
 */
function parseHeaders(
  raw: string | undefined,
  name: string,
): Record<string, string> | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${name} must be a JSON object of string values`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object of string values`);
  }
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!key.trim() || typeof value !== 'string' || !value.trim()) {
      throw new Error(`${name} must be a JSON object of string values`);
    }
    headers[key.trim()] = value.trim();
  }
  return headers;
}

function resolvePath(raw: string | undefined, fallback: string): string {
  const value = (raw ?? '').trim() || fallback;
  if (value === '~') return homedir();
  const expanded = value.startsWith('~/')
    ? join(homedir(), value.slice(2))
    : value;
  return resolve(process.cwd(), expanded);
}

function resolveLegacyDbPath(raw: string | undefined): string {
  const value = (raw ?? '').trim();
  if (value) return resolvePath(value, value);
  return resolve(process.cwd(), './data/core.sqlite');
}

export const coreConfigProvider = {
  provide: CORE_CONFIG,
  useFactory: (): CoreConfig => loadConfig(),
};
