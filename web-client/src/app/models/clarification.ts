export type ClarificationStatus = 'pending' | 'answered' | 'cancelled' | 'expired';

/** Mirrors core `ClarificationRequest` (clarification.repository.ts). */
export interface Clarification {
  readonly id: string;
  readonly sessionId: string;
  readonly question: string;
  /** Structured choices when offered; absent = free-form answer. */
  readonly options?: string[];
  readonly status: ClarificationStatus;
  readonly answer?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt?: string;
  readonly resolvedAt?: string;
}

export interface ListClarificationsResponse {
  readonly clarifications: Clarification[];
}
