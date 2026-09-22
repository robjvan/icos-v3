import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TabPlaceholder } from './tab-placeholder';

describe('TabPlaceholder', () => {
  let component: TabPlaceholder;
  let fixture: ComponentFixture<TabPlaceholder>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TabPlaceholder],
    }).compileComponents();

    fixture = TestBed.createComponent(TabPlaceholder);
    fixture.componentRef.setInput('title', 'Agents');
    fixture.componentRef.setInput('description', 'Agent orchestration UI.');
    fixture.componentRef.setInput('milestone', 'M9/M14');
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render the badge and milestone pointer with no fake data', () => {
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.badge')?.textContent).toContain('server unimplemented');
    expect(compiled.querySelector('.milestone')?.textContent).toContain('M9/M14');
    expect(compiled.querySelector('h2')?.textContent).toContain('Agents');
  });
});
