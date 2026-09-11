import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { LlmClient, LlmError } from '../llm/llm.client';
import type { ChatMessage } from '../llm/llm.client';
import { EXTRACTION_VERSION } from '../memory/extraction.prompt';
import { MemoryCandidateExtractor } from '../memory/memory-candidate-extractor';
import { MemoryCandidateRepository } from '../memory/memory-candidate.repository';
import { InvalidSearchQueryError } from '../session/session.repository';
import type { SessionSearchResult } from '../session/session.repository';
import { buildContext } from './context.builder';
import { SessionStore } from './session.store';

export type ConversationStreamEvent =
  | { type: 'meta'; sessionId: string; model: string }
  | { type: 'token'; content: string }
  | { type: 'done'; reply: string; model: string }
  | { type: 'error'; message: string };

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    private readonly sessions: SessionStore,
    private readonly llm: LlmClient,
    private readonly extractor: MemoryCandidateExtractor,
    private readonly candidates: MemoryCandidateRepository,
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
  ) {}

  async converse(
    message: string,
    sessionId?: string,
  ): Promise<{ sessionId: string; reply: string; model: string }> {
    const { id } = await this.sessions.resolve(sessionId);
    const history = await this.sessions.getContextMessages(id);
    const messages = this.prepareMessages(history, message);

    // TODO(core.md): sentinel.evaluate goes here — assess the model
    // response (VALID / REVISE / RETRY / ...) before trusting it.

    // TODO(core.md): tool dispatch goes here — DECISION may ACT via
    // tools and feed observations back into the loop.

    try {
      const { content, model } = await this.llm.chat({
        messages,
        sessionId: id,
      });
      const userRecord = await this.sessions.append(id, {
        role: 'user',
        content: message,
      });
      await this.sessions.append(id, { role: 'assistant', content });
      this.extractTurn({
        sessionId: id,
        userMessageId: userRecord.id,
        userMessage: message,
        assistantMessage: content,
        context: history,
      });
      return { sessionId: id, reply: content, model };
    } catch (err) {
      if (err instanceof LlmError) {
        if (err.httpStatus === 504) {
          throw new GatewayTimeoutException(err.message);
        }
        throw new BadGatewayException(err.message);
      }
      throw err;
    }
  }

  async history(sessionId: string): Promise<{
    sessionId: string;
    messages: ChatMessage[];
  }> {
    const messages = await this.sessions.getHistory(sessionId);
    if (!messages) {
      throw new NotFoundException(`Unknown session "${sessionId}"`);
    }
    return { sessionId, messages };
  }

  /**
   * Streaming variant of the loop. History is appended only on clean
   * completion; mid-stream failures emit `error` and store nothing.
   */
  async converseStream(
    message: string,
    sessionId: string | undefined,
    emit: (event: ConversationStreamEvent) => void,
    clientSignal?: AbortSignal,
  ): Promise<void> {
    const { id } = await this.sessions.resolve(sessionId);
    const history = await this.sessions.getContextMessages(id);
    const messages = this.prepareMessages(history, message);

    // TODO(core.md): sentinel.evaluate (streaming) goes here.
    // TODO(core.md): tool dispatch goes here.

    emit({ type: 'meta', sessionId: id, model: this.config.llmModel });
    try {
      const { content, model } = await this.llm.chatStream(
        { messages, sessionId: id },
        { onToken: (token) => emit({ type: 'token', content: token }) },
        clientSignal,
      );
      const userRecord = await this.sessions.append(id, {
        role: 'user',
        content: message,
      });
      await this.sessions.append(id, { role: 'assistant', content });
      this.extractTurn({
        sessionId: id,
        userMessageId: userRecord.id,
        userMessage: message,
        assistantMessage: content,
        context: history,
      });
      emit({ type: 'done', reply: content, model });
    } catch (err) {
      emit({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  private prepareMessages(
    history: ChatMessage[],
    message: string,
  ): ChatMessage[] {
    // TODO(core.md): memory.recall goes here — retrieve relevant memories
    // for { input, session, profile } before building context.
    return buildContext(
      this.config.systemPrompt,
      history,
      message,
      this.config.maxHistory,
    );
  }

  listSessions(options?: { limit?: number; offset?: number }) {
    return this.sessions.listSessions(options);
  }

  /**
   * Fire-and-forget enrichment: runs after the turn is persisted and the
   * response is on its way. Never blocks conversation, never fails it —
   * extraction errors are logged and dropped.
   */
  private extractTurn(input: {
    sessionId: string;
    userMessageId: number;
    userMessage: string;
    assistantMessage: string;
    context: ChatMessage[];
  }): void {
    if (!this.config.memoryExtractionEnabled) return;
    void this.extractor
      .extract({
        sessionId: input.sessionId,
        userMessage: { role: 'user', content: input.userMessage },
        assistantMessage: {
          role: 'assistant',
          content: input.assistantMessage,
        },
        context: input.context,
      })
      .then((validated) => {
        if (validated.length === 0) return;
        return this.candidates.saveCandidates(
          validated.map((candidate) => ({
            ...candidate,
            source: {
              sessionId: input.sessionId,
              messageId: input.userMessageId,
            },
            extractorModel: this.config.memoryLlmModel,
            extractorVersion: EXTRACTION_VERSION,
          })),
        );
      })
      .catch((err: unknown) => {
        this.logger.warn(
          `Memory extraction failed for session ${input.sessionId}: ${
            err instanceof Error ? err.message : 'unknown error'
          }`,
        );
      });
  }

  async searchSessions(
    query: string,
    options?: { limit?: number; sessionId?: string },
  ): Promise<SessionSearchResult[]> {
    try {
      return await this.sessions.searchMessages(query, options);
    } catch (err) {
      if (err instanceof InvalidSearchQueryError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }
}
