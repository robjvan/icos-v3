import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { Approval } from '../../models/approval';

/** Tool-approval card. Approve AND reject both resume the parked turn. */
@Component({
  selector: 'app-approval-card',
  imports: [],
  templateUrl: './approval-card.html',
  styleUrl: './approval-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApprovalCard {
  readonly approval = input.required<Approval>();
  readonly resolved = output<{ id: string; decision: 'approve' | 'reject' }>();

  approve(): void {
    this.resolved.emit({ id: this.approval().id, decision: 'approve' });
  }

  reject(): void {
    this.resolved.emit({ id: this.approval().id, decision: 'reject' });
  }
}
