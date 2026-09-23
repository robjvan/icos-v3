import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ClientSettingsTab } from './client-settings-tab';

describe('ClientSettingsTab', () => {
  let component: ClientSettingsTab;
  let fixture: ComponentFixture<ClientSettingsTab>;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [ClientSettingsTab],
    }).compileComponents();

    fixture = TestBed.createComponent(ClientSettingsTab);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should expose the compiled-in server URL', () => {
    expect(component.serverUrl).toContain('http');
  });

  it('should switch themes through the theme service', () => {
    component.setTheme('light');
    expect(component.theme()).toBe('light');
    component.setTheme('dark');
    expect(component.theme()).toBe('dark');
  });
});
