import {
  BadGatewayException,
  GatewayTimeoutException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { LlmClient, LlmError } from '../llm/llm.client';
import type { ChatMessage } from '../llm/llm.client';
import { buildContext } from './context.builder';
import { SessionStore } from './session.store';

@Injectable()
export class ConversationService {
  constructor(
    private readonly sessions: SessionStore,
    private readonly llm: LlmClient,
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
  ) {}

  async converse(
    message: string,
    sessionId?: string,
  ): Promise<{ sessionId: string; reply: string; model: string }> {
    const { id } = this.sessions.resolve(sessionId);
    const history = this.sessions.get(id) ?? [];

    // TODO(core.md): memory.recall goes here — retrieve relevant memories
    // for { input, session, profile } before building context.

    const messages = buildContext(
      this.config.systemPrompt,
      history,
      message,
      this.config.maxHistory,
    );

    // TODO(core.md): sentinel.evaluate goes here — assess the model
    // response (VALID / REVISE / RETRY / ...) before trusting it.

    // TODO(core.md): tool dispatch goes here — DECISION may ACT via
    // tools and feed observations back into the loop.

    try {
      const { content, model } = await this.llm.chat(messages);
      this.sessions.append(id, { role: 'user', content: message });
      this.sessions.append(id, { role: 'assistant', content });
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

  history(sessionId: string): {
    sessionId: string;
    messages: ChatMessage[];
  } {
    const messages = this.sessions.get(sessionId);
    if (!messages) {
      throw new NotFoundException(`Unknown session "${sessionId}"`);
    }
    return { sessionId, messages };
  }
}
