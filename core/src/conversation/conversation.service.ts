import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { CommandDispatcher } from '../commands/command-dispatcher';
import type { CommandResult } from '../commands/command-result';
import { LlmClient, LlmError } from '../llm/llm.client';
import type { ChatMessage, StreamSink } from '../llm/llm.client';
import type {
  LlmMessage,
  LlmResult,
  LlmToolRequest,
} from '../llm/llm.protocol';
import { EXTRACTION_VERSION } from '../memory/extraction.prompt';
import { MemoryCandidateExtractor } from '../memory/memory-candidate-extractor';
import { MemoryCandidateRepository } from '../memory/memory-candidate.repository';
import { SkillService } from '../skills/skill.service';
import type { ResolvedTurnSkills } from '../skills/skill.service';
import type { LoadedSkill, TurnSkillReport } from '../skills/skill.types';
import { InvalidSearchQueryError } from '../session/session.repository';
import type { SessionSearchResult } from '../session/session.repository';
import { ToolExecutionService } from '../tools/tool-execution.service';
import { LedgerError } from '../tools/tool-execution.repository';
import type {
  ExecutionPair,
  ToolExecutionRecord,
} from '../tools/tool-execution.repository';
import { ToolRegistry } from '../tools/tool-registry';
import type { ToolName } from '../tools/tool-registry';
import { buildContext } from './context.builder';
import { SessionStore } from './session.store';
import type { HistoryMessage } from './session.store';

export type TurnStatus = 'ok' | 'approval_required' | 'processing';

export interface ToolSummary {
  invocationId: string;
  name: ToolName;
}

export interface ApprovalSummary {
  approvalId: string;
  invocationId: string;
  tool: ToolName;
  args: Record<string, unknown>;
}

export interface TurnOutcome {
  status: TurnStatus;
  sessionId: string;
  requestId: string;
  reply: string;
  model: string;
  command?: CommandPayload;
  tool?: ToolSummary;
  approval?: ApprovalSummary;
  outcome?: 'rejected' | 'cancelled' | 'expired';
  /**
   * Durable execution payload, present only when the tool ran but the
   * final model response failed. Lets recovery deliver the persisted
   * result without re-executing or inventing model text.
   */
  result?: unknown;
}

export type ConversationStreamEvent =
  | { type: 'meta'; sessionId: string; model: string; requestId: string }
  | { type: 'token'; content: string }
  | { type: 'tool'; invocationId: string; name: ToolName; state: string }
  | { type: 'approval'; approval: ApprovalSummary; requestId: string }
  | {
      type: 'done';
      reply: string;
      model: string;
      requestId: string;
      status: TurnStatus;
      command?: CommandPayload;
      tool?: ToolSummary;
      approval?: ApprovalSummary;
      outcome?: 'rejected' | 'cancelled' | 'expired';
      result?: unknown;
    }
  | { type: 'error'; message: string; requestId?: string };

/** Structured command outcome for chat surfaces and future clients. */
export interface CommandPayload {
  kind: CommandResult['kind'];
  data?: Record<string, unknown>;
}

/** Model tag for deterministic command replies (never an LLM reply). */
const COMMAND_MODEL = 'core';

