import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ServerSettingsTab } from './server-settings-tab';

describe('ServerSettingsTab', () => {
  let component: ServerSettingsTab;
  let fixture: ComponentFixture<ServerSettingsTab>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ServerSettingsTab],
    }).compileComponents();

    fixture = TestBed.createComponent(ServerSettingsTab);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render the read-only placeholder', () => {
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.badge')?.textContent).toContain('server unimplemented');
  });
});
