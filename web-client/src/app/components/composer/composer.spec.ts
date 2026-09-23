import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Composer } from './composer';

describe('Composer', () => {
  let component: Composer;
  let fixture: ComponentFixture<Composer>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Composer],
    }).compileComponents();

    fixture = TestBed.createComponent(Composer);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should emit trimmed messages and reset the form', () => {
    const emitted: string[] = [];
    component.submitted.subscribe((message) => emitted.push(message));
    component.form.controls.message.setValue('  hello  ');
    component.onSubmit();
    expect(emitted).toEqual(['hello']);
    expect(component.form.controls.message.value).toBe('');
  });

  it('should ignore empty submits', () => {
    const emitted: string[] = [];
    component.submitted.subscribe((message) => emitted.push(message));
    component.form.controls.message.setValue('   ');
    component.onSubmit();
    expect(emitted).toEqual([]);
  });

  it('should list selected files locally without including them in the submit', () => {
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    component.onFilesSelected({ target: { files: [file], value: 'x' } } as unknown as Event);
    expect(component.attachments()).toEqual(['photo.png']);

    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.attachments .badge')?.textContent).toContain(
      'server unimplemented',
    );

    const emitted: string[] = [];
    component.submitted.subscribe((message) => emitted.push(message));
    component.form.controls.message.setValue('hi');
    component.onSubmit();
    expect(emitted).toEqual(['hi']);
    expect(component.attachments()).toEqual([]);
  });

  it('should remove individual attachments', () => {
    const a = new File(['x'], 'a.txt');
    const b = new File(['x'], 'b.txt');
    component.onFilesSelected({ target: { files: [a, b], value: 'x' } } as unknown as Event);
    component.removeAttachment(0);
    expect(component.attachments()).toEqual(['b.txt']);
  });

  it('should return focus to the message box on demand', () => {
    fixture.detectChanges();
    component.focusInput();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.ownerDocument.activeElement?.id).toBe('composer-input');
  });
});
