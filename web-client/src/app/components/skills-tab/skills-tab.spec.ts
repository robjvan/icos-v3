import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { vi } from 'vitest';

import { SkillsTab } from './skills-tab';
import { ConversationStore } from '../../services/conversation-store';
import { SkillService } from '../../services/skill.service';

describe('SkillsTab', () => {
  let component: SkillsTab;
  let fixture: ComponentFixture<SkillsTab>;

  beforeEach(async () => {
    const skillsApi = {
      list: vi.fn().mockResolvedValue({ enabled: true, skills: [], skipped: [] }),
      discover: vi.fn(),
      body: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [SkillsTab],
      providers: [
        { provide: SkillService, useValue: skillsApi },
        { provide: ConversationStore, useValue: { sessionId: () => null } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SkillsTab);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load the catalog on init', () => {
    expect(component.skills()).toEqual([]);
    expect(component.enabled()).toBe(true);
    expect(component.error()).toBeNull();
  });

  it('should skip discovery on blank queries', async () => {
    const skillsApi = TestBed.inject(SkillService) as unknown as {
      discover: ReturnType<typeof vi.fn>;
    };
    component.searchForm.controls.query.setValue('   ');
    await component.discover();
    expect(skillsApi.discover).not.toHaveBeenCalled();
  });

  it('should accept the search form type', () => {
    expect(component.searchForm).toBeInstanceOf(FormGroup);
  });
});
