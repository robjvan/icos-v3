import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { NavTabsComponent } from './nav-tabs-component';

describe('NavTabsComponent', () => {
  let component: NavTabsComponent;
  let fixture: ComponentFixture<NavTabsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NavTabsComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(NavTabsComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should expose the chat tab', () => {
    expect(component.tabs).toHaveLength(1);
    expect(component.tabs[0]?.label).toBe('Chat');
  });

  it('should toggle the theme label with the current theme', () => {
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('button')?.getAttribute('aria-label')).toContain('theme');
  });
});
