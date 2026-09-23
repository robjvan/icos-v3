import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CronTab } from './cron-tab';

describe('CronTab', () => {
  let component: CronTab;
  let fixture: ComponentFixture<CronTab>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CronTab],
    }).compileComponents();

    fixture = TestBed.createComponent(CronTab);
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
