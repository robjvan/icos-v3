import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { ChatMessage } from '../../models/message';

/**
 * Transcript bubbles. Auto-scroll handled by the parent via `messagesVersion`.
 * `excludedFromContext` rows render dimmed (test-client `/undo` marker).
 */
@Component({
  selector: 'app-message-list',
  imports: [],
  templateUrl: './message-list.html',
  styleUrl: './message-list.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageList {
  readonly messages = input.required<readonly ChatMessage[]>();
  readonly pendingText = input<string | null>(null);
  readonly pendingTyping = input(false);

  readonly visiblePending = computed(() => this.pendingText() !== null);

  bubbleClass(role: ChatMessage['role']): string {
    return `message ${role}`;
  }

  bubbleTitle(message: ChatMessage): string | null {
    return message.excludedFromContext ? 'Excluded from LLM context by /undo' : null;
  }
}
