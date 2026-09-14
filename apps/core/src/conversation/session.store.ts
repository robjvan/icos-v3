import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import type { ChatMessage } from '../llm/llm.client';
import { SessionRepository } from '../session/session.repository';
import type {
  MessageRecord,
  Session,
  SessionSearchResult,
  SessionSummary,
} from '../session/session.repository';

/** Transcript message plus its reversible exclusion marker. */
export interface HistoryMessage extends ChatMessage {
  excludedFromContext: boolean;
  createdAt: string;
}

/**
 * Core-facing session abstraction. Knows sessions, history windows,
 * and search — never SQL. Persistence lives in `SessionRepository`.
 *
 * Storage is unlimited for practical purposes; `config.maxHistory`
 * bounds only what reaches the LLM, never what is kept.
 */
@Injectable()
export class SessionStore {
  constructor(
    private readonly repository: SessionRepository,
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
  ) {}

  /** Resolve to an existing session or create a new one. */
  async resolve(sessionId?: string): Promise<{ id: string; isNew: boolean }> {
    if (sessionId) {
      const existing = await this.repository.getSession(sessionId);
      if (!existing) {
        await this.repository.createSession(sessionId);
        return { id: sessionId, isNew: true };
      }
      return { id: sessionId, isNew: false };
    }
    const id = randomUUID();
    await this.repository.createSession(id);
    return { id, isNew: true };
  }

  async append(
    sessionId: string,
    message: ChatMessage,
  ): Promise<MessageRecord> {
    return this.repository.appendMessage(sessionId, message);
  }

  /** Recent window for LLM context construction (bounded by maxHistory). */
  async getContextMessages(sessionId: string): Promise<ChatMessage[]> {
    return this.repository.getMessages(sessionId, {
      limit: this.config.maxHistory,
    });
  }

  /**
   * Complete transcript including reversibly excluded rows.
   * `undefined` when the session does not exist.
   */
  async getHistory(sessionId: string): Promise<HistoryMessage[] | undefined> {
    const session = await this.repository.getSession(sessionId);
    if (!session) return undefined;
    const records = await this.repository.getMessageRecords(sessionId);
    return records.map(
      (record) =>
        ({
          role: record.role,
          content: record.content,
          excludedFromContext: record.excludedFromContext,
          createdAt: record.createdAt,
        }) as HistoryMessage,
    );
  }

  async getSession(sessionId: string): Promise<Session | null> {
    return this.repository.getSession(sessionId);
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    await this.repository.renameSession(sessionId, title);
  }

  async excludeLastTurn(sessionId: string): Promise<number[] | null> {
    return this.repository.excludeLastTurn(sessionId);
  }

  async forkSession(sourceId: string): Promise<string> {
    const id = randomUUID();
    await this.repository.forkSession(sourceId, id);
    return id;
  }

  async pingStores(): Promise<void> {
    await this.repository.ping();
  }

  async listSessions(options?: {
    limit?: number;
    offset?: number;
  }): Promise<SessionSummary[]> {
    return this.repository.listSessions(options);
  }

  searchMessages(
    query: string,
    options?: { limit?: number; sessionId?: string },
  ): Promise<SessionSearchResult[]> {
    return this.repository.searchMessages(query, options);
  }
}
