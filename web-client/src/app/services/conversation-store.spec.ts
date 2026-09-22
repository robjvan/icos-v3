import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ConversationStore } from './conversation-store';
import { ConversationStreamService } from './conversation-stream.service';
import type { StreamCallbacks } from './conversation-stream.service';
import type { StreamEvent } from '../models/stream-event';
import { ApprovalService, ClarificationService, SessionService } from './session-data.service';

describe('ConversationStore', () => {
  let store: ConversationStore;
  let streams: {
    streamTurn: ReturnType<typeof vi.fn>;
    resumeTurn: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    streams = {
      streamTurn: vi.fn(),
      resumeTurn: vi.fn(),
    };

    await TestBed.configureTestingModule({
      providers: [
        ConversationStore,
        { provide: ConversationStreamService, useValue: streams },
        {
          provide: SessionService,
          useValue: { listSessions: vi.fn().mockResolvedValue([]), history: vi.fn() },
        },
        { provide: ApprovalService, useValue: { listPending: vi.fn().mockResolvedValue([]) } },
        {
          provide: ClarificationService,
          useValue: { listPending: vi.fn().mockResolvedValue([]) },
        },
      ],
    }).compileComponents();

    store = TestBed.inject(ConversationStore);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function emit(events: StreamEvent[]): void {
    streams.streamTurn.mockImplementation(
      (_message: string, _session: string | null, callbacks: StreamCallbacks) => {
        for (const event of events) {
          callbacks.onEvent(event);
        }
        return Promise.resolve();
      },
    );
  }

  it('should stream tokens into the pending bubble then commit', async () => {
    emit([
      { type: 'meta', sessionId: 's1', model: 'm', requestId: 'r1' },
      { type: 'token', content: 'hel' },
      { type: 'token', content: 'lo' },
      { type: 'done', reply: 'hello', model: 'm', requestId: 'r1', status: 'ok' },
    ]);

    await store.sendMessage('hi');
    expect(store.sessionId()).toBe('s1');
    const last = store.messages()[store.messages().length - 1];
    expect(last?.role).toBe('assistant');
    expect(last?.content).toBe('hello');
    expect(store.pendingText()).toBeNull();
  });

  it('should park an approval_required turn and resume exactly once on approve', async () => {
    emit([
      { type: 'meta', sessionId: 's1', model: 'm', requestId: 'r1' },
      {
        type: 'done',
        reply: 'needs approval',
        model: 'm',
        requestId: 'r1',
        status: 'approval_required',
        approval: { approvalId: 'a1', invocationId: 'i1', tool: 't', args: {} },
      },
    ]);
    streams.resumeTurn.mockImplementation(
      (_requestId: string, _session: string, callbacks: StreamCallbacks) => {
        callbacks.onEvent({
          type: 'done',
          reply: 'approved result',
          model: 'm',
          requestId: 'r1',
          status: 'ok',
        });
        return Promise.resolve();
      },
    );

    await store.sendMessage('run it');
    expect(store.hasPendingResume('a1')).toBe(true);

    await store.resolveApproval('a1', 'approve');
    expect(store.hasPendingResume('a1')).toBe(false);
    expect(streams.resumeTurn).toHaveBeenCalledTimes(1);
    expect(streams.resumeTurn).toHaveBeenCalledWith(
      'r1',
      's1',
      expect.objectContaining({ onEvent: expect.any(Function) }),
    );
    const last = store.messages()[store.messages().length - 1];
    expect(last?.content).toBe('approved result');
  });

  it('should resume on reject as well as approve', async () => {
    store.sessionId.set('s1');
    // Park directly by emitting through sendMessage.
    emit([
      { type: 'meta', sessionId: 's1', model: 'm', requestId: 'r9' },
      {
        type: 'done',
        reply: 'parked',
        model: 'm',
        requestId: 'r9',
        status: 'approval_required',
        approval: { approvalId: 'a9', invocationId: 'i9', tool: 't', args: {} },
      },
    ]);
    streams.resumeTurn.mockImplementation(
      (_requestId: string, _session: string, callbacks: StreamCallbacks) => {
        callbacks.onEvent({
          type: 'done',
          reply: 'denied notice',
          model: 'm',
          requestId: 'r9',
          status: 'ok',
        });
        return Promise.resolve();
      },
    );

    await store.sendMessage('run it');
    await store.resolveApproval('a9', 'reject');
    expect(streams.resumeTurn).toHaveBeenCalledTimes(1);
  });

  it('should schedule bounded processing polls with resume-stream', () => {
    store.sessionId.set('s1');
    store.scheduleProcessingPoll('r2', 's1', 1);
    expect(streams.resumeTurn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(streams.resumeTurn).toHaveBeenCalledTimes(1);
    expect(streams.resumeTurn).toHaveBeenCalledWith(
      'r2',
      's1',
      expect.objectContaining({ onEvent: expect.any(Function) }),
    );
  });

  it('should give up after the resume bound with a retry hint', async () => {
    emit([
      { type: 'meta', sessionId: 's1', model: 'm', requestId: 'r2' },
      { type: 'done', reply: 'working', model: 'm', requestId: 'r2', status: 'processing' },
    ]);
    // resumes=10 is the bound: no further poll, retry hint committed.
    streams.resumeTurn.mockImplementation(
      (_requestId: string, _session: string, callbacks: StreamCallbacks) => {
        callbacks.onEvent({
          type: 'done',
          reply: 'working',
          model: 'm',
          requestId: 'r2',
          status: 'processing',
        });
        return Promise.resolve();
      },
    );

    // Drive the bound directly: handle the 10th resume's done through the
    // private path via resumeTurn(attempt=10).
    await store.resumeTurn('r2', 's1', 10);
    const last = store.messages()[store.messages().length - 1];
    expect(last?.content).toContain('still running — send a message to retry');
    expect(streams.resumeTurn).toHaveBeenCalledTimes(1);
  });

  it('should reset the pane on session-switch commands', async () => {
    store.messages.set([
      { role: 'user', content: 'old', excludedFromContext: false, createdAt: 't' },
    ]);
    emit([
      { type: 'meta', sessionId: 's2', model: 'core', requestId: 'r3' },
      {
        type: 'done',
        reply: 'New session started.',
        model: 'core',
        requestId: 'r3',
        status: 'ok',
        command: { kind: 'session' },
      },
    ]);

    await store.sendMessage('/new');
    expect(store.messages()).toHaveLength(1);
    expect(store.messages()[0]?.role).toBe('system');
    expect(store.messages()[0]?.content).toBe('New session started.');
  });

  it('should render tool completion as a trace line', async () => {
    emit([
      { type: 'meta', sessionId: 's1', model: 'm', requestId: 'r4' },
      { type: 'tool', invocationId: 'i1', name: 'rename', state: 'running' },
      {
        type: 'done',
        reply: 'renamed',
        model: 'm',
        requestId: 'r4',
        status: 'ok',
        tool: { invocationId: 'i1', name: 'rename' },
      },
    ]);

    await store.sendMessage('rename it');
    const roles = store.messages().map((m) => m.content);
    expect(roles).toContain('Tool ran: rename');
  });

  it('should surface stream errors as system messages', async () => {
    streams.streamTurn.mockImplementation(
      (_message: string, _session: string | null, callbacks: StreamCallbacks) => {
        callbacks.onError(new Error('boom'));
        return Promise.resolve();
      },
    );

    await store.sendMessage('hi');
    const last = store.messages()[store.messages().length - 1];
    expect(last?.role).toBe('system');
    expect(last?.content).toBe('Error: boom');
  });
});
