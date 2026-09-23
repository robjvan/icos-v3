import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { LucideSearch } from '@lucide/angular';
import { MemoryCandidateService } from '../../services/memory-candidate.service';

/**
 * Memory tab: live read of the `GET /core/memory-candidates` evidence
 * ledger. Ranking/consolidation (M10–M12) has no server backing — the tab
 * badges that boundary explicitly.
 */
@Component({
  selector: 'app-memory-tab',
  imports: [ReactiveFormsModule, LucideSearch],
  templateUrl: './memory-tab.html',
  styleUrl: './memory-tab.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MemoryTab implements OnInit {
  readonly ledger = inject(MemoryCandidateService);

  readonly filterForm = new FormGroup({
    sessionId: new FormControl('', { nonNullable: true }),
  });

  ngOnInit(): void {
    void this.ledger.refresh();
  }

  refresh(): void {
    const sessionId = this.filterForm.controls.sessionId.value.trim();
    void this.ledger.refresh(sessionId || undefined);
  }

  clearFilter(): void {
    this.filterForm.controls.sessionId.setValue('');
    void this.ledger.refresh();
  }
}
