import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  inject,
  viewChild,
} from '@angular/core';
import { LucidePlus } from '@lucide/angular';
import { ApprovalCard } from '../approval-card/approval-card';
import { Composer } from '../composer/composer';
import { MessageList } from '../message-list/message-list';
import { QuestionCard } from '../question-card/question-card';
import { SessionSidebar } from '../session-sidebar/session-sidebar';
import { ConversationStore } from '../../services/conversation-store';

/**
 * Chat shell: sidebar + transcript + approvals/questions + composer.
 * Owns scrolling and delegates all state to `ConversationStore`.
 */
@Component({
  selector: 'app-chat-ui-component',
  imports: [SessionSidebar, MessageList, ApprovalCard, QuestionCard, Composer, LucidePlus],
  templateUrl: './chat-ui-component.html',
  styleUrl: './chat-ui-component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatUiComponent implements OnInit, AfterViewChecked {
  readonly store = inject(ConversationStore);
  private readonly scrollHost = viewChild<ElementRef<HTMLElement>>('scrollHost');
  private pinnedToBottom = true;

  ngOnInit(): void {
    void this.store.refreshSessions();
  }

  ngAfterViewChecked(): void {
    if (this.pinnedToBottom) {
      const host = this.scrollHost()?.nativeElement;
      if (host) {
        host.scrollTop = host.scrollHeight;
      }
    }
  }

  onScroll(event: Event): void {
    const host = event.target as HTMLElement;
    this.pinnedToBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 48;
  }

  openSession(id: string): void {
    void this.store.openSession(id);
  }

  startNewSession(): void {
    this.store.newSession();
  }

  sendMessage(text: string): void {
    void this.store.sendMessage(text);
  }

  resolveApproval(event: { id: string; decision: 'approve' | 'reject' }): void {
    void this.store.resolveApproval(event.id, event.decision);
  }

  answerQuestion(event: { id: string; answer: string }): void {
    void this.store.answerQuestion(event.id, event.answer);
  }

  dismissQuestion(id: string): void {
    void this.store.cancelQuestion(id);
  }

  sessionLabel(): string {
    return this.store.sessionId() ?? 'new session';
  }
}
