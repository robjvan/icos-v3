import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Injectable } from '@nestjs/common';
import { SessionDatabaseService } from '../session/session-database.service';
import type { SessionSearchResult } from '../session/session.repository';
import type { LlmMessage, LlmResult } from '../llm/llm.protocol';
import type {
  ToolName,
  ToolValidationFailureCode,
  ValidatedToolRequest,
} from './tool-registry';

export interface ToolExecutionInput {
  requestId: string;
  sessionId: string;
  context: LlmMessage[];
  allowedTools: readonly ToolName[];
  proposal: LlmResult;
}

export type ValidationOutcome =
  | { ok: true; request: ValidatedToolRequest }
  | { ok: true; textOnly: true }
  | {
      ok: false;
      failure: {
        code:
          | ToolValidationFailureCode
          | 'invalid_call_count'
          | 'argument_mismatch'
          | 'invalid_proposal'
          | 'invalid_context';
      };
    };

export type ExecutionOutcome =
  | { ok: true; matches: SessionSearchResult[] }
  | {
      ok: false;
      failure: {
        code: 'search_failed' | 'result_too_large' | 'unknown';
      };
    };

export type FinalOutcome =
  | { state: 'not_required'; result?: Extract<LlmResult, { kind: 'text' }> }
  | { state: 'pending' | 'claimed' }
  | { state: 'succeeded'; result: Extract<LlmResult, { kind: 'text' }> }
  | {
      state: 'failed';
      failure: { code: 'llm_failed' | 'invalid_final' | 'final_too_large' };
    };

export type MirrorOutcomeState = 'rejected' | 'cancelled' | 'expired';

export interface RenameResult {
  sessionId: string;
  title: string;
}

export type RenameOutcome =
  | { ok: true; renamed: RenameResult }
  | { ok: false; failure: { code: 'rename_failed' } };

export interface ToolExecutionRecord {
  requestId: string;
  sessionId: string;
  input: ToolExecutionInput;
  invocationId: string | null;
  approvalId: string | null;
  state:
    | 'closed'
    | 'invalid'
    | 'validated'
    | 'awaiting_approval'
    | 'executing'
    | 'succeeded'
    | 'failed'
    | MirrorOutcomeState;
  validation: ValidationOutcome;
  execution: ExecutionOutcome | RenameOutcome | null;
  final: FinalOutcome;
  executionToken: string | null;
  ownership: 'unconfirmed' | 'released' | 'none';
}

interface Row {
  request_id: string;
  session_id: string;
  input_json: string;
  invocation_id: string | null;
  approval_id: string | null;
  state: ToolExecutionRecord['state'];
  validation_json: string;
  execution_json: string | null;
  final_json: string;
  execution_token: string | null;
  ownership: 'unconfirmed' | 'released';
}

function nowIso(): string {
  return new Date().toISOString();
}

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

/**
 * Durable pairing data for one completed invocation, used to rebuild
 * model context from execution history (the ledger, not the
 * transcript, is the authority on what a tool returned).
 */
export interface ExecutionPair {
  invocationId: string;
  proposalContent: string | null;
  name: ToolName;
  version: 1;
  args: Record<string, unknown>;
  result: unknown;
}

@Injectable()
export class ToolExecutionRepository {
  constructor(private readonly database: SessionDatabaseService) {}

  private access<T>(action: () => T): T {
    try {
      return action();
    } catch (error) {
      if (error instanceof LedgerError) throw error;
      throw new LedgerError('ledger_unavailable');
    }
  }

  get(requestId: string): ToolExecutionRecord | null {
    return this.access(() => {
      const row = this.database.connection
        .prepare('SELECT * FROM tool_requests WHERE request_id = ?')
        .get(requestId) as Row | undefined;
      if (!row) return null;
      return {
        requestId: row.request_id,
        sessionId: row.session_id,
        input: JSON.parse(row.input_json) as ToolExecutionInput,
        invocationId: row.invocation_id,
        approvalId: row.approval_id,
        state: row.state,
        validation: JSON.parse(row.validation_json) as ValidationOutcome,
        execution:
          row.execution_json === null
            ? null
            : (JSON.parse(row.execution_json) as
                ExecutionOutcome | RenameOutcome),
        final: JSON.parse(row.final_json) as FinalOutcome,
        executionToken: row.execution_token,
        ownership: row.state === 'executing' ? row.ownership : 'none',
      };
    });
  }

