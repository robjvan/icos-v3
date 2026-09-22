import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ModelsTab } from './models-tab';

describe('ModelsTab', () => {
  let component: ModelsTab;
  let fixture: ComponentFixture<ModelsTab>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ModelsTab],
    }).compileComponents();

    fixture = TestBed.createComponent(ModelsTab);
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
