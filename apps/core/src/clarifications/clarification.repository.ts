export type ClarificationStatus =
  'pending' | 'answered' | 'cancelled' | 'expired';

export type ClarificationEventType =
  'created' | 'answered' | 'cancelled' | 'expired';

export interface ClarificationRequest {
  id: string;
  sessionId: string;
  question: string;
  /** Structured choices, when the requester offers them. Absent = free-form. */
  options?: string[];
  status: ClarificationStatus;
  /** The accepted answer, once answered. */
  answer?: string;
  createdAt: string;
  updatedAt: string;
  /** ISO timestamp, when the request must be answered by. Undefined = no deadline. */
  expiresAt?: string;
  /** ISO timestamp of the terminal transition, if resolved. */
  resolvedAt?: string;
}

export interface ClarificationEvent {
  id: number;
  clarificationId: string;
  sessionId: string;
  event: ClarificationEventType;
  createdAt: string;
}

export interface NewClarification {
  sessionId: string;
  question: string;
  options?: string[];
  expiresAt?: string;
}

/** Thrown when no clarification with the id exists. */
export class ClarificationNotFoundError extends Error {
  constructor(id: string) {
    super(`Unknown clarification "${id}"`);
    this.name = 'ClarificationNotFoundError';
  }
}

/** Thrown when a transition out of a non-pending state is attempted. */
export class InvalidClarificationTransitionError extends Error {
  constructor(id: string, from: ClarificationStatus, to: ClarificationStatus) {
    super(`Cannot transition clarification "${id}" from ${from} to ${to}`);
    this.name = 'InvalidClarificationTransitionError';
  }
}

/** Thrown when the answer satisfies neither the free-form nor choice contract. */
export class InvalidClarificationAnswerError extends Error {
  constructor(id: string, reason: string) {
    super(`Invalid answer for clarification "${id}": ${reason}`);
    this.name = 'InvalidClarificationAnswerError';
  }
}

/**
 * Structured clarification-state boundary. Mirrors the approvals pattern
 * deliberately (lifecycle + lazy expiry + event trail) without merging
 * the two: approvals gate actions, clarifications supply information,
 * and their payloads resolve differently. A shared interaction
 * abstraction can emerge in M8/M9 if it earns its keep.
 */
export abstract class ClarificationRepository {
  abstract createClarification(
    input: NewClarification,
  ): Promise<ClarificationRequest>;

  abstract getClarification(id: string): Promise<ClarificationRequest | null>;

  abstract listClarifications(options?: {
    sessionId?: string;
    status?: ClarificationStatus;
  }): Promise<ClarificationRequest[]>;

  /**
   * Record the answer on a pending clarification. Applies lazy expiry
   * first, then rejects answers to non-pending requests. When the
   * request offers `options`, the answer must equal one of them.
   */
  abstract answerClarification(
    id: string,
    answer: string,
  ): Promise<ClarificationRequest>;

  abstract cancelClarification(id: string): Promise<ClarificationRequest>;

  abstract listEvents(clarificationId: string): Promise<ClarificationEvent[]>;

  /** Cheap liveness probe for health checks. */
  abstract ping(): Promise<void>;
}
