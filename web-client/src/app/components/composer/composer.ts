import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucidePaperclip, LucideSend, LucideX } from '@lucide/angular';

/**
 * Message composer. Enter sends, Shift+Enter adds a newline.
 *
 * Attachments are a frontend-only placeholder: files are listed locally and
 * never uploaded (no server endpoint exists). They are NOT included in the
 * submitted message.
 */
@Component({
  selector: 'app-composer',
  imports: [ReactiveFormsModule, LucidePaperclip, LucideSend, LucideX],
  templateUrl: './composer.html',
  styleUrl: './composer.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Composer {
  readonly busy = input(false);
  readonly submitted = output<string>();

  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  private readonly textarea = viewChild<ElementRef<HTMLTextAreaElement>>('textarea');

  readonly form = new FormGroup({
    message: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  /** Local-only attachment names. Files never leave the browser. */
  readonly attachments = signal<readonly string[]>([]);

  readonly sendLabel = computed(() => (this.busy() ? '...' : 'Send'));

  onSubmit(): void {
    const message = this.form.controls.message.value.trim();
    if (!message || this.busy()) {
      return;
    }
    this.form.reset();
    this.clearAttachments();
    this.submitted.emit(message);
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.onSubmit();
    }
  }

  openFilePicker(): void {
    this.fileInput()?.nativeElement.click();
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const names = [...(input.files ?? [])].map((file) => file.name).filter((name) => name !== '');
    if (names.length > 0) {
      this.attachments.update((current) => [...current, ...names]);
    }
    input.value = '';
  }

  removeAttachment(index: number): void {
    this.attachments.update((current) => current.filter((_, i) => i !== index));
  }

  clearAttachments(): void {
    this.attachments.set([]);
  }

  /** Return keyboard focus to the message box (session switch, turn done). */
  focusInput(): void {
    this.textarea()?.nativeElement.focus({ preventScroll: true });
  }
}
