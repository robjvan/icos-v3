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
});
