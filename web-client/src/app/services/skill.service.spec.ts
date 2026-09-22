import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import type { SkillListResponse } from '../models/skill';
import { CoreApiService } from './core-api.service';
import { SkillService } from './skill.service';

describe('SkillService', () => {
  it('should fetch the skill catalog from the read-only endpoints', async () => {
    const catalog: SkillListResponse = {
      enabled: true,
      skills: [{ name: 'icos-v3-stack', description: 'Stack guide', version: '0.1.0' }],
      skipped: [],
    };
    const get = vi.fn().mockResolvedValue(catalog);

    await TestBed.configureTestingModule({
      providers: [SkillService, { provide: CoreApiService, useValue: { get } }],
    }).compileComponents();

    const service = TestBed.inject(SkillService);
    await expect(service.list()).resolves.toEqual(catalog);
    expect(get).toHaveBeenCalledWith('/core/skills');
  });

  it('should pass query params through for discover and active', async () => {
    const get = vi.fn().mockResolvedValue({ query: 'x', matches: [] });

    await TestBed.configureTestingModule({
      providers: [SkillService, { provide: CoreApiService, useValue: { get } }],
    }).compileComponents();

    const service = TestBed.inject(SkillService);
    await service.discover('stack');
    expect(get).toHaveBeenCalledWith('/core/skills/discover', { q: 'stack' });
    await service.active('session-1');
    expect(get).toHaveBeenCalledWith('/core/skills/active', { sessionId: 'session-1' });
  });
});
