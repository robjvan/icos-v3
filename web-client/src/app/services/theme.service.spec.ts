import { TestBed } from '@angular/core/testing';

import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('should default to dark and apply it to the document', async () => {
    await TestBed.configureTestingModule({}).compileComponents();
    const service = TestBed.inject(ThemeService);
    expect(service.theme()).toBe('dark');
    service.set('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('should toggle between dark and light and persist the choice', () => {
    const service = TestBed.inject(ThemeService);
    service.toggle();
    expect(service.theme()).toBe('light');
    expect(localStorage.getItem('icos-theme')).toBe('light');
    service.toggle();
    expect(service.theme()).toBe('dark');
  });

  it('should read the stored theme on construction', () => {
    localStorage.setItem('icos-theme', 'light');
    const service = TestBed.inject(ThemeService);
    expect(service.theme()).toBe('light');
  });
});
