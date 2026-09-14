import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SessionRepository } from '../session/session.repository';
import {
  ApprovalNotFoundError,
  ApprovalRepository,
  InvalidApprovalTransitionError,
} from './approval.repository';
import type {
  ApprovalEvent,
  ApprovalRequest,
  ApprovalStatus,
} from './approval.repository';

export interface ApprovalDetail extends ApprovalRequest {
  events: ApprovalEvent[];
}

/**
 * Approval policy. The repository owns state transitions; this service
 * owns session binding (an approval belongs to exactly one session) and
 * HTTP-facing error mapping. Nothing here is reachable from the LLM —
 * only explicit API calls resolve requests.
 */
@Injectable()
export class ApprovalService {
  constructor(
    private readonly approvals: ApprovalRepository,
    private readonly sessions: SessionRepository,
  ) {}

  async create(input: {
    sessionId: string;
    action: string;
    description?: string;
    ttlMs?: number;
  }): Promise<ApprovalRequest> {
    const session = await this.sessions.getSession(input.sessionId);
    if (!session) {
      throw new NotFoundException(`Unknown session "${input.sessionId}"`);
    }
    return this.approvals.createApproval({
      sessionId: input.sessionId,
      action: input.action.trim(),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.ttlMs !== undefined
        ? { expiresAt: new Date(Date.now() + input.ttlMs).toISOString() }
        : {}),
    });
  }

  async get(id: string): Promise<ApprovalDetail> {
    const request = await this.approvals.getApproval(id);
    if (!request) throw new NotFoundException(`Unknown approval "${id}"`);
    return this.withEvents(request);
  }

  async list(options?: {
    sessionId?: string;
    status?: ApprovalStatus;
  }): Promise<ApprovalRequest[]> {
    return this.approvals.listApprovals(options);
  }

  async approve(id: string, sessionId: string): Promise<ApprovalRequest> {
    return this.resolve(id, sessionId, 'approved');
  }

  async reject(id: string, sessionId: string): Promise<ApprovalRequest> {
    return this.resolve(id, sessionId, 'rejected');
  }

  async cancel(id: string, sessionId: string): Promise<ApprovalRequest> {
    return this.resolve(id, sessionId, 'cancelled');
  }

  private async resolve(
    id: string,
    sessionId: string,
    to: 'approved' | 'rejected' | 'cancelled',
  ): Promise<ApprovalRequest> {
    const current = await this.approvals.getApproval(id);
    if (!current) throw new NotFoundException(`Unknown approval "${id}"`);
    if (current.sessionId !== sessionId) {
      throw new BadRequestException(
        `Approval "${id}" belongs to another session`,
      );
    }
    try {
      return await this.approvals.resolveApproval(id, to);
    } catch (err) {
      if (err instanceof ApprovalNotFoundError) {
        throw new NotFoundException(err.message);
      }
      if (err instanceof InvalidApprovalTransitionError) {
        throw new ConflictException(err.message);
      }
      throw err;
    }
  }

  private async withEvents(request: ApprovalRequest): Promise<ApprovalDetail> {
    const events = await this.approvals.listEvents(request.id);
    return { ...request, events };
  }
}
