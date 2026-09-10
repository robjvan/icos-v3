import { resolve } from 'node:path';

export const CORE_CONFIG = 'CORE_CONFIG';

export interface CoreConfig {
  port: number;
  llmBaseUrl: string;
  llmModel: string;
  llmApiKey?: string;
  llmTimeoutMs: number;
  systemPrompt: string;
  maxHistory: number;
  dbPath: string;
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

  return {
    port: parsePositiveInt(env.PORT, 3000, 'PORT'),
    llmBaseUrl: (env.LLM_BASE_URL ?? 'http://localhost:11434/v1')
      .trim()
      .replace(/\/+$/, ''),
    llmModel,
    llmApiKey: (env.LLM_API_KEY ?? '').trim() || undefined,
    llmTimeoutMs: parsePositiveInt(env.LLM_TIMEOUT_MS, 60000, 'LLM_TIMEOUT_MS'),
    systemPrompt:
      (env.SYSTEM_PROMPT ?? 'You are Isabel, a helpful assistant.').trim() ||
      'You are Isabel, a helpful assistant.',
    maxHistory: parsePositiveInt(env.MAX_HISTORY, 50, 'MAX_HISTORY'),
    dbPath: resolvePath(env.CORE_DB_PATH, './data/core.sqlite'),
  };
}

function resolvePath(raw: string | undefined, fallback: string): string {
  const value = (raw ?? '').trim() || fallback;
  return resolve(process.cwd(), value);
}

export const coreConfigProvider = {
  provide: CORE_CONFIG,
  useFactory: (): CoreConfig => loadConfig(),
};
