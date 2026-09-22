import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { FooterComponent } from './footer-component';

describe('FooterComponent', () => {
  let component: FooterComponent;
  let fixture: ComponentFixture<FooterComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FooterComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(FooterComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should expose a theme toggle label matching the current theme', () => {
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const button = compiled.querySelector('button[aria-label]');
    expect(button?.getAttribute('aria-label')).toContain('theme');
    expect(component.isDark()).toBe(true);
  });

  it('should clean up its clock timer on destroy', () => {
    const clearSpy = vi.spyOn(window, 'clearInterval');
    component.ngOnDestroy();
    expect(clearSpy).toHaveBeenCalled();
  });
});