  register(
    snapshot: string,
    validate: (input: ToolExecutionInput) => ValidationOutcome,
  ): ToolExecutionRecord {
    return this.access(() =>
      this.database.connection
        .transaction(() => {
          const input = JSON.parse(snapshot) as ToolExecutionInput;
          const prior = this.get(input.requestId);
          if (prior) {
            if (!isDeepStrictEqual(prior.input, input))
              throw new LedgerError('request_conflict');
            return prior;
          }
          this.requireSession(input.sessionId);
          const validation = validate(input);
          const request =
            validation.ok && 'request' in validation
              ? validation.request
              : null;
          const state = !validation.ok
            ? 'invalid'
            : request
              ? 'validated'
              : 'closed';
          const final: FinalOutcome =
            state === 'closed' && input.proposal.kind === 'text'
              ? { state: 'not_required', result: input.proposal }
              : { state: 'not_required' };
          const invocationId =
            input.proposal?.kind === 'tool_calls' &&
            Array.isArray(input.proposal.toolCalls) &&
            input.proposal.toolCalls.length === 1
              ? randomUUID()
              : null;
          const approvalId: string | null = null;
          // No tool currently parks for approval (rename was
          // de-escalated). Pre-flip parked rows keep their stored
          // approval ids and resume paths; nothing new mints them.
          this.database.connection
            .prepare(
              `INSERT INTO tool_requests
        (request_id, session_id, input_json, invocation_id, approval_id, state, validation_json, execution_token, ownership, final_state, final_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'unconfirmed', ?, ?)`,
            )
            .run(
              input.requestId,
              input.sessionId,
              snapshot,
              invocationId,
              approvalId,
              state,
              JSON.stringify(validation),
              final.state,
              JSON.stringify(final),
            );
          return this.required(input.requestId);
        })
        .immediate(),
    );
  }

  claimSearch(
    requestId: string,
    revalidate: (input: ToolExecutionInput) => ValidationOutcome,
  ): string | null {
    return this.access(() =>
      this.database.connection
        .transaction(() => {
          const record = this.required(requestId);
          if (record.state !== 'validated') return null;
          this.requireSession(record.sessionId);
          const validation = revalidate(record.input);
          if (
            !validation.ok ||
            !('request' in validation) ||
            validation.request.name !== 'session.search' ||
            !isDeepStrictEqual(validation, record.validation)
          ) {
            const failure: ValidationOutcome = validation.ok
              ? { ok: false, failure: { code: 'unpermitted_tool' } }
              : validation;
            this.database.connection
              .prepare(
                "UPDATE tool_requests SET state = 'invalid', validation_json = ? WHERE request_id = ? AND state = 'validated'",
              )
              .run(JSON.stringify(failure), requestId);
            return null;
          }
          const token = randomUUID();
          const result = this.database.connection
            .prepare(
              "UPDATE tool_requests SET state = 'executing', execution_token = ? WHERE request_id = ? AND state = 'validated' AND execution_token IS NULL",
            )
            .run(token, requestId);
          return result.changes === 1 ? token : null;
        })
        .immediate(),
    );
  }

  releaseOwner(token: string): boolean {
    return (
      this.access(() =>
        this.database.connection
          .prepare(
            "UPDATE tool_requests SET ownership = 'released' WHERE execution_token = ? AND state = 'executing' AND ownership = 'unconfirmed'",
          )
          .run(token),
      ).changes === 1
    );
  }

  finishSearch(
    requestId: string,
    token: string,
    outcome: ExecutionOutcome,
  ): void {
    this.access(() =>
      this.database.connection
        .transaction(() => {
          const result = this.database.connection
            .prepare(
              `UPDATE tool_requests
        SET state = ?, execution_json = ?, final_state = 'pending', final_json = ?
        WHERE request_id = ? AND state = 'executing' AND execution_token = ?`,
            )
            .run(
              outcome.ok ? 'succeeded' : 'failed',
              JSON.stringify(outcome),
              JSON.stringify({ state: 'pending' }),
              requestId,
              token,
            );
          if (result.changes !== 1) throw new LedgerError('claim_lost');
        })
        .immediate(),
    );
  }

