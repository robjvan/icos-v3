import { isDeepStrictEqual } from 'node:util';
import type { SessionStore } from '../conversation/session.store';
import type { LlmClient } from '../llm/llm.client';
import { ToolOffer } from '../llm/llm.protocol';
import type { LlmResult, LlmToolCall } from '../llm/llm.protocol';
import { ToolRegistry } from './tool-registry';
import { ToolExecutionRepository } from './tool-execution.repository';
import type {
  ExecutionOutcome,
  FinalOutcome,
  ToolExecutionInput,
  ToolExecutionRecord,
  ValidationOutcome,
} from './tool-execution.repository';

export type { ToolExecutionInput } from './tool-execution.repository';

const MAX_RESULT_BYTES = 64 * 1024;

export class ToolExecutionService {
  private readonly searchTimeoutMs: number;
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly ledger: ToolExecutionRepository,
    private readonly sessions: Pick<SessionStore, 'searchMessages'>,
    private readonly registry: ToolRegistry,
    private readonly llm: Pick<LlmClient, 'chatWithTools'>,
    options: { searchTimeoutMs?: number } = {},
  ) {
    this.searchTimeoutMs = options.searchTimeoutMs ?? 2000;
    if (
      !Number.isInteger(this.searchTimeoutMs) ||
      this.searchTimeoutMs < 1 ||
      this.searchTimeoutMs > 10000
    )
      throw new Error('invalid_search_timeout');
  }

  async consume(input: ToolExecutionInput): Promise<ToolExecutionRecord> {
    let snapshot: string;
    let captured: ToolExecutionInput;
    try {
      snapshot = JSON.stringify(input);
      captured = JSON.parse(snapshot) as ToolExecutionInput;
      if (!isDeepStrictEqual(input, captured)) throw new Error();
      if (
        !captured.requestId.trim() ||
        !captured.sessionId.trim() ||
        !Array.isArray(captured.allowedTools)
      )
        throw new Error();
    } catch {
      throw new Error('invalid_request');
    }
    let record = this.ledger.register(snapshot, (saved) =>
      this.validate(saved),
    );
    if (record.state === 'executing' && record.ownership === 'released') {
      this.ledger.resolveReleasedToUnknown(record.requestId);
      record = this.required(record.requestId);
    }
    if (record.state === 'validated') {
      const token = this.ledger.claimSearch(record.requestId, (saved) =>
        this.validate(saved),
      );
      if (token) {
        record = this.required(record.requestId);
        const searchPromise = this.search(record);
        const outcomePromise = searchPromise.then(
          (outcome) => ({ kind: 'outcome' as const, outcome }),
          (): { kind: 'outcome'; outcome: ExecutionOutcome } => ({
            kind: 'outcome',
            outcome: { ok: false, failure: { code: 'search_failed' } },
          }),
        );
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<{ kind: 'timeout' }>((resolve) => {
          timeoutId = setTimeout(
            () => resolve({ kind: 'timeout' }),
            this.searchTimeoutMs,
          );
        });
        const winner = await Promise.race([outcomePromise, timeoutPromise]);
        if (winner.kind === 'outcome') {
          if (timeoutId !== undefined) clearTimeout(timeoutId);
          this.ledger.finishSearch(record.requestId, token, winner.outcome);
        } else {
          const background = outcomePromise.then(({ outcome }) => {
            try {
              this.ledger.finishSearch(record.requestId, token, outcome);
            } catch {
              // Leave the claim ambiguous; explicit release resolves it.
            }
          });
          const tracked = background.finally(() => {
            if (this.inFlight.get(record.requestId) === tracked)
              this.inFlight.delete(record.requestId);
          });
          this.inFlight.set(record.requestId, tracked);
          return this.required(record.requestId);
        }
      }
      record = this.required(record.requestId);
    }
    if (
      (record.state === 'succeeded' || record.state === 'failed') &&
      record.final.state === 'pending'
    ) {
      const token = this.ledger.claimFinal(record.requestId);
      if (token) {
        const durable = this.required(record.requestId);
        const outcome = await this.respond(durable);
        this.ledger.finishFinal(record.requestId, token, outcome);
      }
    }
    return this.required(record.requestId);
  }

  private validate(input: ToolExecutionInput): ValidationOutcome {
    try {
      new ToolOffer({ messages: input.context, tools: [], toolChoice: 'none' });
    } catch {
      return { ok: false, failure: { code: 'invalid_context' } };
    }
    const proposal = input.proposal;
    if (
      !proposal ||
      typeof proposal !== 'object' ||
      typeof proposal.model !== 'string' ||
      !proposal.model.trim() ||
      (proposal.content !== null && typeof proposal.content !== 'string') ||
      (proposal.kind === 'text' && !proposal.content?.trim())
    )
      return { ok: false, failure: { code: 'invalid_proposal' } };
    if (proposal.kind === 'text') {
      if (
        typeof proposal.content !== 'string' ||
        'toolCalls' in proposal ||
        'tool_calls' in proposal
      )
        return { ok: false, failure: { code: 'invalid_proposal' } };
      return { ok: true, textOnly: true };
    }
    if (proposal.kind !== 'tool_calls' || !Array.isArray(proposal.toolCalls))
      return { ok: false, failure: { code: 'invalid_proposal' } };
    if (proposal.toolCalls.length !== 1)
      return { ok: false, failure: { code: 'invalid_call_count' } };
    const call = proposal.toolCalls[0] as LlmToolCall;
    const validation = this.registry.validate(
      { name: call.name, version: call.version, args: call.args },
      { sessionId: input.sessionId, allowedTools: input.allowedTools },
    );
    if (!validation.ok)
      return { ok: false, failure: { code: validation.failure.code } };
    const descriptor = this.registry.lookup(validation.request.name);
    if (validation.request.name === 'session.search') {
      if (descriptor?.approval !== 'none')
        return { ok: false, failure: { code: 'unpermitted_tool' } };
    } else {
      if (descriptor?.approval !== 'required')
        return { ok: false, failure: { code: 'unpermitted_tool' } };
    }
    try {
      if (
        typeof call.rawArguments !== 'string' ||
        Buffer.byteLength(call.rawArguments) > MAX_RESULT_BYTES ||
        !isDeepStrictEqual(JSON.parse(call.rawArguments) as unknown, call.args)
      )
        return { ok: false, failure: { code: 'argument_mismatch' } };
    } catch {
      return { ok: false, failure: { code: 'argument_mismatch' } };
    }
    return validation;
  }

  private async search(record: ToolExecutionRecord): Promise<ExecutionOutcome> {
    const validation = record.validation;
    if (
      !validation.ok ||
      !('request' in validation) ||
      validation.request.name !== 'session.search'
    )
      throw new Error('invalid_execution_state');
    try {
      const matches = await this.sessions.searchMessages(
        validation.request.args.query,
        {
          sessionId: record.sessionId,
          limit: validation.request.args.limit,
        },
      );
      const outcome: ExecutionOutcome = { ok: true, matches };
      const serialized = JSON.stringify(outcome);
      if (Buffer.byteLength(serialized) > MAX_RESULT_BYTES)
        return { ok: false, failure: { code: 'result_too_large' } };
      return JSON.parse(serialized) as ExecutionOutcome;
    } catch {
      return { ok: false, failure: { code: 'search_failed' } };
    }
  }

  private async respond(
    record: ToolExecutionRecord,
  ): Promise<Extract<FinalOutcome, { state: 'succeeded' | 'failed' }>> {
    const proposal = record.input.proposal;
    if (
      proposal.kind !== 'tool_calls' ||
      !record.invocationId ||
      !record.execution
    )
      throw new Error('invalid_final_state');
    let result: LlmResult;
    try {
      result = await this.llm.chatWithTools({
        sessionId: record.sessionId,
        messages: [
          ...record.input.context,
          {
            role: 'assistant',
            content: proposal.content,
            toolCalls: [{ ...proposal.toolCalls[0], id: record.invocationId }],
          },
          {
            role: 'tool',
            callId: record.invocationId,
            content: JSON.stringify(record.execution),
          },
        ],
        tools: [],
        toolChoice: 'none',
      });
    } catch {
      return { state: 'failed', failure: { code: 'llm_failed' } };
    }
    if (
      !result ||
      result.kind !== 'text' ||
      typeof result.content !== 'string' ||
      !result.content.trim() ||
      typeof result.model !== 'string' ||
      'toolCalls' in result ||
      'tool_calls' in result
    )
      return { state: 'failed', failure: { code: 'invalid_final' } };
    const text: Extract<LlmResult, { kind: 'text' }> = {
      kind: 'text',
      content: result.content,
      model: result.model,
    };
    if (Buffer.byteLength(JSON.stringify(text)) > MAX_RESULT_BYTES)
      return { state: 'failed', failure: { code: 'final_too_large' } };
    return { state: 'succeeded', result: text };
  }

  private required(requestId: string): ToolExecutionRecord {
    const record = this.ledger.get(requestId);
    if (!record) throw new Error('request_not_found');
    return record;
  }
}
