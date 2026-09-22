import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import type { Clarification } from '../../models/clarification';

/**
 * Clarification card: radio options (first checked) or free-text answer,
 * plus Dismiss (cancel). Mirrors `test-client.html` `renderQuestion`.
 */
@Component({
  selector: 'app-question-card',
  imports: [],
  templateUrl: './question-card.html',
  styleUrl: './question-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuestionCard {
  readonly clarification = input.required<Clarification>();
  readonly answered = output<{ id: string; answer: string }>();
  readonly dismissed = output<string>();

  readonly selectedOption = signal<string | null>(null);
  readonly freeText = signal('');

  hasOptions(): boolean {
    return (this.clarification().options?.length ?? 0) > 0;
  }

  options(): readonly string[] {
    return this.clarification().options ?? [];
  }

  selectOption(option: string): void {
    this.selectedOption.set(option);
  }

  onFreeText(value: string): void {
    this.freeText.set(value);
  }

  isChecked(option: string, index: number): boolean {
    const selected = this.selectedOption();
    // Default: first option checked (mirrors test-client radios[0].checked).
    return selected === null ? index === 0 : selected === option;
  }

  submit(): void {
    const answer = this.hasOptions()
      ? (this.selectedOption() ?? this.options()[0] ?? '')
      : this.freeText().trim();
    if (!answer) {
      return;
    }
    this.answered.emit({ id: this.clarification().id, answer });
  }

  dismiss(): void {
    this.dismissed.emit(this.clarification().id);
  }
}
