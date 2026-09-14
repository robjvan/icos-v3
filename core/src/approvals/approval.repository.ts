export type ApprovalStatus =
  'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';

export type ApprovalEventType =
  'created' | 'approved' | 'rejected' | 'expired' | 'cancelled';

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  action: string;
  description: string;
  status: ApprovalStatus;
  createdAt: string;
  updatedAt: string;
  /** ISO timestamp, when the request must be decided by. Undefined = no deadline. */
  expiresAt?: string;
  /** ISO timestamp of the terminal transition, if resolved. */
  resolvedAt?: string;
}

export interface ApprovalEvent {
  id: number;
  approvalId: string;
  sessionId: string;
  event: ApprovalEventType;
  createdAt: string;
}

export interface NewApproval {
  sessionId: string;
  action: string;
  description?: string;
  expiresAt?: string;
}

/** Thrown when no approval with the id exists. */
export class ApprovalNotFoundError extends Error {
  constructor(id: string) {
    super(`Unknown approval "${id}"`);
    this.name = 'ApprovalNotFoundError';
  }
}

/** Thrown when a transition out of a non-pending state is attempted. */
export class InvalidApprovalTransitionError extends Error {
  constructor(id: string, from: ApprovalStatus, to: ApprovalStatus) {
    super(`Cannot transition approval "${id}" from ${from} to ${to}`);
    this.name = 'InvalidApprovalTransitionError';
  }
}

/**
 * Structured approval-state boundary. The repository owns the lifecycle
 * (`pending` → terminal) and lazy expiry; services own policy (who may
 * create, session binding). LLM layers never touch this interface —
 * that is the M6b security invariant, enforced by construction.
 */
export abstract class ApprovalRepository {
  abstract createApproval(input: NewApproval): Promise<ApprovalRequest>;

  abstract getApproval(id: string): Promise<ApprovalRequest | null>;

  abstract listApprovals(options?: {
    sessionId?: string;
    status?: ApprovalStatus;
  }): Promise<ApprovalRequest[]>;

  /**
   * Move a pending approval to a terminal state. Applies lazy expiry
   * first (a lapsed `expiresAt` becomes `expired`), then rejects any
   * transition out of a non-pending state.
   */
  abstract resolveApproval(
    id: string,
    to: Exclude<ApprovalStatus, 'pending' | 'expired'>,
  ): Promise<ApprovalRequest>;

  abstract listEvents(approvalId: string): Promise<ApprovalEvent[]>;

  /** Cheap liveness probe for health checks. */
  abstract ping(): Promise<void>;
}
