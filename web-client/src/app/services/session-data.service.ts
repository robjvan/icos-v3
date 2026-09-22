import { Injectable, inject } from '@angular/core';
import {
  APPROVALS_ENDPOINT,
  CLARIFICATIONS_ENDPOINT,
  CONVERSATION_ENDPOINT,
  SESSIONS_ENDPOINT,
} from '../../constants';
import type { Approval, ApprovalDecision, ListApprovalsResponse } from '../models/approval';
import type {
  Clarification,
  ListClarificationsResponse,
} from '../models/clarification';
import type {
  ConversationHistoryResponse,
  ListSessionsResponse,
  SearchSessionsResponse,
  SessionSearchResult,
  SessionSummary,
} from '../models/session';
import { CoreApiService } from './core-api.service';

const SESSION_LIST_LIMIT = 50;

/**
 * Session history + search. Auxiliary surface: callers keep chat working
 * when these fail (same policy as the test client).
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly api = inject(CoreApiService);

  async listSessions(): Promise<SessionSummary[]> {
    const data = await this.api.get<ListSessionsResponse>(SESSIONS_ENDPOINT, {
      limit: SESSION_LIST_LIMIT,
    });
    return data.sessions;
  }

  async searchSessions(query: string): Promise<SessionSearchResult[]> {
    const data = await this.api.get<SearchSessionsResponse>(`${SESSIONS_ENDPOINT}/search`, {
      q: query,
      limit: SESSION_LIST_LIMIT,
    });
    return data.results;
  }

  async history(sessionId: string): Promise<ConversationHistoryResponse> {
    return this.api.get<ConversationHistoryResponse>(`${CONVERSATION_ENDPOINT}/${sessionId}`);
  }
}

/** Pending approvals + approve/reject/cancel. Auxiliary surface (see above). */
@Injectable({ providedIn: 'root' })
export class ApprovalService {
  private readonly api = inject(CoreApiService);

  async listPending(sessionId: string): Promise<Approval[]> {
    const data = await this.api.get<ListApprovalsResponse>(APPROVALS_ENDPOINT, {
      sessionId,
      status: 'pending',
    });
    return data.approvals;
  }

  async resolve(id: string, decision: ApprovalDecision, sessionId: string): Promise<unknown> {
    return this.api.post(`${APPROVALS_ENDPOINT}/${id}/${decision}`, { sessionId });
  }
}

/** Pending clarifications + answer/cancel. Auxiliary surface (see above). */
@Injectable({ providedIn: 'root' })
export class ClarificationService {
  private readonly api = inject(CoreApiService);

  async listPending(sessionId: string): Promise<Clarification[]> {
    const data = await this.api.get<ListClarificationsResponse>(CLARIFICATIONS_ENDPOINT, {
      sessionId,
      status: 'pending',
    });
    return data.clarifications;
  }

  async answer(id: string, sessionId: string, answer: string): Promise<unknown> {
    return this.api.post(`${CLARIFICATIONS_ENDPOINT}/${id}/answer`, { sessionId, answer });
  }

  async cancel(id: string, sessionId: string): Promise<unknown> {
    return this.api.post(`${CLARIFICATIONS_ENDPOINT}/${id}/cancel`, { sessionId });
  }
}
