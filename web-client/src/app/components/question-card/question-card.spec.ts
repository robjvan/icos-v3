import { ComponentFixture, TestBed } from '@angular/core/testing';

import { QuestionCard } from './question-card';

describe('QuestionCard', () => {
  let component: QuestionCard;
  let fixture: ComponentFixture<QuestionCard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [QuestionCard],
    }).compileComponents();

    fixture = TestBed.createComponent(QuestionCard);
    fixture.componentRef.setInput('clarification', {
      id: 'q1',
      sessionId: 's1',
      question: 'Pick one',
      options: ['a', 'b'],
      status: 'pending',
      createdAt: 't',
      updatedAt: 't',
    });
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should default to the first option when nothing is selected', () => {
    const emitted: { id: string; answer: string }[] = [];
    component.answered.subscribe((event) => emitted.push(event));
    component.submit();
    expect(emitted).toEqual([{ id: 'q1', answer: 'a' }]);
  });

  it('should submit free-text answers trimmed', () => {
    fixture.componentRef.setInput('clarification', {
      id: 'q2',
      sessionId: 's1',
      question: 'Say something',
      status: 'pending',
      createdAt: 't',
      updatedAt: 't',
    });
    const emitted: { id: string; answer: string }[] = [];
    component.answered.subscribe((event) => emitted.push(event));
    component.onFreeText('  hello  ');
    component.submit();
    expect(emitted).toEqual([{ id: 'q2', answer: 'hello' }]);
  });

  it('should emit dismiss with the clarification id', () => {
    const emitted: string[] = [];
    component.dismissed.subscribe((id) => emitted.push(id));
    component.dismiss();
    expect(emitted).toEqual(['q1']);
  });
});
