import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideSearch, LucideX } from '@lucide/angular';
import type { SessionSummary, SessionSearchResult } from '../../models/session';
import { ConversationStore } from '../../services/conversation-store';

/** Session history sidebar with debounced FTS search. Auxiliary surface. */
@Component({
  selector: 'app-session-sidebar',
  imports: [LucideSearch, LucideX],
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

  readonly searchValue = signal('');
  readonly isSearching = computed(() => this.searchResults() !== null);
  // Empty states render as siblings of the listbox: a listbox may only own
  // option/group children (axe aria-required-children).
  readonly showNoMatches = computed(
    () => this.searchResults() !== null && this.searchResults()?.length === 0,
  );
  readonly showNoSessions = computed(
    () => this.searchResults() === null && this.sessions().length === 0,
  );
  readonly resultSummary = computed(() => {
    const results = this.searchResults();
    if (results !== null) {
      return results.length === 1 ? '1 match' : `${results.length} matches`;
    }
    const count = this.sessions().length;
    return count === 1 ? '1 session' : `${count} sessions`;
  });

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  onSearch(value: string): void {
    this.searchValue.set(value);
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }
    // 250ms debounce mirrors test-client.html `runSearch`.
    this.searchTimer = setTimeout(() => {
      void this.store.runSearch(value);
    }, 250);
  }

  clearSearch(): void {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    this.searchValue.set('');
    void this.store.runSearch('');
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
