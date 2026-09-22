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
      openSession: vi.fn(),
      newSession: vi.fn(),
      sendMessage: vi.fn(),
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
});
