export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';

/** Mirrors core `ApprovalRequest` (approval.repository.ts). */
export interface Approval {
  readonly id: string;
  readonly sessionId: string;
  readonly action: string;
  readonly description: string;
  readonly status: ApprovalStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt?: string;
  readonly resolvedAt?: string;
}

export interface ListApprovalsResponse {
  readonly approvals: Approval[];
}

export type ApprovalDecision = 'approve' | 'reject' | 'cancel';
