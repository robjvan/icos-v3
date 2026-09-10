import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const CORE_CONFIG = 'CORE_CONFIG';

export interface CoreConfig {
  port: number;
  llmBaseUrl: string;
  llmModel: string;
  llmApiKey?: string;
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
  memoryLlmBaseUrl: string;
  memoryLlmModel: string;
  memoryLlmApiKey?: string;
  memoryLlmTimeoutMs: number;
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
    llmBaseUrl,
    llmModel,
    llmApiKey: (env.LLM_API_KEY ?? '').trim() || undefined,
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
    memoryLlmBaseUrl: (env.MEMORY_LLM_BASE_URL ?? llmBaseUrl)
      .trim()
      .replace(/\/+$/, ''),
    memoryLlmModel: (env.MEMORY_LLM_MODEL ?? '').trim() || llmModel,
    memoryLlmApiKey:
      (env.MEMORY_LLM_API_KEY ?? env.LLM_API_KEY ?? '').trim() || undefined,
    memoryLlmTimeoutMs: parsePositiveInt(
      env.MEMORY_LLM_TIMEOUT_MS,
      60000,
      'MEMORY_LLM_TIMEOUT_MS',
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
