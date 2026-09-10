import type { ChatMessage } from '../llm/llm.client';

export interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionSummary {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  /** First 80 chars of the first user message, if any. Computed, not stored. */
  preview?: string;
}

export interface MessageRecord {
  id: number;
  sessionId: string;
  role: string;
  content: string;
  createdAt: string;
}

export interface SessionSearchResult {
  sessionId: string;
  messageId: number;
  role: string;
  content: string;
  createdAt: string;
}

/** Thrown when the FTS5 query itself is invalid (caller error, not a crash). */
export class InvalidSearchQueryError extends Error {
  constructor(query: string) {
    super(`Invalid search query: "${query}"`);
    this.name = 'InvalidSearchQueryError';
  }
}

/**
 * Transcript persistence boundary. `ConversationService` (via
 * `SessionStore`) must not know SQL exists. SQLite is the
 * implementation; this is not a generic database framework.
 */
export abstract class SessionRepository {
  abstract createSession(id: string): Promise<void>;

  abstract getSession(id: string): Promise<Session | null>;

  abstract appendMessage(
    sessionId: string,
    message: ChatMessage,
  ): Promise<MessageRecord>;

  abstract getMessages(
    sessionId: string,
    options?: { limit?: number; beforeId?: number },
  ): Promise<ChatMessage[]>;

  abstract listSessions(options?: {
    limit?: number;
    offset?: number;
  }): Promise<SessionSummary[]>;

  abstract searchMessages(
    query: string,
    options?: { limit?: number; sessionId?: string },
  ): Promise<SessionSearchResult[]>;

  /** Rebuild the FTS index from canonical `messages` data. */
  abstract rebuildSearchIndex(): Promise<void>;
}
