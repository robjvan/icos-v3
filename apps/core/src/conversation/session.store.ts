import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import type { ChatMessage } from '../llm/llm.client';

/**
 * In-memory session history. Lost on restart by design (Milestone 1).
 * Persistence is an explicit future milestone.
 */
@Injectable()
export class SessionStore {
  private readonly sessions = new Map<string, ChatMessage[]>();

  constructor(@Inject(CORE_CONFIG) private readonly config: CoreConfig) {}

  /** Resolve to an existing session or create a new one. */
  resolve(sessionId?: string): { id: string; isNew: boolean } {
    if (sessionId) {
      if (!this.sessions.has(sessionId)) {
        this.sessions.set(sessionId, []);
        return { id: sessionId, isNew: true };
      }
      return { id: sessionId, isNew: false };
    }
    const id = randomUUID();
    this.sessions.set(id, []);
    return { id, isNew: true };
  }

  append(sessionId: string, message: ChatMessage): void {
    const history = this.sessions.get(sessionId) ?? [];
    history.push(message);
    this.sessions.set(sessionId, history.slice(-this.config.maxHistory));
  }

  get(sessionId: string): ChatMessage[] | undefined {
    return this.sessions.get(sessionId);
  }
}
