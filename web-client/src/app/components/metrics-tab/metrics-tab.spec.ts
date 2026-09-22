import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MetricsTab } from './metrics-tab';

describe('MetricsTab', () => {
  let component: MetricsTab;
  let fixture: ComponentFixture<MetricsTab>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MetricsTab],
    }).compileComponents();

    fixture = TestBed.createComponent(MetricsTab);
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
