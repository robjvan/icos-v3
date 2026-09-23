import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { SessionSidebar } from './session-sidebar';
import { ConversationStore } from '../../services/conversation-store';

describe('SessionSidebar', () => {
  let component: SessionSidebar;
  let fixture: ComponentFixture<SessionSidebar>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SessionSidebar],
      providers: [
        { provide: ConversationStore, useValue: { runSearch: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SessionSidebar);
    fixture.componentRef.setInput('sessions', []);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should summarize the session count when not searching', () => {
    fixture.componentRef.setInput('sessions', [
      {
        sessionId: 's1',
        createdAt: 't',
        updatedAt: 't',
        messageCount: 2,
        title: 'Hello',
      },
    ]);
    expect(component.resultSummary()).toBe('1 session');
  });

  it('should summarize matches while searching', () => {
    fixture.componentRef.setInput('searchResults', []);
    expect(component.isSearching()).toBe(true);
    expect(component.resultSummary()).toBe('0 matches');
  });

  it('should clear the query and reload the full list', () => {
    const store = TestBed.inject(ConversationStore) as unknown as {
      runSearch: ReturnType<typeof vi.fn>;
    };
    component.onSearch('hello');
    expect(component.searchValue()).toBe('hello');
    component.clearSearch();
    expect(component.searchValue()).toBe('');
    expect(store.runSearch).toHaveBeenLastCalledWith('');
  });

  it('should render an empty state with no sessions', () => {
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.empty')?.textContent).toContain('No sessions yet');
    expect(compiled.querySelector('.result-count')?.textContent).toBe('0 sessions');
  });
});
