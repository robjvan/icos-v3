import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ToolsTab } from './tools-tab';
import { ToolPrefsService } from '../../services/tool-prefs.service';

describe('ToolsTab', () => {
  let component: ToolsTab;
  let fixture: ComponentFixture<ToolsTab>;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [ToolsTab],
    }).compileComponents();

    fixture = TestBed.createComponent(ToolsTab);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should list the known registry tools', () => {
    expect(component.tools.map((tool) => tool.name)).toEqual([
      'session.search',
      'session.rename',
    ]);
    expect(component.autoApprovedCount()).toBe(0);
  });

  it('should toggle frontend-only prefs through the service', () => {
    const prefs = TestBed.inject(ToolPrefsService);
    const renameTool = component.tools[1];
    expect(renameTool).toBeDefined();
    if (!renameTool) {
      return;
    }
    component.toggle(renameTool, true);
    expect(prefs.isAutoApproved('session.rename')).toBe(true);
    expect(component.autoApprovedCount()).toBe(1);
    component.toggle(renameTool, false);
    expect(component.autoApprovedCount()).toBe(0);
  });
});
