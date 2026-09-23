import { ComponentFixture, TestBed } from '@angular/core/testing';

import { IdentityTab } from './identity-tab';

describe('IdentityTab', () => {
  let component: IdentityTab;
  let fixture: ComponentFixture<IdentityTab>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IdentityTab],
    }).compileComponents();

    fixture = TestBed.createComponent(IdentityTab);
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