/** Completed ledger pairs injected per turn (newest context, bounded). */
const MAX_TOOL_PAIRS = 5;

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    private readonly sessions: SessionStore,
    private readonly llm: LlmClient,
    private readonly extractor: MemoryCandidateExtractor,
    private readonly candidates: MemoryCandidateRepository,
    private readonly commands: CommandDispatcher,
    private readonly skills: SkillService,
    private readonly tools: ToolExecutionService,
    private readonly registry: ToolRegistry,
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
  ) {}

  async converse(message: string, sessionId?: string): Promise<TurnOutcome> {
    // Slash commands short-circuit before conversation: no LLM, no
    // transcript writes, no memory extraction.
    if (this.commands.isCommand(message)) {
      const result = await this.commands.dispatch(message, sessionId);
      return {
        status: 'ok',
        sessionId: result.sessionId ?? sessionId ?? '',
        requestId: randomUUID(),
        reply: result.text,
        model: COMMAND_MODEL,
        command: toPayload(result),
      };
    }
    const { id } = await this.sessions.resolve(sessionId);
    const turn = await this.prepareTurn(id, message);
    const requestId = randomUUID();
    let proposal: LlmResult;
    try {
      proposal = await this.llm.chatWithTools({
        messages: turn.toolMessages,
        tools: turn.descriptors,
        sessionId: id,
      });
    } catch (err) {
      throw this.providerError(err);
    }
    let record: ToolExecutionRecord;
    try {
      record = await this.tools.consume({
        requestId,
        sessionId: id,
        context: turn.toolMessages,
        allowedTools: turn.allowedTools,
        proposal,
      });
    } catch (err) {
      throw this.ledgerError(err);
    }
    if (record.state !== 'invalid') {
      this.recordSkillTurn(id, turn.skills);
    }
    return this.renderTurn({
      sessionId: id,
      requestId,
      userText: message,
      history: turn.history,
      record,
    });
  }

  /**
   * Resume a parked request after an approval decision (or to poll a
   * running one). Only the owning session resumes; forks are denied.
   * Returns the durable outcome without re-executing anything.
   */
  async resumeTurn(requestId: string, sessionId: string): Promise<TurnOutcome> {
    let record: ToolExecutionRecord;
    try {
      record = await this.tools.resume(requestId, sessionId);
    } catch (err) {
      throw this.resumeError(err);
    }
    const userText = lastUserText(record);
    const history = await this.sessions.getContextMessages(record.sessionId);
    return this.renderTurn({
      sessionId: record.sessionId,
      requestId,
      userText,
      history,
      record,
    });
  }

  async history(sessionId: string): Promise<{
    sessionId: string;
    messages: HistoryMessage[];
  }> {
    const messages = await this.sessions.getHistory(sessionId);
    if (!messages) {
      throw new NotFoundException(`Unknown session "${sessionId}"`);
    }
    return { sessionId, messages };
  }

  /**
   * Streaming variant of the loop. Proposal and final tokens stream;
   * tool and approval progress arrive as structured events. History is
   * appended only through the guarded transcript claim; mid-stream
   * failures emit `error` and store nothing.
   */
  async converseStream(
    message: string,
    sessionId: string | undefined,
    emit: (event: ConversationStreamEvent) => void,
    clientSignal?: AbortSignal,
  ): Promise<void> {
    // Commands ride the stream as `meta` → `done` with no `token`
    // events: no LLM contact, nothing persisted as conversation.
    if (this.commands.isCommand(message)) {
      try {
        const result = await this.commands.dispatch(message, sessionId);
        const activeId = result.sessionId ?? sessionId;
        const requestId = randomUUID();
        if (activeId) {
          emit({
            type: 'meta',
            sessionId: activeId,
            model: COMMAND_MODEL,
            requestId,
          });
        }
        emit({
          type: 'done',
          reply: result.text,
          model: COMMAND_MODEL,
          requestId,
          status: 'ok',
          command: toPayload(result),
        });
      } catch (err) {
        emit({
          type: 'error',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
      return;
    }
    const { id } = await this.sessions.resolve(sessionId);
    const turn = await this.prepareTurn(id, message);
    const requestId = randomUUID();
    const sink: StreamSink = {
      onToken: (content) => emit({ type: 'token', content }),
    };

    // TODO(core.md): sentinel.evaluate (streaming) goes here.

    CommandDispatcher.trackStreamStart();
    try {
      emit({
        type: 'meta',
        sessionId: id,
        model: this.config.llmModel,
        requestId,
      });
      try {
        const proposal = await this.llm.chatStreamWithTools(
          {
            messages: turn.toolMessages,
            tools: turn.descriptors,
            sessionId: id,
          },
          sink,
          clientSignal,
        );
        const record = await this.tools.consume(
          {
            requestId,
            sessionId: id,
            context: turn.toolMessages,
            allowedTools: turn.allowedTools,
            proposal,
          },
          { sink, signal: clientSignal },
        );
        if (record.state !== 'invalid') {
          this.recordSkillTurn(id, turn.skills);
        }
        this.emitTurn(
          emit,
          await this.renderTurn({
            sessionId: id,
            requestId,
            userText: message,
            history: turn.history,
            record,
          }),
        );
      } catch (err) {
        emit({
          type: 'error',
          message: this.errorMessage(err),
          requestId,
        });
      }
    } finally {
      CommandDispatcher.trackStreamEnd();
    }
  }

  /** Streaming resume: same render pipeline, tokens stream from the final. */
  async resumeStream(
    requestId: string,
    sessionId: string,
    emit: (event: ConversationStreamEvent) => void,
    clientSignal?: AbortSignal,
  ): Promise<void> {
    CommandDispatcher.trackStreamStart();
    try {
      emit({
        type: 'meta',
        sessionId,
        model: this.config.llmModel,
        requestId,
      });
      try {
        const record = await this.tools.resume(requestId, sessionId, {
          sink: { onToken: (content) => emit({ type: 'token', content }) },
          signal: clientSignal,
        });
        const userText = lastUserText(record);
        const history = await this.sessions.getContextMessages(
          record.sessionId,
        );
        this.emitTurn(
          emit,
          await this.renderTurn({
            sessionId: record.sessionId,
            requestId,
            userText,
            history,
            record,
          }),
        );
      } catch (err) {
        emit({
          type: 'error',
          message: this.errorMessage(err),
          requestId,
        });
      }
    } finally {
      CommandDispatcher.trackStreamEnd();
    }
  }

  private emitTurn(
    emit: (event: ConversationStreamEvent) => void,
    outcome: TurnOutcome,
  ): void {
    if (outcome.tool) {
      emit({
        type: 'tool',
        invocationId: outcome.tool.invocationId,
        name: outcome.tool.name,
        state: outcome.status === 'ok' ? 'succeeded' : 'running',
      });
    }
    if (outcome.approval) {
      emit({
        type: 'approval',
        approval: outcome.approval,
        requestId: outcome.requestId,
      });
    }
    emit({
      type: 'done',
      reply: outcome.reply,
      model: outcome.model,
      requestId: outcome.requestId,
      status: outcome.status,
      ...(outcome.command ? { command: outcome.command } : {}),
      ...(outcome.tool ? { tool: outcome.tool } : {}),
      ...(outcome.approval ? { approval: outcome.approval } : {}),
      ...(outcome.outcome ? { outcome: outcome.outcome } : {}),
      ...(outcome.result !== undefined ? { result: outcome.result } : {}),
    });
  }

  private async prepareTurn(
    sessionId: string,
    message: string,
  ): Promise<{
    history: ChatMessage[];
    skills: ResolvedTurnSkills;
    toolMessages: LlmMessage[];
    descriptors: LlmToolRequest['tools'];
    allowedTools: ToolName[];
  }> {
    const history = await this.sessions.getContextMessages(sessionId);
    const skills = await this.skills.resolveTurnSkills(sessionId, message);
    const pairs = this.tools.recentPairs(sessionId, MAX_TOOL_PAIRS);
    const textMessages = this.prepareMessages(history, message, skills);
    // buildContext always ends with the new user message; pairs describe
    // earlier turns, so they precede it in recency order.
    const userMessage = textMessages[textMessages.length - 1];
    const toolMessages: LlmMessage[] = [
      ...textMessages.slice(0, -1),
      ...toPairMessages(pairs),
      userMessage,
    ];
    const descriptors = this.registry.list().slice();
    const allowedTools = descriptors.map((descriptor) => descriptor.name);
    return {
      history,
      skills,
      toolMessages,
      descriptors,
      allowedTools,
    };
  }

  /**
   * Translate a durable invocation record into the client-facing turn
   * outcome, performing the guarded transcript write and extraction
   * exactly when a new assistant text is produced.
   */
  private async renderTurn(input: {
    sessionId: string;
    requestId: string;
    userText: string;
    history: ChatMessage[];
    record: ToolExecutionRecord;
  }): Promise<TurnOutcome> {
    const { sessionId, requestId, userText, history, record } = input;
    if (record.state === 'invalid') {
      throw new BadGatewayException(
        'The model returned an unusable tool proposal.',
      );
    }
    if (record.state === 'closed') {
      if (
        record.validation.ok &&
        'textOnly' in record.validation &&
        record.input.proposal.kind === 'text'
      ) {
        return this.completeTextTurn({
          sessionId,
          requestId,
          userText,
          history,
          content: record.input.proposal.content,
          model: record.input.proposal.model,
        });
      }
      throw new BadGatewayException(
        'The model returned an unusable tool proposal.',
      );
    }
    if (record.state === 'awaiting_approval' && record.approvalId) {
      const approval = approvalSummary(record);
      if (!approval) throw new InternalServerErrorException();
      return {
        status: 'approval_required',
        sessionId,
        requestId,
        reply: `Tool '${approval.tool}' needs approval before it can run.`,
        model: record.input.proposal.model,
        tool: { invocationId: record.invocationId ?? '', name: approval.tool },
        approval,
      };
    }
    if (
      record.state === 'rejected' ||
      record.state === 'cancelled' ||
      record.state === 'expired'
    ) {
      const notice = mirrorNotice(record);
      await this.persistTurn({
        sessionId,
        requestId,
        userText,
        assistantText: notice,
        history,
        extract: false,
      });
      return {
        status: 'ok',
        sessionId,
        requestId,
        reply: notice,
        model: record.input.proposal.model,
        outcome: record.state,
      };
    }
    if (
      (record.state === 'succeeded' || record.state === 'failed') &&
      record.invocationId
    ) {
      const validation = record.validation;
      const name =
        validation.ok && 'request' in validation
          ? validation.request.name
          : ('session.search' as ToolName);
      const tool = { invocationId: record.invocationId, name };
      if (record.final.state === 'succeeded') {
        const content = record.final.result.content;
        const model = record.final.result.model;
        await this.persistTurn({
          sessionId,
          requestId,
          userText,
          assistantText: content,
          history,
          extract: true,
        });
        return {
          status: 'ok',
          sessionId,
          requestId,
          reply: content,
          model,
          tool,
        };
      }
      if (record.final.state === 'failed') {
        const notice = `Tool '${name}' ran, but the final response could not be completed.`;
        await this.persistTurn({
          sessionId,
          requestId,
          userText,
          assistantText: notice,
          history,
          extract: false,
        });
        return {
          status: 'ok',
          sessionId,
          requestId,
          reply: notice,
          model: record.input.proposal.model,
          tool,
          result: record.execution,
        };
      }
      return {
        status: 'processing',
        sessionId,
        requestId,
        reply: 'The tool is still running.',
        model: record.input.proposal.model,
      };
    }
    return {
      status: 'processing',
      sessionId,
      requestId,
      reply: 'The tool is still running.',
      model: record.input.proposal.model,
    };
  }

  private async completeTextTurn(input: {
    sessionId: string;
    requestId: string;
    userText: string;
    history: ChatMessage[];
    content: string;
    model: string;
  }): Promise<TurnOutcome> {
    await this.persistTurn({
      sessionId: input.sessionId,
      requestId: input.requestId,
      userText: input.userText,
      assistantText: input.content,
      history: input.history,
      extract: true,
    });
    return {
      status: 'ok',
      sessionId: input.sessionId,
      requestId: input.requestId,
      reply: input.content,
      model: input.model,
    };
  }

  /**
   * The single transcript write for a request. Only the transcript
   * claim winner appends; retries never duplicate rows.
   */
  private async persistTurn(input: {
    sessionId: string;
    requestId: string;
    userText: string;
    assistantText: string;
    history: ChatMessage[];
    extract: boolean;
  }): Promise<void> {
    if (!this.tools.claimTranscript(input.requestId)) return;
    const userRecord = await this.sessions.append(input.sessionId, {
      role: 'user',
      content: input.userText,
    });
    await this.sessions.append(input.sessionId, {
      role: 'assistant',
      content: input.assistantText,
    });
    if (input.extract) {
      this.extractTurn({
        sessionId: input.sessionId,
        userMessageId: userRecord.id,
        userMessage: input.userText,
        assistantMessage: input.assistantText,
        context: input.history,
      });
    }
  }

  private prepareMessages(
    history: ChatMessage[],
    message: string,
    turnSkills?: ResolvedTurnSkills,
  ): ChatMessage[] {
    // TODO(core.md): memory.recall goes here — retrieve relevant memories
    // for { input, session, profile } before building context.
    return buildContext(
      this.config.systemPrompt,
      history,
      message,
      this.config.maxHistory,
      turnSkills
        ? {
            catalog: this.skills.buildCatalogBlock(),
            explicit: turnSkills.explicit,
            requested: turnSkills.requested,
            contextual: turnSkills.contextual,
          }
        : undefined,
    );
  }

  private providerError(err: unknown): Error {
    if (err instanceof LlmError) {
      if (err.httpStatus === 504) {
        return new GatewayTimeoutException(err.message);
      }
      return new BadGatewayException(err.message);
    }
    return this.ledgerError(err);
  }

  private ledgerError(err: unknown): Error {
    if (err instanceof LedgerError) {
      return new InternalServerErrorException('Tool execution unavailable.');
    }
    if (err instanceof Error) throw err;
    throw new InternalServerErrorException();
  }

  private resumeError(err: unknown): Error {
    if (err instanceof LedgerError) {
      return new InternalServerErrorException('Tool execution unavailable.');
    }
    if (err instanceof Error) {
      if (err.message === 'request_not_found') {
        return new NotFoundException(`Unknown tool request.`);
      }
      if (err.message === 'invalid_session') {
        return new BadRequestException(
          'Tool request belongs to another session.',
        );
      }
      throw err;
    }
    throw new InternalServerErrorException();
  }

  private errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : 'Unknown error';
  }

  /**
   * Record what this completed turn injected (memory-only observability).
   * Skipped when skills are disabled, keeping disabled mode pristine;
   * failed turns record nothing, mirroring history semantics.
   */
  private recordSkillTurn(
    sessionId: string,
    resolved: ResolvedTurnSkills,
  ): void {
    if (!this.skills.enabled) return;
    const chars = (items: LoadedSkill[]): number =>
      items.reduce((total, skill) => total + skill.bodyChars, 0);
    const report: TurnSkillReport = {
      sessionId,
      explicit: resolved.explicit.map((skill) => skill.name),
      contextual: resolved.contextual.map((skill) => skill.name),
      requested: resolved.requested.map((skill) => skill.name),
      considered: resolved.considered,
      chars: {
        explicit: chars(resolved.explicit),
        requested: chars(resolved.requested),
        contextual: chars(resolved.contextual),
      },
    };
    this.skills.recordLastTurn(report);
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

/** Ledger pairs become assistant/tool messages with stable durable ids. */
function toPairMessages(pairs: ExecutionPair[]): LlmMessage[] {
  const messages: LlmMessage[] = [];
  for (const pair of pairs) {
    messages.push({
      role: 'assistant',
      content: pair.proposalContent,
      toolCalls: [
        {
          id: pair.invocationId,
          name: pair.name,
          version: pair.version,
          rawArguments: JSON.stringify(pair.args),
          args: pair.args,
        },
      ],
    });
    messages.push({
      role: 'tool',
      callId: pair.invocationId,
      content: JSON.stringify(pair.result),
    });
  }
  return messages;
}

function approvalSummary(
  record: ToolExecutionRecord,
): ApprovalSummary | undefined {
  if (!record.approvalId || !record.invocationId) return undefined;
  const validation = record.validation;
  if (!validation.ok || !('request' in validation)) return undefined;
  if (validation.request.name !== 'session.rename') return undefined;
  return {
    approvalId: record.approvalId,
    invocationId: record.invocationId,
    tool: validation.request.name,
    args: JSON.parse(JSON.stringify(validation.request.args)) as Record<
      string,
      unknown
    >,
  };
}

function mirrorNotice(record: ToolExecutionRecord): string {
  if (record.state === 'rejected') {
    return 'The session was not renamed: the request was rejected.';
  }
  if (record.state === 'cancelled') {
    return 'The session was not renamed: the request was cancelled.';
  }
  return 'The session was not renamed: the approval expired.';
}

function lastUserText(record: ToolExecutionRecord): string {
  const context = record.input.context;
  for (let index = context.length - 1; index >= 0; index--) {
    const message = context[index];
    if (message.role === 'user' && typeof message.content === 'string') {
      return message.content;
    }
  }
  throw new InternalServerErrorException();
}

function toPayload(result: CommandResult): CommandPayload {
  return {
    kind: result.kind,
    ...(result.data ? { data: result.data } : {}),
  };
}
