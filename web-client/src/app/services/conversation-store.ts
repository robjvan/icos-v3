import { Injectable, inject, signal } from '@angular/core';
import type { Approval } from '../models/approval';
import type { ApprovalDecision } from '../models/approval';
import type { Clarification } from '../models/clarification';
import type { ChatMessage, MessageRole } from '../models/message';
import type { SessionSummary, SessionSearchResult } from '../models/session';
import type { ParkedResume, StreamEvent } from '../models/stream-event';
import {
  ApprovalService,
  ClarificationService,
  SessionService,
} from './session-data.service';
import { ConversationStreamService } from './conversation-stream.service';

const SESSION_LIST_GUARD = 'Sidebar is auxiliary; chat must keep working.';
const MAX_PROCESSING_RESUMES = 10;
const PROCESSING_RETRY_DELAY_MS = 1000;

function asMessageRole(role: string): MessageRole {
  return role === 'user' || role === 'system' ? role : 'assistant';
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Chat state: transcript, pending stream bubble, auxiliaries, and the
 * parked-turn table. Semantics mirror `core/test-client.html` exactly:
 * `pendingResumes` parks `approval_required` turns and resumes exactly once
 * on resolve (approve AND reject); `processing` polls `resume-stream`
 * bounded ≤10 × 1s and never re-executes; `command.kind === 'session'`
 * resets the pane; sidebar/approval/question failures never break chat.
 */
@Injectable({ providedIn: 'root' })
export class ConversationStore {
  private readonly streams = inject(ConversationStreamService);
  private readonly sessionsApi = inject(SessionService);
  private readonly approvalsApi = inject(ApprovalService);
  private readonly clarificationsApi = inject(ClarificationService);

  readonly sessionId = signal<string | null>(null);
  readonly messages = signal<ChatMessage[]>([
    { role: 'system', content: 'Core online.', excludedFromContext: false, createdAt: nowIso() },
  ]);
  readonly busy = signal(false);
  readonly sessions = signal<SessionSummary[]>([]);
  readonly searchQuery = signal('');
  readonly searchResults = signal<SessionSearchResult[] | null>(null);
  readonly approvals = signal<Approval[]>([]);
  readonly clarifications = signal<Clarification[]>([]);

  /** Pending stream bubble text; null when no turn is in flight. */
  readonly pendingText = signal<string | null>(null);
  /** True while waiting for the first token (test-client `typing` class). */
  readonly pendingTyping = signal(false);

  /** Parked tool turns: approvalId -> durable request. Consumed exactly once. */
  private readonly pendingResumes = new Map<string, ParkedResume>();

  hasPendingResume(approvalId: string): boolean {
    return this.pendingResumes.has(approvalId);
  }

  newSession(): void {
    this.sessionId.set(null);
    this.messages.set([
      { role: 'system', content: 'New session.', excludedFromContext: false, createdAt: nowIso() },
    ]);
    this.pendingText.set(null);
    this.pendingTyping.set(false);
    this.approvals.set([]);
    this.clarifications.set([]);
  }

  async openSession(id: string): Promise<void> {
    this.sessionId.set(id);
    this.messages.set([]);
    this.pendingText.set(null);
    this.pendingTyping.set(false);
    try {
      const history = await this.sessionsApi.history(id);
      this.messages.set(
        history.messages.map((m) => ({
          role: asMessageRole(m.role),
          content: m.content,
          excludedFromContext: m.excludedFromContext,
          createdAt: m.createdAt,
        })),
      );
    } catch (error) {
      this.appendMessage('system', `Error: ${error instanceof Error ? error.message : String(error)}`);
    }
    await this.refreshApprovals();
    await this.refreshQuestions();
  }

  async sendMessage(text: string): Promise<void> {
    const message = text.trim();
    if (!message || this.busy()) {
      return;
    }
    this.appendMessage('user', message);
    this.busy.set(true);
    this.startPending('Thinking...');
    try {
      await this.streams.streamTurn(message, this.sessionId(), {
        onEvent: (event) => this.handleEvent(event, { resumes: 0 }),
        onError: (error) => this.failPending(error),
      });
    } finally {
      this.busy.set(false);
    }
    await this.refreshSessions();
    await this.refreshApprovals();
    await this.refreshQuestions();
  }

  async resolveApproval(id: string, decision: ApprovalDecision): Promise<void> {
    const session = this.sessionId();
    try {
      if (session) {
        await this.approvalsApi.resolve(id, decision, session);
      }
    } catch {
      // Fall through to refresh; failures stay visible as pending.
    }
    await this.refreshApprovals();

    // A resolved tool approval unparks its turn. Resume works for approve
    // and reject alike; unknown ids mean no parked turn exists.
    const parked = this.pendingResumes.get(id);
    if (parked) {
      this.pendingResumes.delete(id);
      await this.resumeTurn(parked.requestId, parked.sessionId);
    }
  }

  async answerQuestion(id: string, answer: string): Promise<void> {
    const session = this.sessionId();
    if (!answer || !session) {
      return;
    }
    try {
      await this.clarificationsApi.answer(id, session, answer);
    } catch {
      // Fall through to refresh; failures stay visible as pending.
    }
    await this.refreshQuestions();
  }

  async cancelQuestion(id: string): Promise<void> {
    const session = this.sessionId();
    if (!session) {
      return;
    }
    try {
      await this.clarificationsApi.cancel(id, session);
    } catch {
      // Fall through to refresh.
    }
    await this.refreshQuestions();
  }

  async refreshSessions(): Promise<void> {
    if (this.searchQuery().trim()) {
      return;
    }
    try {
      this.sessions.set(await this.sessionsApi.listSessions());
    } catch {
      // Sidebar is auxiliary; chat must keep working.
    }
  }

  async runSearch(query: string): Promise<void> {
    this.searchQuery.set(query);
    if (!query.trim()) {
      this.searchResults.set(null);
      await this.refreshSessions();
      return;
    }
    try {
      this.searchResults.set(await this.sessionsApi.searchSessions(query.trim()));
    } catch {
      // Ignore search errors while typing.
    }
  }

  async refreshApprovals(): Promise<void> {
    this.approvals.set([]);
    const session = this.sessionId();
    if (!session) {
      return;
    }
    try {
      this.approvals.set(await this.approvalsApi.listPending(session));
    } catch {
      // Approvals are auxiliary; chat must keep working.
    }
  }

  async refreshQuestions(): Promise<void> {
    this.clarifications.set([]);
    const session = this.sessionId();
    if (!session) {
      return;
    }
    try {
      this.clarifications.set(await this.clarificationsApi.listPending(session));
    } catch {
      // Questions are auxiliary; chat must keep working.
    }
  }

  /** Schedules a bounded `processing` re-poll through `resume-stream`. Extracted for tests. */
  scheduleProcessingPoll(requestId: string, session: string, next: number): void {
    setTimeout(() => {
      void (async () => {
        // The scheduled poll continues the same pending bubble: reset
        // the marker text, then resume.
        this.startPending('Resuming...');
        try {
          await this.streams.resumeTurn(requestId, session, {
            onEvent: (e) => this.handleEvent(e, { resumes: next }),
            onError: (error) => this.failPending(error),
          });
        } catch (error) {
          this.failPending(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        await this.refreshSessions();
        await this.refreshApprovals();
        await this.refreshQuestions();
      })();
    }, PROCESSING_RETRY_DELAY_MS);
  }

  /**
   * Finish a parked (`approval_required`) or still-running (`processing`)
   * tool turn through the durable resume endpoint. Never re-executes.
   * `attempt` bounds chained `processing` polls across streams.
   */
  async resumeTurn(requestId: string, resumeSessionId: string, attempt = 0): Promise<void> {
    this.startPending('Resuming...');
    try {
      await this.streams.resumeTurn(
        requestId,
        resumeSessionId,
        {
          onEvent: (event) => this.handleEvent(event, { resumes: attempt }),
          onError: (error) => this.failPending(error),
        },
      );
    } catch (error) {
      this.failPending(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    // Resume can rename the session, so refresh like a fresh turn.
    await this.refreshSessions();
    await this.refreshApprovals();
    await this.refreshQuestions();
  }

  private appendMessage(role: MessageRole, content: string): void {
    this.messages.update((current) => [
      ...current,
      { role, content, excludedFromContext: false, createdAt: nowIso() },
    ]);
  }

  private startPending(text: string): void {
    this.pendingText.set(text);
    this.pendingTyping.set(true);
  }

  private appendPendingText(extra: string): void {
    this.pendingText.update((current) => `${current ?? ''}${extra}`);
  }

  private commitPendingAs(role: MessageRole): void {
    const content = this.pendingText() ?? '';
    this.pendingText.set(null);
    this.pendingTyping.set(false);
    this.messages.update((current) => [
      ...current,
      { role, content, excludedFromContext: false, createdAt: nowIso() },
    ]);
  }

  private discardPending(): void {
    this.pendingText.set(null);
    this.pendingTyping.set(false);
  }

  private failPending(error: Error): void {
    this.discardPending();
    this.appendMessage('system', `Error: ${error.message}`);
  }

  private handleEvent(event: StreamEvent, state: { resumes: number }): void {
    switch (event.type) {
      case 'meta': {
        this.sessionId.set(event.sessionId);
        return;
      }
      case 'token': {
        if (this.pendingTyping()) {
          this.pendingText.set('');
          this.pendingTyping.set(false);
        }
        this.appendPendingText(event.content);
        return;
      }
      case 'tool': {
        // Mid-turn progress. Streamed tokens always win once they arrive.
        if (this.pendingTyping()) {
          this.pendingText.set(`Running tool ${event.name}...`);
        }
        return;
      }
      case 'approval': {
        // Surface the approval card early; the turn still ends in `done`.
        void this.refreshApprovals();
        return;
      }
      case 'done': {
        this.finishDone(event, state);
        return;
      }
      case 'error': {
        this.failPending(new Error(event.message));
        return;
      }
    }
  }

  private finishDone(
    event: Extract<StreamEvent, { type: 'done' }>,
    state: { resumes: number },
  ): void {
    if (this.pendingTyping()) {
      this.pendingTyping.set(false);
      this.pendingText.set(event.reply);
    }

    // Structured command results render as system notices, not assistant
    // messages. Session switches (/new, /fork) reset the pane.
    if (event.command) {
      const content = event.reply;
      if (event.command.kind === 'session') {
        this.discardPending();
        this.messages.set([
          { role: 'system', content, excludedFromContext: false, createdAt: nowIso() },
        ]);
      } else {
        this.commitPendingAs('system');
      }
      return;
    }

    if (event.status === 'approval_required' && event.approval) {
      const resumedSession = this.sessionId();
      if (resumedSession) {
        this.pendingResumes.set(event.approval.approvalId, {
          requestId: event.requestId,
          sessionId: resumedSession,
        });
      }
      this.commitPendingAs('system');
      return;
    }

    if (event.status === 'processing') {
      if (state.resumes < MAX_PROCESSING_RESUMES) {
        const session = this.sessionId();
        // Keep the pending bubble up; the resumed stream continues it.
        // If the session vanished, drop the poll.
        if (session) {
          this.scheduleProcessingPoll(event.requestId, session, state.resumes + 1);
        }
      } else {
        this.appendPendingText(' (still running — send a message to retry)');
        this.commitPendingAs('assistant');
      }
      return;
    }

    if (event.tool) {
      this.commitPendingAs('assistant');
      this.appendMessage('system', `Tool ran: ${event.tool.name}`);
      return;
    }

    this.commitPendingAs('assistant');
  }
}

export { SESSION_LIST_GUARD };
