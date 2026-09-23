import { ComponentFixture, TestBed } from '@angular/core/testing';

import { KbTab } from './kb-tab';

describe('KbTab', () => {
  let component: KbTab;
  let fixture: ComponentFixture<KbTab>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [KbTab],
    }).compileComponents();

    fixture = TestBed.createComponent(KbTab);
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
