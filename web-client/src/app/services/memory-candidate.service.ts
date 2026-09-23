import { Injectable, inject, signal } from '@angular/core';
import { MEMORY_CANDIDATES_ENDPOINT } from '../../constants';
import type { ListCandidatesResponse, MemoryCandidate } from '../models/memory-candidate';
import { CoreApiService } from './core-api.service';

const CANDIDATE_LIST_LIMIT = 100;

/**
 * Read-only inspection of the memory-candidate evidence ledger.
 * Debug/observation surface — not a memory API and not cognition.
 */
@Injectable({ providedIn: 'root' })
export class MemoryCandidateService {
  private readonly api = inject(CoreApiService);

  readonly candidates = signal<readonly MemoryCandidate[]>([]);
  readonly error = signal<string | null>(null);

  async refresh(sessionId?: string): Promise<void> {
    this.error.set(null);
    try {
      const data = await this.api.get<ListCandidatesResponse>(MEMORY_CANDIDATES_ENDPOINT, {
        ...(sessionId ? { sessionId } : {}),
        limit: CANDIDATE_LIST_LIMIT,
      });
      this.candidates.set(data.candidates);
    } catch (error) {
      this.candidates.set([]);
      this.error.set(error instanceof Error ? error.message : String(error));
    }
  }
}
