import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { MemoryTab } from './memory-tab';
import { MemoryCandidateService } from '../../services/memory-candidate.service';

describe('MemoryTab', () => {
  let component: MemoryTab;
  let fixture: ComponentFixture<MemoryTab>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MemoryTab],
      providers: [
        {
          provide: MemoryCandidateService,
          useValue: { candidates: () => [], error: () => null, refresh: vi.fn() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MemoryTab);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should refresh the ledger on init', () => {
    const ledger = TestBed.inject(MemoryCandidateService);
    expect(ledger.refresh).toHaveBeenCalledWith();
  });

  it('should clear the filter and reload unfiltered', () => {
    const ledger = TestBed.inject(MemoryCandidateService) as unknown as {
      refresh: ReturnType<typeof vi.fn>;
    };
    component.filterForm.controls.sessionId.setValue('session-1');
    component.clearFilter();
    expect(component.filterForm.controls.sessionId.value).toBe('');
    expect(ledger.refresh).toHaveBeenCalledWith();
  });
});
