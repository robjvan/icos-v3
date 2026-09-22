/** Session row. Mirrors core `SessionSummary` (session.repository.ts). */
export interface SessionSummary {
  readonly sessionId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messageCount: number;
  /** Explicit title when set, else first 80 chars of first user message. */
  readonly title?: string;
  /** First 80 chars of the first user message, if any. Computed, not stored. */
  readonly preview?: string;
}

export interface ListSessionsResponse {
  readonly sessions: SessionSummary[];
}

/** FTS5 hit. Mirrors core `SessionSearchResult` (session.repository.ts). */
export interface SessionSearchResult {
  readonly sessionId: string;
  readonly messageId: number;
  readonly role: string;
  readonly content: string;
  readonly createdAt: string;
}

export interface SearchSessionsResponse {
  readonly results: SessionSearchResult[];
}

export interface ConversationHistoryResponse {
  readonly sessionId: string;
  readonly messages: {
    readonly role: string;
    readonly content: string;
    readonly excludedFromContext: boolean;
    readonly createdAt: string;
  }[];
}
