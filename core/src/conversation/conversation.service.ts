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
import { isDeepStrictEqual } from 'node:util';
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
import { PromotionService } from '../memory/promotion.service';
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
import type { AgentRun } from '../agent/agent-run.repository';
import { observationFromRecord } from '../agent/observation';
import {
  assembleTurnMessages,
  buildPlanningBlock,
} from '../agent/planning-context';
import type { PlanningProgress } from '../agent/planning-context';
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

/**
 * M9f termination mapping. Bounds force truthful terminals even when
 * an answer is delivered; denials end as delivered-but-blocked rather
 * than clean completions or failures.
 */
function terminalRun(input: {
  boundHit: boolean;
  deadlineHit: boolean;
  denied: boolean;
  toolSteps: number;
}): { state: AgentTerminalState; termination: RunTermination } {
  if (input.deadlineHit) {
    return {
      state: 'budget_exhausted',
      termination: { reason: 'time_budget', toolSteps: input.toolSteps },
    };
  }
  if (input.boundHit) {
    return {
      state: 'budget_exhausted',
      termination: { reason: 'step_bound', toolSteps: input.toolSteps },
    };
  }
  if (input.denied) {
    return {
      state: 'completed',
      termination: { reason: 'approval_denied', toolSteps: input.toolSteps },
    };
  }
  return {
    state: 'completed',
    termination: { reason: 'final_answer', toolSteps: input.toolSteps },
  };
}

/** Model tag for deterministic command replies (never an LLM reply). */
const COMMAND_MODEL = 'core';

/** Max tool executions per turn. Each step runs at most one call; approval-gated tools end the chain. */
export const MAX_TOOL_STEPS = 5;

/**
 * Backstop turn duration. Per-call LLM timeouts already bound healthy
 * turns; this ends pathological ones (repeated stalls) with a text
 * answer instead of more tool calls. M9g makes budgets configurable.
 */
export const MAX_TURN_DURATION_MS = 15 * 60 * 1000;

/** Default proposal-round budget; mirrors the step bound. */
export const MAX_ITERATIONS = 5;