  /**
   * Claim an awaiting-approval rename for execution. Revalidates inside
   * the claim transaction: a policy change since parking invalidates
   * the invocation instead of executing it. Approval status itself is
   * observed by the caller (terminal states are monotonic, so an
   * observed `approved` cannot regress before this claim lands).
   */
  claimRename(
    requestId: string,
    revalidate: (input: ToolExecutionInput) => ValidationOutcome,
  ): string | null {
    return this.access(() =>
      this.database.connection
        .transaction(() => {
          const record = this.required(requestId);
          if (record.state !== 'awaiting_approval' || !record.approvalId)
            return null;
          this.requireSession(record.sessionId);
          const validation = revalidate(record.input);
          if (
            !validation.ok ||
            !('request' in validation) ||
            validation.request.name !== 'session.rename' ||
            !isDeepStrictEqual(validation, record.validation)
          ) {
            const failure: ValidationOutcome = validation.ok
              ? { ok: false, failure: { code: 'unpermitted_tool' } }
              : validation;
            this.database.connection
              .prepare(
                "UPDATE tool_requests SET state = 'invalid', validation_json = ? WHERE request_id = ? AND state = 'awaiting_approval'",
              )
              .run(JSON.stringify(failure), requestId);
            return null;
          }
          const token = randomUUID();
          const result = this.database.connection
            .prepare(
              "UPDATE tool_requests SET state = 'executing', execution_token = ? WHERE request_id = ? AND state = 'awaiting_approval' AND execution_token IS NULL",
            )
            .run(token, requestId);
          return result.changes === 1 ? token : null;
        })
        .immediate(),
    );
  }

  /**
   * Claim a validated (approval-free) rename for inline execution.
   * Mirrors claimRename but starts from 'validated': revalidates
   * inside the claim transaction and invalidates on disagreement.
   */
  claimRenameInline(
    requestId: string,
    revalidate: (input: ToolExecutionInput) => ValidationOutcome,
  ): string | null {
    return this.access(() =>
      this.database.connection
        .transaction(() => {
          const record = this.required(requestId);
          if (record.state !== 'validated') return null;
          this.requireSession(record.sessionId);
          const validation = revalidate(record.input);
          if (
            !validation.ok ||
            !('request' in validation) ||
            validation.request.name !== 'session.rename' ||
            !isDeepStrictEqual(validation, record.validation)
          ) {
            const failure: ValidationOutcome = validation.ok
              ? { ok: false, failure: { code: 'unpermitted_tool' } }
              : validation;
            this.database.connection
              .prepare(
                "UPDATE tool_requests SET state = 'invalid', validation_json = ? WHERE request_id = ? AND state = 'validated'",
              )
              .run(JSON.stringify(failure), requestId);
            return null;
          }
          const token = randomUUID();
          const result = this.database.connection
            .prepare(
              "UPDATE tool_requests SET state = 'executing', execution_token = ? WHERE request_id = ? AND state = 'validated' AND execution_token IS NULL",
            )
            .run(token, requestId);
          return result.changes === 1 ? token : null;
        })
        .immediate(),
    );
  }

  /**
   * Perform the rename mutation and persist its outcome atomically.
   * The session UPDATE and the ledger write share one transaction, so
   * a committed `succeeded` row means the title changed and a
   * committed `failed` row means it did not — no `unknown` gap for
   * the local rename. Throws (rolling back) when the session row is
   * missing, leaving the claim held for explicit recovery.
   */
  finishRename(requestId: string, token: string, rename: RenameResult): void {
    this.access(() =>
      this.database.connection
        .transaction(() => {
          const now = nowIso();
          const mutated = this.database.connection
            .prepare(
              'UPDATE sessions SET updated_at = ?, title = ? WHERE id = ?',
            )
            .run(now, rename.title, rename.sessionId);
          if (mutated.changes !== 1) throw new LedgerError('rename_failed');
          const outcome: RenameOutcome = { ok: true, renamed: rename };
          const result = this.database.connection
            .prepare(
              `UPDATE tool_requests
        SET state = 'succeeded', execution_json = ?, final_state = 'pending', final_json = ?
        WHERE request_id = ? AND state = 'executing' AND execution_token = ?`,
            )
            .run(
              JSON.stringify(outcome),
              JSON.stringify({ state: 'pending' }),
              requestId,
              token,
            );
          if (result.changes !== 1) throw new LedgerError('claim_lost');
        })
        .immediate(),
    );
  }

  /**
   * Mirror a terminal non-approved approval outcome onto an
   * awaiting-approval invocation. Rejection, cancellation, and expiry
   * close the invocation without execution; the model is not
   * re-prompted (final stays `not_required`).
   */
  mirrorOutcome(requestId: string, to: MirrorOutcomeState): boolean {
    return this.access(() =>
      this.database.connection
        .transaction(() => {
          const result = this.database.connection
            .prepare(
              `UPDATE tool_requests SET state = ?
               WHERE request_id = ? AND state = 'awaiting_approval'`,
            )
            .run(to, requestId);
          if (result.changes === 1) return true;
          return this.required(requestId).state === to;
        })
        .immediate(),
    );
  }

