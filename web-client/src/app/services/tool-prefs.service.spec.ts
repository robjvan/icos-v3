import { TestBed } from '@angular/core/testing';

import { ToolPrefsService } from './tool-prefs.service';

describe('ToolPrefsService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should default every tool to manual approval', async () => {
    await TestBed.configureTestingModule({}).compileComponents();
    const service = TestBed.inject(ToolPrefsService);
    expect(service.isAutoApproved('session.search')).toBe(false);
    expect(service.isAutoApproved('session.rename')).toBe(false);
  });

  it('should persist toggles to localStorage', () => {
    const service = TestBed.inject(ToolPrefsService);
    service.setAutoApprove('session.rename', true);
    expect(service.isAutoApproved('session.rename')).toBe(true);
    expect(localStorage.getItem('icos-tool-auto-approve')).toContain('session.rename');
  });

  it('should read stored prefs on construction and ignore unknown keys', () => {
    localStorage.setItem(
      'icos-tool-auto-approve',
      JSON.stringify({ 'session.search': true, 'bogus.tool': true }),
    );
    const service = TestBed.inject(ToolPrefsService);
    expect(service.isAutoApproved('session.search')).toBe(true);
    expect(service.autoApprove()).not.toHaveProperty('bogus.tool');
  });
});
