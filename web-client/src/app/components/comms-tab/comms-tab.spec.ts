import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CommsTab } from './comms-tab';

describe('CommsTab', () => {
  let component: CommsTab;
  let fixture: ComponentFixture<CommsTab>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommsTab],
    }).compileComponents();

    fixture = TestBed.createComponent(CommsTab);
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
