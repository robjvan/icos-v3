import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SensorsTab } from './sensors-tab';

describe('SensorsTab', () => {
  let component: SensorsTab;
  let fixture: ComponentFixture<SensorsTab>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SensorsTab],
    }).compileComponents();

    fixture = TestBed.createComponent(SensorsTab);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render the unimplemented badge with no fake data', () => {
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.badge')?.textContent).toContain('server unimplemented');
    expect(compiled.querySelector('.milestone')?.textContent).toContain('TODO(server milestone');
  });
});
