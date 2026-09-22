import { Injectable } from '@angular/core';
import {
  APPROVALS_ENDPOINT,
  CLARIFICATIONS_ENDPOINT,
  CONVERSATION_ENDPOINT,
  SERVER_URL,
  SESSIONS_ENDPOINT,
} from '../../constants';

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`;
}

async function readJson<T>(response: Response, what: string): Promise<T> {
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const data = (await response.json()) as { message?: string };
      detail = data.message ?? detail;
    } catch {
      // Non-JSON error body; keep the status text.
    }
    throw new Error(`${what} failed: ${detail}`);
  }
  return (await response.json()) as T;
}

/**
 * Thin `fetch` wrapper over the core REST API (non-streaming calls).
 * Streaming turns live in `ConversationStreamService` (fetch + ReadableStream).
 */
@Injectable({ providedIn: 'root' })
export class CoreApiService {
  async get<T>(endpoint: string, params?: Record<string, string | number>): Promise<T> {
    const url = new URL(joinUrl(SERVER_URL, endpoint));
    for (const [key, value] of Object.entries(params ?? {})) {
      url.searchParams.set(key, String(value));
    }
    const response = await fetch(url.toString());
    return readJson<T>(response, `GET ${endpoint}`);
  }

  async post<T>(endpoint: string, body: unknown): Promise<T> {
    const response = await fetch(joinUrl(SERVER_URL, endpoint), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return readJson<T>(response, `POST ${endpoint}`);
  }

  conversationUrl(suffix: '' | '/stream' | '/resume' | '/resume-stream'): string {
    return joinUrl(SERVER_URL, `${CONVERSATION_ENDPOINT}${suffix}`);
  }

  sessionsUrl(): string {
    return joinUrl(SERVER_URL, SESSIONS_ENDPOINT);
  }

  approvalsUrl(): string {
    return joinUrl(SERVER_URL, APPROVALS_ENDPOINT);
  }

  clarificationsUrl(): string {
    return joinUrl(SERVER_URL, CLARIFICATIONS_ENDPOINT);
  }
}
