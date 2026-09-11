import type { ChatMessage } from '../llm/llm.client';

export interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** Explicit title via `/rename`. Undefined when never set. */
  title?: string;
}

export interface SessionSummary {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  /** Explicit title when set, else first 80 chars of first user message. */
  title?: string;
  /** First 80 chars of the first user message, if any. Computed, not stored. */
  preview?: string;
}

export interface MessageRecord {
  id: number;
  sessionId: string;
  role: string;
  content: string;
  createdAt: string;
  /**
   * Reversible `/undo` marker. Excluded rows stay in the transcript
   * (evidence is never destroyed) but leave LLM context construction.
   */
  excludedFromContext: boolean;
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

  /**
   * Full message records including the reversible exclusion marker.
   * Transcript views use this; LLM context uses `getMessages`.
   */
  abstract getMessageRecords(
    sessionId: string,
    options?: { limit?: number; beforeId?: number },
  ): Promise<MessageRecord[]>;

  /**
   * Reversibly exclude the most recent included turn (last user message
   * plus following assistant messages) from LLM context. Returns the
   * excluded message ids, or `null` when no included turn exists.
   * Transcript rows are flagged, never deleted.
   */
  abstract excludeLastTurn(sessionId: string): Promise<number[] | null>;

  /**
   * Copy a session's transcript (roles, order, exclusion flags) into a
   * new session row. Source untouched; message ids are fresh.
   */
  abstract forkSession(sourceId: string, newId: string): Promise<void>;

  /** Set the explicit session title. Empty/blank clears it. */
  abstract renameSession(id: string, title: string): Promise<void>;

  /** Cheap liveness probe for health checks. */
  abstract ping(): Promise<void>;

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
