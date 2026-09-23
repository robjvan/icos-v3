import { ComponentFixture, TestBed } from '@angular/core/testing';

import { McpTab } from './mcp-tab';

describe('McpTab', () => {
  let component: McpTab;
  let fixture: ComponentFixture<McpTab>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [McpTab],
    }).compileComponents();

    fixture = TestBed.createComponent(McpTab);
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
