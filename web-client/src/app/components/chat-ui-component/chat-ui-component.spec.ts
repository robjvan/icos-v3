import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { ChatUiComponent } from './chat-ui-component';
import { ConversationStore } from '../../services/conversation-store';

describe('ChatUiComponent', () => {
  let component: ChatUiComponent;
  let fixture: ComponentFixture<ChatUiComponent>;

  beforeEach(async () => {
    const store = {
      sessionId: () => null,
      messages: () => [],
      busy: () => false,
      sessions: () => [],
      searchResults: () => null,
      approvals: () => [],
      clarifications: () => [],
      pendingText: () => null,
      pendingTyping: () => false,
      refreshSessions: vi.fn().mockResolvedValue(undefined),
      openSession: vi.fn().mockResolvedValue(undefined),
      newSession: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      resolveApproval: vi.fn(),
      answerQuestion: vi.fn(),
      cancelQuestion: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ChatUiComponent],
      providers: [provideRouter([]), { provide: ConversationStore, useValue: store }],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatUiComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render the shell regions', () => {
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('app-session-sidebar')).not.toBeNull();
    expect(compiled.querySelector('app-message-list')).not.toBeNull();
    expect(compiled.querySelector('app-composer')).not.toBeNull();
  });

  it('should label a null session as new', () => {
    expect(component.sessionLabel()).toBe('new session');
  });

  it('should refocus the composer after opening a session', async () => {
    fixture.detectChanges();
    component.openSession('s1');
    await fixture.whenStable();
    // Focus is deferred a macrotask past change detection.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.ownerDocument.activeElement?.id).toBe('composer-input');
  });
});