  /**
   * Most recent completed invocations for a session, oldest first.
   * Only invocations with a durable execution result are returned;
   * pending, mirrored, and invalid rows have nothing to pair.
   */
  recentExecutions(sessionId: string, limit: number): ExecutionPair[] {
    return this.access(() => {
      const rows = this.database.connection
        .prepare(
          `SELECT invocation_id, input_json, validation_json, execution_json
             FROM tool_requests
            WHERE session_id = ? AND state IN ('succeeded', 'failed')
              AND execution_json IS NOT NULL
            ORDER BY rowid DESC LIMIT ?`,
        )
        .all(sessionId, Math.max(1, Math.floor(limit))) as {
        invocation_id: string;
        input_json: string;
        validation_json: string;
        execution_json: string;
      }[];
      const pairs: ExecutionPair[] = [];
      for (const row of rows.reverse()) {
        try {
          const input = JSON.parse(row.input_json) as ToolExecutionInput;
          const validation = JSON.parse(
            row.validation_json,
          ) as ValidationOutcome;
          if (
            !validation.ok ||
            !('request' in validation) ||
            input.proposal?.kind !== 'tool_calls'
          )
            continue;
          pairs.push({
            invocationId: row.invocation_id,
            proposalContent: input.proposal.content,
            name: validation.request.name,
            version: validation.request.version,
            args: JSON.parse(JSON.stringify(validation.request.args)) as Record<
              string,
              unknown
            >,
            result: JSON.parse(row.execution_json) as unknown,
          });
        } catch {
          continue;
        }
      }
      return pairs;
    });
  }

  /**
   * Claim the one transcript write for a request. Conversation calls
   * this before appending turn rows; only the claim winner writes, so
   * retried resumes can never duplicate transcript rows. A crash
   * between claim and write leaves a gap, matching the existing
   * store-nothing-on-failure philosophy.
   */
  claimTranscript(requestId: string): boolean {
    return this.access(() => {
      const result = this.database.connection
        .prepare(
          `UPDATE tool_requests SET transcript_state = 'written'
            WHERE request_id = ? AND transcript_state = 'pending'`,
        )
        .run(requestId);
      return result.changes === 1;
    });
  }

  claimFinal(requestId: string): string | null {
    return this.access(() =>
      this.database.connection
        .transaction(() => {
          const record = this.required(requestId);
          this.requireSession(record.sessionId);
          const token = randomUUID();
          const result = this.database.connection
            .prepare(
              `UPDATE tool_requests
        SET final_state = 'claimed', final_token = ?, final_json = ?
        WHERE request_id = ? AND state IN ('succeeded', 'failed')
        AND ownership = 'unconfirmed' AND execution_json IS NOT NULL AND final_state = 'pending' AND final_token IS NULL`,
            )
            .run(token, JSON.stringify({ state: 'claimed' }), requestId);
          return result.changes === 1 ? token : null;
        })
        .immediate(),
    );
  }

  /** Explicit owner-loss recovery: release → durable unknown outcome. */
  resolveReleasedToUnknown(requestId: string): ExecutionOutcome | null {
    return this.access(() =>
      this.database.connection
        .transaction(() => {
          const record = this.required(requestId);
          if (record.state !== 'executing' || record.ownership !== 'released')
            return null;
          const result = this.database.connection
            .prepare(
              `UPDATE tool_requests
        SET state = 'failed', execution_json = ?, final_state = 'pending', final_json = ?, ownership = 'unconfirmed'
        WHERE request_id = ? AND state = 'executing' AND ownership = 'released'`,
            )
            .run(
              JSON.stringify({ ok: false, failure: { code: 'unknown' } }),
              JSON.stringify({ state: 'pending' }),
              requestId,
            );
          const outcome: ExecutionOutcome = {
            ok: false,
            failure: { code: 'unknown' },
          };
          return result.changes === 1 ? outcome : null;
        })
        .immediate(),
    );
  }

  finishFinal(
    requestId: string,
    token: string,
    outcome: Extract<FinalOutcome, { state: 'succeeded' | 'failed' }>,
  ): void {
    this.access(() =>
      this.database.connection
        .transaction(() => {
          const result = this.database.connection
            .prepare(
              `UPDATE tool_requests SET final_state = ?, final_json = ?
        WHERE request_id = ? AND final_state = 'claimed' AND final_token = ?`,
            )
            .run(outcome.state, JSON.stringify(outcome), requestId, token);
          if (result.changes !== 1) throw new LedgerError('claim_lost');
        })
        .immediate(),
    );
  }

  private required(requestId: string): ToolExecutionRecord {
    const record = this.get(requestId);
    if (!record) throw new LedgerError('request_not_found');
    return record;
  }

  private requireSession(sessionId: string): void {
    if (
      !this.database.connection
        .prepare('SELECT 1 FROM sessions WHERE id = ?')
        .get(sessionId)
    )
      throw new LedgerError('session_not_found');
  }
}