/** Pure deadline check, exported for tests. */
export function turnDeadlineExceeded(
  startedAtMs: number,
  nowMs: number,
  limitMs: number = MAX_TURN_DURATION_MS,
): boolean {
  return nowMs - startedAtMs > limitMs;
}

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
    private readonly promotion: PromotionService,
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
    const startedAt = Date.now();
    const pairs: LlmMessage[] = [];
    const priorActions: string[] = [];
    let lastTool: ToolSummary | undefined;
    let toolSteps = 0;
    let boundHit = false;
    let deadlineHit = false;
    for (let step = 0; ; step++) {
      const requestId = randomUUID();
      const finalAttempt =
        step >= this.config.agentMaxIterations ||
        toolSteps >= this.config.agentMaxToolSteps ||
        turnDeadlineExceeded(
          startedAt,
          Date.now(),
          this.config.agentMaxTurnDurationMs,
        );
      this.transitionRun(runId, 'reasoning');
      const context = this.assembleStep(
        turn,
        message,
        turn.descriptors,
        pairs,
        {
          stepsUsed: step,
          toolCallsUsed: toolSteps,
          priorActions,
        },
      );
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
        priorActions.push(...proposal.toolCalls.map((call) => call.name));
      }
      // M9j skip before validation/execution: repeats never reach
      // the ledger, spawn no approval, and cost no tool execution.
      const skipped = this.skipRepeatedCall(context, proposal, finalAttempt);
      if (skipped) {
        this.transitionRun(runId, 'action_proposed');
        this.stepRun(runId, requestId, 0);
        pairs.push(skipped.assistant, skipped.tool);
        continue;
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
      // M9i recovery: a rejected proposal feeds its validation failure
      // back so the model can correct its arguments within budget.
      const rejection = this.validationFailurePair(record);
      if (rejection && !finalAttempt) {
        pairs.push(rejection.assistant, ...rejection.tools);
        continue;
      }
      const pair = this.continuationPair(record);
      if (pair) {
        toolSteps += 1;
        this.transitionRun(runId, 'observing');
      }
      if (pair && !finalAttempt) {
        lastTool = { invocationId: pair.invocationId, name: pair.name };
        pairs.push(pair.assistant, pair.tool);
        continue;
      }
      if (pair && finalAttempt) {
        // Bound or deadline reached with another search: finalize this
        // step's durable result through the standard tools-disabled
        // final call.
        boundHit =
          step >= this.config.agentMaxIterations ||
          toolSteps >= this.config.agentMaxToolSteps;
        deadlineHit = turnDeadlineExceeded(
          startedAt,
          Date.now(),
          this.config.agentMaxTurnDurationMs,
        );
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
      } else {
        // Forced answers (step bound, deadline) and denials terminate
        // truthfully rather than as clean completions. `processing`
        // counts as delivered: the background tool remains M8-governed
        // (M9l revisits this).
        const terminal = terminalRun({
          boundHit,
          deadlineHit,
          denied: outcome.outcome !== undefined,
          toolSteps,
        });
        this.finishRun(runId, terminal.state, terminal.termination);
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
    const stored = this.findRunRecord(sessionId, requestId);
    const storedId = stored?.id;
    this.transitionRun(storedId, 'executing');
    let record: ToolExecutionRecord;
    try {
      // Skip the tools-disabled final: a continuable run plans again
      // below, and the legacy path finalizes explicitly. Skipping is
      // safe — maybeFinal only acts on succeeded/failed rows with a
      // pending final.
      record = await this.tools.resume(requestId, sessionId, {
        skipFinal: true,
      });
    } catch (err) {
      this.finishRun(storedId, 'failed', {
        reason: 'turn_error',
        toolSteps: 0,
      });
      throw this.resumeError(err);
    }
    const userText = lastUserText(record);
    const history = await this.sessions.getContextMessages(record.sessionId);
    const entry = this.resumeObservationPair(record);
    // Only a parked run continues planning; anything else (no run,
    // terminal run, nothing executable to continue from) takes the
    // legacy single-shot path below.
    if (!stored || stored.state !== 'awaiting_approval' || !entry) {
      // Legacy single-shot path: no run, terminal run, or nothing to
      // continue from. settleResumeRecord converges terminal runs onto
      // their last step's durable answer and finalizes anything else.
      let settled: {
        record: ToolExecutionRecord;
        effectiveId: string;
      };
      try {
        settled = await this.settleResumeRecord(stored, requestId, sessionId);
      } catch (err) {
        this.finishRun(storedId, 'failed', {
          reason: 'turn_error',
          toolSteps: 0,
        });
        throw this.resumeError(err);
      }
      const settledUserText = lastUserText(settled.record);
      let outcome: TurnOutcome;
      try {
        outcome = await this.renderTurn({
          sessionId: settled.record.sessionId,
          requestId: settled.effectiveId,
          userText: settledUserText,
          history,
          record: settled.record,
        });
      } catch (err) {
        this.finishRun(storedId, 'failed', {
          reason: 'turn_error',
          toolSteps: 0,
        });
        throw err;
      }
      const terminal = terminalRun({
        boundHit: false,
        deadlineHit: false,
        denied: outcome.outcome !== undefined,
        toolSteps: 0,
      });
      this.finishRun(storedId, terminal.state, terminal.termination);
      return outcome;
    }
    // M9h continuation: the resolved observation re-enters bounded
    // planning against the run's remaining budget.
    const descriptors = this.registry.list().slice();
    const allowedTools = descriptors.map((descriptor) => descriptor.name);
    const limits = stored.limits;
    const startedAt = Date.now();
    // M9k: split the frozen turn context so the system head rebuilds
    // every round with fresh progress; the rest stays durable. Prompt
    // and catalog refresh from current config; skill bodies stay frozen
    // with the turn that loaded them.
    const prompt = this.config.systemPrompt.trim();
    const catalog = this.skills.buildCatalogBlock().trim();
    const resumeBase = [prompt, catalog].filter((part) => part !== '');
    const baseSystemText =
      resumeBase.length > 0 ? resumeBase.join('\n\n') : undefined;
    const [oldHead, ...oldRest] = record.input.context;
    const rest = oldHead?.role === 'system' ? oldRest : record.input.context;
    const approval = stored.approvalId
      ? {
          id: stored.approvalId,
          decision: record.state === 'succeeded' ? 'approved' : record.state,
        }
      : undefined;
    const pairs: LlmMessage[] = [entry.assistant, entry.tool];
    const priorActions: string[] = [entry.toolSummary.name];
    let lastTool: ToolSummary | undefined = entry.toolSummary;
    let newExecutions = 0;
    for (let step = stored.iterationCount; ; step++) {
      const finalAttempt =
        step >= limits.maxIterations ||
        stored.toolCallCount + newExecutions >= limits.maxToolSteps ||
        turnDeadlineExceeded(startedAt, Date.now(), limits.maxTurnDurationMs);
      this.transitionRun(storedId, 'reasoning');
      const context = this.assembleStep(
        { baseSystem: baseSystemText, rest },
        userText,
        descriptors,
        pairs,
        {
          stepsUsed: step,
          toolCallsUsed: stored.toolCallCount + newExecutions,
          priorActions,
          approval,
        },
      );
      let proposal: LlmResult;
      try {
        proposal = await this.llm.chatWithTools({
          messages: context,
          tools: finalAttempt ? [] : descriptors,
          ...(finalAttempt ? { toolChoice: 'none' as const } : {}),
          sessionId: record.sessionId,
        });
      } catch (err) {
        this.finishRun(storedId, 'failed', {
          reason: 'turn_error',
          toolSteps: stored.toolCallCount + newExecutions,
        });
        throw this.providerError(err);
      }
      if (proposal.kind === 'tool_calls') {
        priorActions.push(...proposal.toolCalls.map((call) => call.name));
      }
      // M9j skip before validation/execution: repeats never reach
      // the ledger, spawn no approval, and cost no tool execution.
      // The step still records its request id so the run audit stays
      // complete (observations skip ids with no ledger row).
      const stepRequestId = randomUUID();
      const skipped = this.skipRepeatedCall(context, proposal, finalAttempt);
      if (skipped) {
        this.transitionRun(storedId, 'action_proposed');
        this.stepRun(storedId, stepRequestId, 0);
        pairs.push(skipped.assistant, skipped.tool);
        continue;
      }
      if (proposal.kind === 'tool_calls') {
        this.transitionRun(storedId, 'action_proposed');
        this.transitionRun(storedId, 'executing');
      }
      let stepRecord: ToolExecutionRecord;
      try {
        stepRecord = await this.tools.consume(
          {
            requestId: stepRequestId,
            sessionId: record.sessionId,
            context,
            allowedTools,
            proposal,
          },
          { skipFinal: !finalAttempt },
        );
      } catch (err) {
        this.finishRun(storedId, 'failed', {
          reason: 'turn_error',
          toolSteps: stored.toolCallCount + newExecutions,
        });
        throw this.ledgerError(err);
      }
      this.stepRun(
        storedId,
        stepRequestId,
        proposal.kind === 'tool_calls' ? proposal.toolCalls.length : 0,
      );
      // M9i recovery: a rejected proposal feeds its validation failure
      // back so the model can correct its arguments within budget.
      const rejection = this.validationFailurePair(stepRecord);
      if (rejection && !finalAttempt) {
        pairs.push(rejection.assistant, ...rejection.tools);
        continue;
      }
      const pair = this.continuationPair(stepRecord);
      let boundHit = false;
      let deadlineHit = false;
      if (pair) {
        newExecutions += 1;
        this.transitionRun(storedId, 'observing');
      }
      if (pair && !finalAttempt) {
        lastTool = { invocationId: pair.invocationId, name: pair.name };
        pairs.push(pair.assistant, pair.tool);
        continue;
      }
      if (pair && finalAttempt) {
        boundHit =
          step >= limits.maxIterations ||
          stored.toolCallCount + newExecutions >= limits.maxToolSteps;
        deadlineHit = turnDeadlineExceeded(
          startedAt,
          Date.now(),
          limits.maxTurnDurationMs,
        );
        try {
          stepRecord = await this.tools.resume(stepRequestId, record.sessionId);
        } catch (err) {
          this.finishRun(storedId, 'failed', {
            reason: 'turn_error',
            toolSteps: stored.toolCallCount + newExecutions,
          });
          throw this.resumeError(err);
        }
      }
      let outcome: TurnOutcome;
      try {
        outcome = await this.renderTurn({
          sessionId: record.sessionId,
          requestId: stepRequestId,
          userText,
          history,
          record: stepRecord,
        });
      } catch (err) {
        this.finishRun(storedId, 'failed', {
          reason: 'turn_error',
          toolSteps: stored.toolCallCount + newExecutions,
        });
        throw err;
      }
      if (outcome.status === 'approval_required' && outcome.approval) {
        this.parkRun(storedId, outcome.approval.approvalId);
      } else {
        const terminal = terminalRun({
          boundHit,
          deadlineHit,
          denied: outcome.outcome !== undefined,
          toolSteps: stored.toolCallCount + newExecutions,
        });
        this.finishRun(storedId, terminal.state, terminal.termination);
      }
      if (outcome.status === 'ok' && !outcome.tool && lastTool) {
        outcome.tool = lastTool;
      }
      return outcome;
    }
  }

  /**
   * User-initiated cancellation of an agent run. Marks the run
   * terminal (`cancelled`) without touching M8 state: executing
   * invocations stay M8-governed, parked approvals keep their own
   * semantics and can still be approved or rejected afterwards.
   * Throws NotFound for unknown runs, BadRequest for foreign sessions.
   */
  cancelRun(runId: string, sessionId: string): AgentRun {
    let run: AgentRun;
    try {
      run = this.agentRuns.get(runId);
    } catch {
      throw new NotFoundException(`Unknown agent run "${runId}"`);
    }
    if (run.sessionId !== sessionId) {
      throw new BadRequestException('Agent run belongs to another session.');
    }
    const cancelled = this.agentRuns.cancelRun(runId);
    if (cancelled) return cancelled;
    return this.agentRuns.get(runId);
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
      const startedAt = Date.now();
      let toolSteps = 0;
      let boundHit = false;
      let deadlineHit = false;
      try {
        const pairs: LlmMessage[] = [];
        const priorActions: string[] = [];
        let currentRequestId = requestId;
        let lastTool: ToolSummary | undefined;
        for (let step = 0; ; step++) {
          const finalAttempt =
            step >= this.config.agentMaxIterations ||
            toolSteps >= this.config.agentMaxToolSteps ||
            turnDeadlineExceeded(
              startedAt,
              Date.now(),
              this.config.agentMaxTurnDurationMs,
            );
          this.transitionRun(runId, 'reasoning');
          const context = this.assembleStep(
            turn,
            message,
            turn.descriptors,
            pairs,
            {
              stepsUsed: step,
              toolCallsUsed: toolSteps,
              priorActions,
            },
          );
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
            priorActions.push(...proposal.toolCalls.map((call) => call.name));
          }
          // M9j skip before validation/execution: repeats never reach
          // the ledger, spawn no approval, and cost no tool execution.
          const skipped = this.skipRepeatedCall(
            context,
            proposal,
            finalAttempt,
          );
          if (skipped) {
            this.transitionRun(runId, 'action_proposed');
            currentRequestId = randomUUID();
            this.stepRun(runId, currentRequestId, 0);
            pairs.push(skipped.assistant, skipped.tool);
            continue;
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
          // M9i recovery: a rejected proposal feeds its validation
          // failure back so the model can correct within budget.
          const rejection = this.validationFailurePair(record);
          if (rejection && !finalAttempt) {
            pairs.push(rejection.assistant, ...rejection.tools);
            continue;
          }
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
            pairs.push(pair.assistant, pair.tool);
            currentRequestId = randomUUID();
            continue;
          }
          if (pair && finalAttempt) {
            boundHit =
              step >= this.config.agentMaxIterations ||
              toolSteps >= this.config.agentMaxToolSteps;
            deadlineHit = turnDeadlineExceeded(
              startedAt,
              Date.now(),
              this.config.agentMaxTurnDurationMs,
            );
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
          } else {
            const terminal = terminalRun({
              boundHit,
              deadlineHit,
              denied: outcome.outcome !== undefined,
              toolSteps,
            });
            this.finishRun(runId, terminal.state, terminal.termination);
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
      // Run tracking lives outside the guarded block so resume
      // failures can still terminate the run truthfully.
      let storedId: string | undefined;
      try {
        const stored = this.findRunRecord(sessionId, requestId);
        storedId = stored?.id;
        this.transitionRun(storedId, 'executing');
        let record: ToolExecutionRecord;
        try {
          record = await this.tools.resume(requestId, sessionId, {
            sink: { onToken: (content) => emit({ type: 'token', content }) },
            signal: clientSignal,
            skipFinal: true,
          });
        } catch (err) {
          this.finishRun(storedId, 'failed', {
            reason: 'turn_error',
            toolSteps: 0,
          });
          throw err;
        }
        const userText = lastUserText(record);
        const history = await this.sessions.getContextMessages(
          record.sessionId,
        );
        const entry = this.resumeObservationPair(record);
        if (!stored || stored.state !== 'awaiting_approval' || !entry) {
          // Legacy single-shot path: settleResumeRecord converges
          // terminal runs onto their last step's durable answer and
          // finalizes anything else.
          const streaming: {
            sink: StreamSink;
            signal?: AbortSignal;
          } = {
            sink: { onToken: (content) => emit({ type: 'token', content }) },
            signal: clientSignal,
          };
          let settled: {
            record: ToolExecutionRecord;
            effectiveId: string;
          };
          try {
            settled = await this.settleResumeRecord(
              stored,
              requestId,
              sessionId,
              streaming,
            );
          } catch (err) {
            this.finishRun(storedId, 'failed', {
              reason: 'turn_error',
              toolSteps: 0,
            });
            throw err;
          }
          const settledUserText = lastUserText(settled.record);
          let outcome: TurnOutcome;
          try {
            outcome = await this.renderTurn({
              sessionId: settled.record.sessionId,
              requestId: settled.effectiveId,
              userText: settledUserText,
              history,
              record: settled.record,
            });
          } catch (err) {
            this.finishRun(storedId, 'failed', {
              reason: 'turn_error',
              toolSteps: 0,
            });
            throw err;
          }
          const terminal = terminalRun({
            boundHit: false,
            deadlineHit: false,
            denied: outcome.outcome !== undefined,
            toolSteps: 0,
          });
          this.finishRun(storedId, terminal.state, terminal.termination);
          this.emitTurn(emit, outcome);
          return;
        }
        // M9h continuation: bounded planning over remaining budget.
        // Exactly one terminal done follows; intermediate searches emit
        // progress only.
        const descriptors = this.registry.list().slice();
        const allowedTools = descriptors.map((descriptor) => descriptor.name);
        const limits = stored.limits;
        const startedAt = Date.now();
        const sink: StreamSink = {
          onToken: (content) => emit({ type: 'token', content }),
        };
        // M9k: frozen rest plus a rebuilt head every round.
        const prompt = this.config.systemPrompt.trim();
        const catalog = this.skills.buildCatalogBlock().trim();
        const resumeBase = [prompt, catalog].filter((part) => part !== '');
        const baseSystemText =
          resumeBase.length > 0 ? resumeBase.join('\n\n') : undefined;
        const [oldHead, ...oldRest] = record.input.context;
        const rest =
          oldHead?.role === 'system' ? oldRest : record.input.context;
        const approval = stored.approvalId
          ? {
              id: stored.approvalId,
              decision:
                record.state === 'succeeded' ? 'approved' : record.state,
            }
          : undefined;
        const pairs: LlmMessage[] = [entry.assistant, entry.tool];
        const priorActions: string[] = [entry.toolSummary.name];
        let lastTool: ToolSummary | undefined = entry.toolSummary;
        let newExecutions = 0;
        for (let step = stored.iterationCount; ; step++) {
          const finalAttempt =
            step >= limits.maxIterations ||
            stored.toolCallCount + newExecutions >= limits.maxToolSteps ||
            turnDeadlineExceeded(
              startedAt,
              Date.now(),
              limits.maxTurnDurationMs,
            );
          this.transitionRun(storedId, 'reasoning');
          const context = this.assembleStep(
            { baseSystem: baseSystemText, rest },
            userText,
            descriptors,
            pairs,
            {
              stepsUsed: step,
              toolCallsUsed: stored.toolCallCount + newExecutions,
              priorActions,
              approval,
            },
          );
          let proposal: LlmResult;
          try {
            proposal = await this.llm.chatStreamWithTools(
              {
                messages: context,
                tools: finalAttempt ? [] : descriptors,
                ...(finalAttempt ? { toolChoice: 'none' as const } : {}),
                sessionId: record.sessionId,
              },
              sink,
              clientSignal,
            );
          } catch (err) {
            this.finishRun(storedId, 'failed', {
              reason: 'turn_error',
              toolSteps: stored.toolCallCount + newExecutions,
            });
            throw err;
          }
          if (proposal.kind === 'tool_calls') {
            priorActions.push(...proposal.toolCalls.map((call) => call.name));
          }
          // M9j skip before validation/execution: repeats never reach
          // the ledger, spawn no approval, and cost no tool execution.
          const stepRequestId = randomUUID();
          const skipped = this.skipRepeatedCall(
            context,
            proposal,
            finalAttempt,
          );
          if (skipped) {
            this.transitionRun(storedId, 'action_proposed');
            this.stepRun(storedId, stepRequestId, 0);
            pairs.push(skipped.assistant, skipped.tool);
            continue;
          }
          if (proposal.kind === 'tool_calls') {
            this.transitionRun(storedId, 'action_proposed');
            this.transitionRun(storedId, 'executing');
          }
          let stepRecord: ToolExecutionRecord;
          try {
            stepRecord = await this.tools.consume(
              {
                requestId: stepRequestId,
                sessionId: record.sessionId,
                context,
                allowedTools,
                proposal,
              },
              { sink, signal: clientSignal, skipFinal: !finalAttempt },
            );
          } catch (err) {
            this.finishRun(storedId, 'failed', {
              reason: 'turn_error',
              toolSteps: stored.toolCallCount + newExecutions,
            });
            throw err;
          }
          this.stepRun(
            storedId,
            stepRequestId,
            proposal.kind === 'tool_calls' ? proposal.toolCalls.length : 0,
          );
          // M9i recovery: a rejected proposal feeds its validation
          // failure back so the model can correct within budget.
          const rejection = this.validationFailurePair(stepRecord);
          if (rejection && !finalAttempt) {
            pairs.push(rejection.assistant, ...rejection.tools);
            continue;
          }
          const pair = this.continuationPair(stepRecord);
          let boundHit = false;
          let deadlineHit = false;
          if (pair) {
            newExecutions += 1;
            this.transitionRun(storedId, 'observing');
          }
          if (pair && !finalAttempt) {
            lastTool = { invocationId: pair.invocationId, name: pair.name };
            emit({
              type: 'tool',
              invocationId: pair.invocationId,
              name: pair.name,
              state: 'succeeded',
            });
            pairs.push(pair.assistant, pair.tool);
            continue;
          }
          if (pair && finalAttempt) {
            boundHit =
              step >= limits.maxIterations ||
              stored.toolCallCount + newExecutions >= limits.maxToolSteps;
            deadlineHit = turnDeadlineExceeded(
              startedAt,
              Date.now(),
              limits.maxTurnDurationMs,
            );
            try {
              stepRecord = await this.tools.resume(
                stepRequestId,
                record.sessionId,
                { sink, signal: clientSignal },
              );
            } catch (err) {
              this.finishRun(storedId, 'failed', {
                reason: 'turn_error',
                toolSteps: stored.toolCallCount + newExecutions,
              });
              throw err;
            }
          }
          let outcome: TurnOutcome;
          try {
            outcome = await this.renderTurn({
              sessionId: record.sessionId,
              requestId: stepRequestId,
              userText,
              history,
              record: stepRecord,
            });
          } catch (err) {
            this.finishRun(storedId, 'failed', {
              reason: 'turn_error',
              toolSteps: stored.toolCallCount + newExecutions,
            });
            throw err;
          }
          if (outcome.status === 'approval_required' && outcome.approval) {
            this.parkRun(storedId, outcome.approval.approvalId);
          } else {
            const terminal = terminalRun({
              boundHit,
              deadlineHit,
              denied: outcome.outcome !== undefined,
              toolSteps: stored.toolCallCount + newExecutions,
            });
            this.finishRun(storedId, terminal.state, terminal.termination);
          }
          if (outcome.status === 'ok' && !outcome.tool && lastTool) {
            outcome.tool = lastTool;
          }
          this.emitTurn(emit, outcome);
          return;
        }
      } catch (err) {
        const cancelled = clientSignal?.aborted === true;
        this.finishRun(storedId, cancelled ? 'cancelled' : 'failed', {
          reason: cancelled ? 'cancelled' : 'turn_error',
          toolSteps: 0,
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
   * Continuation for a completed step: the assistant/tool messages to
   * append before proposing again, mirroring the final-call shape.
   * Built from the step observation, so the loop reasons from the same
   * authoritative result the run records. Anything without a durable
   * execution (park, text, invalid, unfinished) ends the turn through
   * the standard render path.
   */
  /**
   * M9j repetition guard: count prior identical attempts (tool name +
   * deep-equal args) by scanning assistant tool-call messages in
   * context. Multi-call proposals are not eligible — they fail closed
   * as invalid instead. Zero means "not a repeat".
   */
  private priorAttempts(
    context: readonly LlmMessage[],
    name: ToolName,
    args: Record<string, unknown>,
  ): number {
    let attempts = 0;
    for (const message of context) {
      if (message.role !== 'assistant' || !('toolCalls' in message)) {
        continue;
      }
      for (const prior of message.toolCalls) {
        if (prior.name === name && isDeepStrictEqual(prior.args, args)) {
          attempts += 1;
        }
      }
    }
    return attempts;
  }

  /**
   * M9j skip: when a single call repeats a prior attempt and the turn
   * is not yet forced, return the echo pair (call plus duplicate
   * marker) instead of submitting to M8 — no ledger row, no
   * execution, no approval. Undefined when the proposal must flow to
   * validation/execution normally (including under a forced text
   * attempt, where the parser rejects calls outright).
   */
  private skipRepeatedCall(
    context: readonly LlmMessage[],
    proposal: LlmResult,
    finalAttempt: boolean,
  ): { assistant: LlmMessage; tool: LlmMessage } | undefined {
    if (
      proposal.kind !== 'tool_calls' ||
      proposal.toolCalls.length !== 1 ||
      finalAttempt
    ) {
      return undefined;
    }
    const call = proposal.toolCalls[0];
    const priorAttempts = this.priorAttempts(context, call.name, call.args);
    if (priorAttempts === 0) return undefined;
    return {
      assistant: {
        role: 'assistant',
        content: proposal.content,
        toolCalls: [{ ...call }],
      },
      tool: {
        role: 'tool',
        callId: call.id,
        content: JSON.stringify({
          ok: false,
          failure: { code: 'repeated_call', priorAttempts },
        }),
      },
    };
  }

  private continuationPair(record: ToolExecutionRecord):
    | {
        invocationId: string;
        name: ToolName;
        assistant: LlmMessage;
        tool: LlmMessage;
      }
    | undefined {
    if (record.state !== 'succeeded' && record.state !== 'failed') {
      return undefined;
    }
    const observation = observationFromRecord(record);
    if (!observation) {
      return undefined;
    }
    const proposal = record.input.proposal;
    if (proposal.kind !== 'tool_calls') return undefined;
    return {
      invocationId: observation.invocationId,
      name: observation.tool,
      assistant: {
        role: 'assistant',
        content: proposal.content,
        toolCalls: [{ ...proposal.toolCalls[0], id: observation.invocationId }],
      },
      tool: {
        role: 'tool',
        callId: observation.invocationId,
        content: JSON.stringify(observation.result),
      },
    };
  }

  /**
   * M9i recovery pair for a rejected proposal: the model's raw calls
   * with one error response each, so it can correct its arguments and
   * try again within budget. Nothing executed, nothing persisted as an
   * invocation — the failure payload is the ledger's own verdict.
   * Undefined unless the record is an invalid tool-call proposal.
   */
  private validationFailurePair(
    record: ToolExecutionRecord,
  ): { assistant: LlmMessage; tools: LlmMessage[] } | undefined {
    if (record.state !== 'invalid') return undefined;
    const proposal = record.input.proposal;
    if (proposal.kind !== 'tool_calls' || proposal.toolCalls.length === 0) {
      return undefined;
    }
    const failure = !record.validation.ok
      ? record.validation.failure
      : { code: 'invalid_proposal' };
    return {
      assistant: {
        role: 'assistant',
        content: proposal.content,
        toolCalls: proposal.toolCalls.map((call) => ({ ...call })),
      },
      tools: proposal.toolCalls.map((call): LlmMessage => ({
        role: 'tool',
        callId: call.id,
        content: JSON.stringify({ ok: false, failure }),
      })),
    };
  }

  /**
   * Entry pair resuming a parked turn: the executed result, or — for
   * mirrored rejections/cancellations/expiry, where no execution
   * exists — the denial as an observation built from durable ledger
   * state, never invented. Undefined when there is nothing to continue
   * from; the caller then falls back to the legacy single-shot render.
   */
  private resumeObservationPair(record: ToolExecutionRecord):
    | {
        assistant: LlmMessage;
        tool: LlmMessage;
        toolSummary: ToolSummary;
      }
    | undefined {
    const proposal = record.input.proposal;
    if (proposal.kind !== 'tool_calls' || !record.invocationId) {
      return undefined;
    }
    const validation = record.validation;
    if (!validation.ok || !('request' in validation)) return undefined;
    const assistant: LlmMessage = {
      role: 'assistant',
      content: proposal.content,
      toolCalls: [{ ...proposal.toolCalls[0], id: record.invocationId }],
    };
    const toolSummary: ToolSummary = {
      invocationId: record.invocationId,
      name: validation.request.name,
    };
    if (record.execution) {
      return {
        assistant,
        tool: {
          role: 'tool',
          callId: record.invocationId,
          content: JSON.stringify(record.execution),
        },
        toolSummary,
      };
    }
    if (
      record.state === 'rejected' ||
      record.state === 'cancelled' ||
      record.state === 'expired'
    ) {
      return {
        assistant,
        tool: {
          role: 'tool',
          callId: record.invocationId,
          content: JSON.stringify({ ok: false, outcome: record.state }),
        },
        toolSummary,
      };
    }
    return undefined;
  }

  /**
   * M9k per-step context: the static base plus a fresh planning frame
   * (goal, tool policies, budget, progress so far). Rebuilt every
   * proposal round so remaining budget never goes stale.
   */
  private assembleStep(
    turn: {
      baseSystem: string | undefined;
      rest: LlmMessage[];
    },
    goal: string,
    descriptors: LlmToolRequest['tools'],
    pairs: LlmMessage[],
    progress: PlanningProgress,
  ): LlmMessage[] {
    const block = buildPlanningBlock({
      goal,
      tools: descriptors,
      maxToolSteps: this.config.agentMaxToolSteps,
      maxIterations: this.config.agentMaxIterations,
      progress,
    });
    return assembleTurnMessages({
      baseSystem: turn.baseSystem,
      systemExtra: `${TOOL_STEP_INSTRUCTION}\n\n${block}`,
      rest: turn.rest,
      pairs,
    });
  }

  private async prepareTurn(
    sessionId: string,
    message: string,
  ): Promise<{
    history: ChatMessage[];
    skills: ResolvedTurnSkills;
    baseSystem: string | undefined;
    rest: LlmMessage[];
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
    // Split the static system head (prompt plus catalog) from the rest
    // so M9k rebuilds the planning frame every proposal round instead
    // of letting step counts go stale.
    const [head, ...tail] = toolMessages;
    const baseSystem = head?.role === 'system' ? head.content : undefined;
    const rest = head?.role === 'system' ? tail : toolMessages;
    return {
      history,
      skills,
      baseSystem,
      rest,
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
        limits: {
          maxIterations: this.config.agentMaxIterations,
          maxToolSteps: this.config.agentMaxToolSteps,
          maxTurnDurationMs: this.config.agentMaxTurnDurationMs,
        },
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

  private findRunRecord(
    sessionId: string,
    requestId: string,
  ): AgentRun | undefined {
    try {
      return this.agentRuns.findByRequest(sessionId, requestId);
    } catch (err) {
      this.trackingFailed(err);
      return undefined;
    }
  }

  /**
   * Settle a legacy resume (no continuation): converge terminal runs
   * onto their last step's durable answer, otherwise finalize the
   * given request explicitly (a no-op when already final). A durable
   * answer is a succeeded final or a closed text proposal — both
   * already transcript-claimed, so re-rendering writes nothing and
   * answers identically. Anything else falls back to finalizing the
   * request itself, preserving pre-continuation behavior including
   * crash-window recovery.
   */
  private async settleResumeRecord(
    stored: AgentRun | undefined,
    requestId: string,
    sessionId: string,
    streaming?: { sink: StreamSink; signal?: AbortSignal },
  ): Promise<{ record: ToolExecutionRecord; effectiveId: string }> {
    const options = {
      ...(streaming ? { sink: streaming.sink, signal: streaming.signal } : {}),
    };
    const terminal =
      stored &&
      (stored.state === 'completed' ||
        stored.state === 'failed' ||
        stored.state === 'cancelled' ||
        stored.state === 'budget_exhausted');
    const last =
      terminal && stored.requestIds[stored.requestIds.length - 1] !== requestId
        ? stored.requestIds[stored.requestIds.length - 1]
        : undefined;
    if (last) {
      const candidate = await this.tools.resume(last, sessionId, {
        ...options,
        skipFinal: true,
      });
      if (
        candidate.final.state === 'succeeded' ||
        (candidate.state === 'closed' &&
          candidate.validation.ok &&
          'textOnly' in candidate.validation)
      ) {
        return { record: candidate, effectiveId: last };
      }
      // Unfinalized tail (crash window): finalize it as recovery.
      const recovered = await this.tools.resume(last, sessionId, options);
      return { record: recovered, effectiveId: last };
    }
    const record = await this.tools.resume(requestId, sessionId, options);
    return { record, effectiveId: requestId };
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
        return this.candidates
          .saveCandidates(
            validated.map((candidate) => ({
              ...candidate,
              source: {
                sessionId: input.sessionId,
                messageId: input.userMessageId,
                // Old extractor versions predate the stamp; absence reads
                // 'unknown', never invented.
                role: candidate.sourceRole ?? 'unknown',
              },
              extractorModel: this.config.memoryLlmModel,
              extractorVersion: EXTRACTION_VERSION,
            })),
          )
          .then((saved) => {
            // Proposal is fire-and-forget inside fire-and-forget:
            // execution happens on the explicit sweep path, never here.
            if (saved) void this.promotion.proposeCandidates(saved);
          });
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
