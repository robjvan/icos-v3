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

  it('should expose the health poll interval with 1–30s bounds', () => {
    expect(component.healthPollSeconds()).toBe(5);
    expect(component.minHealthPollSeconds).toBe(1);
    expect(component.maxHealthPollSeconds).toBe(30);
  });

  it('should persist the health poll interval through the health service', () => {
    const input = document.createElement('input');
    input.type = 'range';
    input.value = '10';
    component.onHealthPollInput(new Event('input'));
    // No target on a bare Event: interval unchanged.
    expect(component.healthPollSeconds()).toBe(5);

    component.onHealthPollInput({ target: input } as unknown as Event);
    expect(component.healthPollSeconds()).toBe(10);
    expect(localStorage.getItem('icos-health-poll-seconds')).toBe('10');
  });
});
