import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SessionRepository } from '../session/session.repository';
import {
  ClarificationNotFoundError,
  ClarificationRepository,
  InvalidClarificationAnswerError,
  InvalidClarificationTransitionError,
} from './clarification.repository';
import type {
  ClarificationEvent,
  ClarificationRequest,
  ClarificationStatus,
} from './clarification.repository';

export interface ClarificationDetail extends ClarificationRequest {
  events: ClarificationEvent[];
}

/**
 * Clarification policy. Session binding and HTTP error mapping live
 * here; the repository owns state. Answers are stored on the request
 * so the pending task (M8/M9) can resume from them — the answer is
 * never injected into the conversation transcript.
 */
@Injectable()
export class ClarificationService {
  constructor(
    private readonly clarifications: ClarificationRepository,
    private readonly sessions: SessionRepository,
  ) {}

  async create(input: {
    sessionId: string;
    question: string;
    options?: string[];
    ttlMs?: number;
  }): Promise<ClarificationRequest> {
    const session = await this.sessions.getSession(input.sessionId);
    if (!session) {
      throw new NotFoundException(`Unknown session "${input.sessionId}"`);
    }
    return this.clarifications.createClarification({
      sessionId: input.sessionId,
      question: input.question.trim(),
      ...(input.options !== undefined ? { options: input.options } : {}),
      ...(input.ttlMs !== undefined
        ? { expiresAt: new Date(Date.now() + input.ttlMs).toISOString() }
        : {}),
    });
  }

  async get(id: string): Promise<ClarificationDetail> {
    const request = await this.clarifications.getClarification(id);
    if (!request) throw new NotFoundException(`Unknown clarification "${id}"`);
    const events = await this.clarifications.listEvents(request.id);
    return { ...request, events };
  }

  async list(options?: {
    sessionId?: string;
    status?: ClarificationStatus;
  }): Promise<ClarificationRequest[]> {
    return this.clarifications.listClarifications(options);
  }

  async answer(
    id: string,
    sessionId: string,
    answer: string,
  ): Promise<ClarificationRequest> {
    const current = await this.clarifications.getClarification(id);
    if (!current) throw new NotFoundException(`Unknown clarification "${id}"`);
    if (current.sessionId !== sessionId) {
      throw new BadRequestException(
        `Clarification "${id}" belongs to another session`,
      );
    }
    try {
      return await this.clarifications.answerClarification(id, answer);
    } catch (err) {
      throw this.mapRepositoryError(err);
    }
  }

  async cancel(id: string, sessionId: string): Promise<ClarificationRequest> {
    const current = await this.clarifications.getClarification(id);
    if (!current) throw new NotFoundException(`Unknown clarification "${id}"`);
    if (current.sessionId !== sessionId) {
      throw new BadRequestException(
        `Clarification "${id}" belongs to another session`,
      );
    }
    try {
      return await this.clarifications.cancelClarification(id);
    } catch (err) {
      throw this.mapRepositoryError(err);
    }
  }

  private mapRepositoryError(err: unknown): Error {
    if (err instanceof ClarificationNotFoundError) {
      return new NotFoundException(err.message);
    }
    if (err instanceof InvalidClarificationTransitionError) {
      return new ConflictException(err.message);
    }
    if (err instanceof InvalidClarificationAnswerError) {
      return new BadRequestException(err.message);
    }
    throw err;
  }
}
