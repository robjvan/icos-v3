/* eslint-disable @typescript-eslint/require-await --
   async mirrors the SessionRepository contract under test. */
import type { ChatMessage } from '../llm/llm.client';
import { SessionRepository } from '../session/session.repository';
import type {
  MessageRecord,
  Session,
  SessionSearchResult,
  SessionSummary,
} from '../session/session.repository';

/**
 * In-memory `SessionRepository` for store/service specs.
 * Behavior mirrors the SQLite implementation (idempotent create,
 * chronological ordering, newest-first listing); search is a naive
 * substring stand-in — real FTS5 behavior is covered in
 * `sqlite-session.repository.spec.ts`.
 */
export class FakeSessionRepository extends SessionRepository {
  private readonly sessions = new Map<
    string,
    { createdAt: string; updatedAt: string; title?: string }
  >();
  private readonly records: MessageRecord[] = [];
  private nextId = 1;

  async createSession(id: string): Promise<void> {
    if (!this.sessions.has(id)) {
      const now = new Date().toISOString();
      this.sessions.set(id, { createdAt: now, updatedAt: now });
    }
  }

  async getSession(id: string): Promise<Session | null> {
    const session = this.sessions.get(id);
    return session ? { id, ...session } : null;
  }

  async appendMessage(
    sessionId: string,
    message: ChatMessage,
  ): Promise<MessageRecord> {
    const record: MessageRecord = {
      id: this.nextId++,
      sessionId,
      role: message.role,
      content: message.content,
      createdAt: new Date().toISOString(),
      excludedFromContext: false,
    };
    this.records.push(record);
    const session = this.sessions.get(sessionId);
    if (session) session.updatedAt = record.createdAt;
    return record;
  }

  async getMessages(
    sessionId: string,
    options?: { limit?: number; beforeId?: number },
  ): Promise<ChatMessage[]> {
    const beforeId = options?.beforeId;
    let messages = this.records.filter(
      (record) =>
        record.sessionId === sessionId &&
        !record.excludedFromContext &&
        (beforeId === undefined || record.id < beforeId),
    );
    if (options?.limit !== undefined) {
      messages = messages.slice(-options.limit);
    }
    return messages.map(
      (record) =>
        ({
          role: record.role,
          content: record.content,
        }) as ChatMessage,
    );
  }

  async getMessageRecords(
    sessionId: string,
    options?: { limit?: number; beforeId?: number },
  ): Promise<MessageRecord[]> {
    const beforeId = options?.beforeId;
    let messages = this.records.filter(
      (record) =>
        record.sessionId === sessionId &&
        (beforeId === undefined || record.id < beforeId),
    );
    if (options?.limit !== undefined) {
      messages = messages.slice(-options.limit);
    }
    return messages.map((record) => ({ ...record }));
  }

  async excludeLastTurn(sessionId: string): Promise<number[] | null> {
    const own = this.records.filter(
      (record) => record.sessionId === sessionId && !record.excludedFromContext,
    );
    const lastUserIdx = own.map((record) => record.role).lastIndexOf('user');
    if (lastUserIdx === -1) return null;
    const ids: number[] = [];
    for (let i = lastUserIdx; i < own.length; i++) {
      if (i !== lastUserIdx && own[i].role === 'user') break;
      own[i].excludedFromContext = true;
      ids.push(own[i].id);
    }
    return ids;
  }

  async forkSession(sourceId: string, newId: string): Promise<void> {
    const source = this.sessions.get(sourceId);
    if (!source) throw new Error(`Unknown session "${sourceId}"`);
    const now = new Date().toISOString();
    this.sessions.set(newId, {
      createdAt: now,
      updatedAt: now,
      ...(source.title ? { title: source.title } : {}),
    });
    for (const record of this.records.filter((r) => r.sessionId === sourceId)) {
      this.records.push({ ...record, id: this.nextId++, sessionId: newId });
    }
  }

  async renameSession(id: string, title: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    const trimmed = title.trim();
    if (trimmed) session.title = trimmed;
    else delete session.title;
    session.updatedAt = new Date().toISOString();
  }

  async ping(): Promise<void> {
    // In-memory: always alive.
  }

  async listSessions(options?: {
    limit?: number;
    offset?: number;
  }): Promise<SessionSummary[]> {
    const summaries = [...this.sessions.entries()].map(([id, session]) => {
      const own = this.records.filter((record) => record.sessionId === id);
      const firstUser = own.find((record) => record.role === 'user');
      return {
        sessionId: id,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: own.length,
        title: session.title,
        preview: firstUser?.content.slice(0, 80),
      };
    });
    summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 20;
    return summaries.slice(offset, offset + limit);
  }

  async searchMessages(
    query: string,
    options?: { limit?: number; sessionId?: string },
  ): Promise<SessionSearchResult[]> {
    const needle = query.toLowerCase();
    const limit = options?.limit ?? 20;
    return this.records
      .filter(
        (record) =>
          record.content.toLowerCase().includes(needle) &&
          (options?.sessionId === undefined ||
            record.sessionId === options.sessionId),
      )
      .slice(0, limit)
      .map((record) => ({
        sessionId: record.sessionId,
        messageId: record.id,
        role: record.role,
        content: record.content,
        createdAt: record.createdAt,
      }));
  }

  async rebuildSearchIndex(): Promise<void> {
    // No derived index to rebuild.
  }
}
