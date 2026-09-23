import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FilesTab } from './files-tab';

describe('FilesTab', () => {
  let component: FilesTab;
  let fixture: ComponentFixture<FilesTab>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FilesTab],
    }).compileComponents();

    fixture = TestBed.createComponent(FilesTab);
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
