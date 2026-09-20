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
import { AgentRunRepository } from '../agent/agent-run.repository';
import type {
  AgentTerminalState,
  AgentTransientState,
  RunTermination,
} from '../agent/agent-run.repository';
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

/** Max tool executions per turn. Each step runs at most one call; approval-gated tools end the chain. */
export const MAX_TOOL_STEPS = 5;

/**
 * Steering appended to the system prompt on tool-capable turns. The
 * ledger accepts exactly one call per step, so fan-out proposals fail
 * closed — chain sequential single calls instead.
 */
export const TOOL_STEP_INSTRUCTION =
  'You may use tools across multiple steps, but emit at most one tool call per response. When you have enough information, answer in plain text with no tool calls.';

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
    private readonly agentRuns: AgentRunRepository,
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
    // Bounded multi-step loop: each step proposes at most one call.
    // Approval-free searches chain (pair appended, propose again);
    // parks, text, and invalid proposals end the turn as before.
    const runId = this.startRun(id, message);
    let context = turn.toolMessages;
    let lastTool: ToolSummary | undefined;
    let toolSteps = 0;
    let boundHit = false;
    for (let step = 0; ; step++) {
      const requestId = randomUUID();
      const finalAttempt = step >= MAX_TOOL_STEPS;
      this.transitionRun(runId, 'reasoning');
      let proposal: LlmResult;
      try {
        proposal = await this.llm.chatWithTools({
          messages: context,
          tools: finalAttempt ? [] : turn.descriptors,
          ...(finalAttempt ? { toolChoice: 'none' as const } : {}),
          sessionId: id,
        });
      } catch (err) {
        this.finishRun(runId, 'failed', { reason: 'turn_error', toolSteps });
        throw this.providerError(err);
      }
      if (proposal.kind === 'tool_calls') {
        this.transitionRun(runId, 'action_proposed');
        this.transitionRun(runId, 'executing');
      }
      let record: ToolExecutionRecord;
      try {
        record = await this.tools.consume(
          {
            requestId,
            sessionId: id,
            context,
            allowedTools: turn.allowedTools,
            proposal,
          },
          // Intermediate steps skip the tools-disabled final call; the
          // loop either continues with the pair or finalizes below.
          { skipFinal: !finalAttempt },
        );
      } catch (err) {
        this.finishRun(runId, 'failed', { reason: 'turn_error', toolSteps });
        throw this.ledgerError(err);
      }
      this.stepRun(
        runId,
        requestId,
        proposal.kind === 'tool_calls' ? proposal.toolCalls.length : 0,
      );
      const pair = this.continuationPair(record);
      if (pair) {
        toolSteps += 1;
        this.transitionRun(runId, 'observing');
      }
      if (pair && !finalAttempt) {
        lastTool = { invocationId: pair.invocationId, name: pair.name };
        context = [...context, pair.assistant, pair.tool];
        continue;
      }
      if (pair && finalAttempt) {
        // Bound reached with another search: finalize this step's durable
        // result through the standard tools-disabled final call.
        boundHit = true;
        try {
          record = await this.tools.resume(requestId, id);
        } catch (err) {
          this.finishRun(runId, 'failed', { reason: 'turn_error', toolSteps });
          throw this.resumeError(err);
        }
      }
      if (record.state !== 'invalid') {
        this.recordSkillTurn(id, turn.skills);
      }
      let outcome: TurnOutcome;
      try {
        outcome = await this.renderTurn({
          sessionId: id,
          requestId,
          userText: message,
          history: turn.history,
          record,
        });
      } catch (err) {
        this.finishRun(runId, 'failed', { reason: 'turn_error', toolSteps });
        throw err;
      }
      if (outcome.status === 'approval_required' && outcome.approval) {
        this.parkRun(runId, outcome.approval.approvalId);
      } else if (boundHit) {
        // The model did not stop on its own: the step bound forced the
        // answer. Delivered, but truthfully not a clean completion.
        this.finishRun(runId, 'budget_exhausted', {
          reason: 'step_bound',
          toolSteps,
        });
      } else {
        // A delivered response completes the run, including `processing`
        // (the background tool remains M8-governed; M9l revisits this).
        this.finishRun(runId, 'completed', {
          reason: 'final_answer',
          toolSteps,
        });
      }
      if (outcome.status === 'ok' && !outcome.tool && lastTool) {
        outcome.tool = lastTool;
      }
      return outcome;
    }
  }

  /**
   * Resume a parked request after an approval decision (or to poll a
   * running one). Only the owning session resumes; forks are denied.
   * Returns the durable outcome without re-executing anything.
   */
  async resumeTurn(requestId: string, sessionId: string): Promise<TurnOutcome> {
    const runId = this.findRun(sessionId, requestId);
    this.transitionRun(runId, 'executing');
    let record: ToolExecutionRecord;
    try {
      record = await this.tools.resume(requestId, sessionId);
    } catch (err) {
      this.finishRun(runId, 'failed', { reason: 'turn_error', toolSteps: 0 });
      throw this.resumeError(err);
    }
    const userText = lastUserText(record);
    const history = await this.sessions.getContextMessages(record.sessionId);
    let outcome: TurnOutcome;
    try {
      outcome = await this.renderTurn({
        sessionId: record.sessionId,
        requestId,
        userText,
        history,
        record,
      });
    } catch (err) {
      this.finishRun(runId, 'failed', { reason: 'turn_error', toolSteps: 0 });
      throw err;
    }
    this.finishRun(runId, 'completed', {
      reason: 'final_answer',
      toolSteps: 0,
    });
    return outcome;
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
    // console.error(`🚀🚀🚀 FIRING CONVERSATION`);
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
      // Bounded multi-step loop, mirroring converse(): intermediate
      // searches emit progress only; exactly one terminal done follows.
      // Run tracking lives outside the guarded block so stream failures
      // can still terminate the run truthfully (cancelled vs failed).
      const runId = this.startRun(id, message);
      let toolSteps = 0;
      let boundHit = false;
      try {
        let context = turn.toolMessages;
        let currentRequestId = requestId;
        let lastTool: ToolSummary | undefined;
        for (let step = 0; ; step++) {
          const finalAttempt = step >= MAX_TOOL_STEPS;
          this.transitionRun(runId, 'reasoning');
          let proposal: LlmResult;
          try {
            proposal = await this.llm.chatStreamWithTools(
              {
                messages: context,
                tools: finalAttempt ? [] : turn.descriptors,
                ...(finalAttempt ? { toolChoice: 'none' as const } : {}),
                sessionId: id,
              },
              sink,
              clientSignal,
            );
          } catch (err) {
            this.finishRun(runId, 'failed', {
              reason: 'turn_error',
              toolSteps,
            });
            throw err;
          }
          if (proposal.kind === 'tool_calls') {
            this.transitionRun(runId, 'action_proposed');
            this.transitionRun(runId, 'executing');
          }
          let record: ToolExecutionRecord;
          try {
            record = await this.tools.consume(
              {
                requestId: currentRequestId,
                sessionId: id,
                context,
                allowedTools: turn.allowedTools,
                proposal,
              },
              { sink, signal: clientSignal, skipFinal: !finalAttempt },
            );
          } catch (err) {
            this.finishRun(runId, 'failed', {
              reason: 'turn_error',
              toolSteps,
            });
            throw err;
          }
          this.stepRun(
            runId,
            currentRequestId,
            proposal.kind === 'tool_calls' ? proposal.toolCalls.length : 0,
          );
          const pair = this.continuationPair(record);
          if (pair) {
            toolSteps += 1;
            this.transitionRun(runId, 'observing');
          }
          if (pair && !finalAttempt) {
            lastTool = { invocationId: pair.invocationId, name: pair.name };
            emit({
              type: 'tool',
              invocationId: pair.invocationId,
              name: pair.name,
              state: 'succeeded',
            });
            context = [...context, pair.assistant, pair.tool];
            currentRequestId = randomUUID();
            continue;
          }
          if (pair && finalAttempt) {
            boundHit = true;
            try {
              record = await this.tools.resume(currentRequestId, id, {
                sink,
                signal: clientSignal,
              });
            } catch (err) {
              this.finishRun(runId, 'failed', {
                reason: 'turn_error',
                toolSteps,
              });
              throw err;
            }
          }
          if (record.state !== 'invalid') {
            this.recordSkillTurn(id, turn.skills);
          }
          let outcome: TurnOutcome;
          try {
            outcome = await this.renderTurn({
              sessionId: id,
              requestId: currentRequestId,
              userText: message,
              history: turn.history,
              record,
            });
          } catch (err) {
            this.finishRun(runId, 'failed', {
              reason: 'turn_error',
              toolSteps,
            });
            throw err;
          }
          if (outcome.status === 'approval_required' && outcome.approval) {
            this.parkRun(runId, outcome.approval.approvalId);
          } else if (boundHit) {
            this.finishRun(runId, 'budget_exhausted', {
              reason: 'step_bound',
              toolSteps,
            });
          } else {
            this.finishRun(runId, 'completed', {
              reason: 'final_answer',
              toolSteps,
            });
          }
          if (outcome.status === 'ok' && !outcome.tool && lastTool) {
            outcome.tool = lastTool;
          }
          this.emitTurn(emit, outcome);
          return;
        }
      } catch (err) {
        // A disconnected client cancels the run; anything else fails it.
        const cancelled = clientSignal?.aborted === true;
        this.finishRun(runId, cancelled ? 'cancelled' : 'failed', {
          reason: cancelled ? 'cancelled' : 'turn_error',
          toolSteps,
        });
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
        const runId = this.findRun(sessionId, requestId);
        this.transitionRun(runId, 'executing');
        const record = await this.tools.resume(requestId, sessionId, {
          sink: { onToken: (content) => emit({ type: 'token', content }) },
          signal: clientSignal,
        });
        const userText = lastUserText(record);
        const history = await this.sessions.getContextMessages(
          record.sessionId,
        );
        let outcome: TurnOutcome;
        try {
          outcome = await this.renderTurn({
            sessionId: record.sessionId,
            requestId,
            userText,
            history,
            record,
          });
        } catch (err) {
          this.finishRun(runId, 'failed', {
            reason: 'turn_error',
            toolSteps: 0,
          });
          throw err;
        }
        this.finishRun(runId, 'completed', {
          reason: 'final_answer',
          toolSteps: 0,
        });
        this.emitTurn(emit, outcome);
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

  /**
   * Continuation for a completed approval-free search step: the
   * assistant/tool messages to append before proposing again, mirroring
   * the final-call shape. Anything else (park, text, invalid,
   * unfinished) ends the turn through the standard render path.
   */
  private continuationPair(record: ToolExecutionRecord):
    | {
        invocationId: string;
        name: ToolName;
        assistant: LlmMessage;
        tool: LlmMessage;
      }
    | undefined {
    if (
      (record.state !== 'succeeded' && record.state !== 'failed') ||
      !record.invocationId ||
      !record.execution
    )
      return undefined;
    const validation = record.validation;
    if (!validation.ok || !('request' in validation)) return undefined;
    if (validation.request.name !== 'session.search') return undefined;
    const proposal = record.input.proposal;
    if (proposal.kind !== 'tool_calls') return undefined;
    return {
      invocationId: record.invocationId,
      name: validation.request.name,
      assistant: {
        role: 'assistant',
        content: proposal.content,
        toolCalls: [{ ...proposal.toolCalls[0], id: record.invocationId }],
      },
      tool: {
        role: 'tool',
        callId: record.invocationId,
        content: JSON.stringify(record.execution),
      },
    };
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
    // Steer one-call-per-step tool use. buildContext leads with the system
    // message whenever a prompt or catalog exists; otherwise stage one.
    const [head, ...tail] = toolMessages;
    const stepped: LlmMessage[] =
      head?.role === 'system'
        ? [
            { ...head, content: `${head.content}\n\n${TOOL_STEP_INSTRUCTION}` },
            ...tail,
          ]
        : [{ role: 'system', content: TOOL_STEP_INSTRUCTION }, ...toolMessages];
    return {
      history,
      skills,
      toolMessages: stepped,
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
   * M9a run tracking. Best-effort by design: observation must never
   * fail a conversation turn, so every tracking call is isolated and
   * failures are logged and dropped.
   */
  private startRun(sessionId: string, goal: string): string | undefined {
    try {
      return this.agentRuns.createRun({
        sessionId,
        goal,
        limits: { maxToolSteps: MAX_TOOL_STEPS },
      }).id;
    } catch (err) {
      this.trackingFailed(err);
      return undefined;
    }
  }

  private stepRun(
    runId: string | undefined,
    requestId: string,
    toolCalls: number,
  ): void {
    if (!runId) return;
    try {
      this.agentRuns.recordStep(runId, { requestId, toolCalls });
    } catch (err) {
      this.trackingFailed(err);
    }
  }

  private parkRun(runId: string | undefined, approvalId: string): void {
    if (!runId) return;
    try {
      this.agentRuns.markParked(runId, approvalId);
    } catch (err) {
      this.trackingFailed(err);
    }
  }

  private transitionRun(
    runId: string | undefined,
    state: AgentTransientState,
  ): void {
    if (!runId) return;
    try {
      this.agentRuns.transitionRun(runId, state);
    } catch (err) {
      this.trackingFailed(err);
    }
  }

  private finishRun(
    runId: string | undefined,
    state: AgentTerminalState,
    termination: RunTermination,
  ): void {
    if (!runId) return;
    try {
      this.agentRuns.markTerminal(runId, state, termination);
    } catch (err) {
      this.trackingFailed(err);
    }
  }

  private findRun(sessionId: string, requestId: string): string | undefined {
    try {
      return this.agentRuns.findByRequest(sessionId, requestId)?.id;
    } catch (err) {
      this.trackingFailed(err);
      return undefined;
    }
  }

  private trackingFailed(err: unknown): void {
    this.logger.warn(
      `Agent run tracking failed: ${
        err instanceof Error ? err.message : 'unknown error'
      }`,
    );
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
