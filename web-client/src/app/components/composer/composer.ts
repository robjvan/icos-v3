import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideSend } from '@lucide/angular';

/** Message composer. Enter sends, Shift+Enter adds a newline. */
@Component({
  selector: 'app-composer',
  imports: [ReactiveFormsModule, LucideSend],
  templateUrl: './composer.html',
  styleUrl: './composer.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Composer {
  readonly busy = input(false);
  readonly submitted = output<string>();

  readonly form = new FormGroup({
    message: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  readonly sendLabel = computed(() => (this.busy() ? '...' : 'Send'));

  onSubmit(): void {
    const message = this.form.controls.message.value.trim();
    if (!message || this.busy()) {
      return;
    }
    this.form.reset();
    this.submitted.emit(message);
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.onSubmit();
    }
  }
}
