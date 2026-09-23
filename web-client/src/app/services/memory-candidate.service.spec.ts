import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { MemoryCandidateService } from './memory-candidate.service';
import { CoreApiService } from './core-api.service';

describe('MemoryCandidateService', () => {
  it('should populate candidates on success', async () => {
    const get = vi.fn().mockResolvedValue({ candidates: [{ id: 'c1' }] });

    await TestBed.configureTestingModule({
      providers: [MemoryCandidateService, { provide: CoreApiService, useValue: { get } }],
    }).compileComponents();

    const service = TestBed.inject(MemoryCandidateService);
    await service.refresh();
    expect(service.candidates()).toHaveLength(1);
    expect(service.error()).toBeNull();
    expect(get).toHaveBeenCalledWith('/core/memory-candidates', { limit: 100 });
  });

  it('should clear candidates and surface the error on failure', async () => {
    const get = vi.fn().mockRejectedValue(new Error('offline'));

    await TestBed.configureTestingModule({
      providers: [MemoryCandidateService, { provide: CoreApiService, useValue: { get } }],
    }).compileComponents();

    const service = TestBed.inject(MemoryCandidateService);
    await service.refresh('session-1');
    expect(service.candidates()).toEqual([]);
    expect(service.error()).toBe('offline');
  });
});
