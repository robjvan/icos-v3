import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { LucideSearch } from '@lucide/angular';
import type { SessionSummary, SessionSearchResult } from '../../models/session';
import { ConversationStore } from '../../services/conversation-store';

/** Session history sidebar with debounced FTS search. Auxiliary surface. */
@Component({
  selector: 'app-session-sidebar',
  imports: [LucideSearch],
  templateUrl: './session-sidebar.html',
  styleUrl: './session-sidebar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionSidebar {
  private readonly store = inject(ConversationStore);

  readonly sessions = input.required<readonly SessionSummary[]>();
  readonly activeSessionId = input<string | null>(null);
  readonly searchResults = input<readonly SessionSearchResult[] | null>(null);
  readonly opened = output<string>();
  readonly newSession = output<void>();

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  onSearch(value: string): void {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }
    // 250ms debounce mirrors test-client.html `runSearch`.
    this.searchTimer = setTimeout(() => {
      void this.store.runSearch(value);
    }, 250);
  }

  openSession(id: string): void {
    this.opened.emit(id);
  }

  startNewSession(): void {
    this.newSession.emit();
  }

  shortId(id: string): string {
    return id.slice(0, 8);
  }

  sessionTitle(session: SessionSummary): string {
    return session.title ?? session.preview ?? `Session ${this.shortId(session.sessionId)}`;
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleString();
  }
}
