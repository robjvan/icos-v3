import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { SessionDatabaseService } from '../session/session-database.service';
import type {
  ToolExecutionInput,
  ToolExecutionRecord,
  ValidationOutcome,
} from '../tools/tool-execution.repository';
import type { RunObservation } from './observation';
import { observationFromRecord } from './observation';

/**
 * M9a agent-run state. A run is one user goal pursued inside a session;
 * it references M8 ledger rows by convention (plain id columns, no
 * foreign keys) so the invocation ledger stays the single authority on
 * execution. Lifecycle values are provisional — M9b owns the state
 * machine; this store only persists what the loop reports.
 */
export type AgentRunState =
  | 'created'
  | 'reasoning'
  | 'action_proposed'
  | 'executing'
  | 'observing'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'budget_exhausted';

export type AgentTransientState = Extract<
  AgentRunState,
  | 'reasoning'
  | 'action_proposed'
  | 'executing'
  | 'observing'
  | 'awaiting_approval'
>;

export type AgentTerminalState = Extract<
  AgentRunState,
  'completed' | 'failed' | 'cancelled' | 'budget_exhausted'
>;

export interface RunLimits {
  maxIterations: number;
  maxToolSteps: number;
  maxTurnDurationMs: number;
}

export interface RunTermination {
  reason:
    | 'final_answer'
    | 'turn_error'
    | 'cancelled'
    | 'step_bound'
    | 'time_budget'
    | 'approval_denied';
  toolSteps: number;
}

export interface AgentRun {
  id: string;
  sessionId: string;
  goal: string;
  state: AgentRunState;
  requestIds: string[];
  currentRequestId: string | null;
  iterationCount: number;
  toolCallCount: number;
  limits: RunLimits;
  approvalId: string | null;
  termination: RunTermination | null;
  createdAt: string;
  updatedAt: string;
}

interface AgentRunRow {
  id: string;
  session_id: string;
  goal: string;
  state: AgentRunState;
  request_ids: string;
  current_request_id: string | null;
  iteration_count: number;
  tool_call_count: number;
  limits_json: string;
  approval_id: string | null;
  termination_json: string | null;
  created_at: string;
  updated_at: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function toRun(row: AgentRunRow): AgentRun {
  return {
    id: row.id,
    sessionId: row.session_id,
    goal: row.goal,
    state: row.state,
    requestIds: JSON.parse(row.request_ids) as string[],
    currentRequestId: row.current_request_id,
    iterationCount: row.iteration_count,
    toolCallCount: row.tool_call_count,
    limits: JSON.parse(row.limits_json) as RunLimits,
    approvalId: row.approval_id,
    termination: row.termination_json
      ? (JSON.parse(row.termination_json) as RunTermination)
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class AgentRunRepository {
  constructor(private readonly database: SessionDatabaseService) {}

  private get connection(): Database.Database {
    return this.database.connection;
  }

  createRun(input: {
    sessionId: string;
    goal: string;
    limits: RunLimits;
  }): AgentRun {
    const id = randomUUID();
    const now = nowIso();
    this.connection
      .prepare(
        `INSERT INTO agent_runs
          (id, session_id, goal, state, request_ids, current_request_id,
           iteration_count, tool_call_count, limits_json,
           approval_id, termination_json, created_at, updated_at)
          VALUES (?, ?, ?, 'created', '[]', NULL, 0, 0, ?, NULL, NULL, ?, ?)`,
      )
      .run(
        id,
        input.sessionId,
        input.goal,
        JSON.stringify(input.limits),
        now,
        now,
      );
    return this.required(id);
  }

  /** Move a run between lifecycle states (transient or terminal-adjacent). */
  transitionRun(runId: string, state: AgentTransientState): AgentRun {
    this.required(runId);
    this.connection
      .prepare(`UPDATE agent_runs SET state = ?, updated_at = ? WHERE id = ?`)
      .run(state, nowIso(), runId);
    return this.required(runId);
  }

  /** Record one loop iteration: append the step request, bump counters. */
  recordStep(
    runId: string,
    input: { requestId: string; toolCalls: number },
  ): AgentRun {
    return this.connection
      .transaction(() => {
        const run = this.required(runId);
        const requestIds = [...run.requestIds, input.requestId];
        this.connection
          .prepare(
            `UPDATE agent_runs
           SET request_ids = ?, current_request_id = ?,
               iteration_count = iteration_count + 1,
               tool_call_count = tool_call_count + ?,
               updated_at = ?
           WHERE id = ?`,
          )
          .run(
            JSON.stringify(requestIds),
            input.requestId,
            input.toolCalls,
            nowIso(),
            runId,
          );
        return this.required(runId);
      })
      .immediate();
  }

  markParked(runId: string, approvalId: string): AgentRun {
    this.required(runId);
    this.connection
      .prepare(
        `UPDATE agent_runs
         SET state = 'awaiting_approval', approval_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(approvalId, nowIso(), runId);
    return this.required(runId);
  }

  markTerminal(
    runId: string,
    state: AgentTerminalState,
    termination: RunTermination,
  ): AgentRun {
    this.required(runId);
    this.connection
      .prepare(
        `UPDATE agent_runs
         SET state = ?, termination_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(state, JSON.stringify(termination), nowIso(), runId);
    return this.required(runId);
  }

  get(runId: string): AgentRun {
    return this.required(runId);
  }

  /**
   * Observations for a run in step order: one per executed action,
   * each linked to its invocation with the authoritative result.
   * Rows without a durable execution (pending, parked, invalid) yield
   * no observation — the agent reasons from actual results only.
   */
  observations(runId: string): RunObservation[] {
    const run = this.required(runId);
    const observed: RunObservation[] = [];
    const row = this.connection.prepare(
      `SELECT input_json, invocation_id, validation_json, execution_json, state
       FROM tool_requests WHERE request_id = ?`,
    );
    for (const requestId of run.requestIds) {
      try {
        const found = row.get(requestId) as
          | {
              input_json: string;
              invocation_id: string | null;
              validation_json: string;
              execution_json: string | null;
              state: ToolExecutionRecord['state'];
            }
          | undefined;
        if (!found) continue;
        const record = {
          requestId,
          sessionId: run.sessionId,
          input: JSON.parse(found.input_json) as ToolExecutionInput,
          invocationId: found.invocation_id,
          approvalId: null,
          state: found.state,
          validation: JSON.parse(found.validation_json) as ValidationOutcome,
          execution: found.execution_json
            ? (JSON.parse(found.execution_json) as RunObservation['result'])
            : null,
          final: { state: 'not_required' },
          executionToken: null,
          ownership: 'none',
        } as ToolExecutionRecord;
        const observation = observationFromRecord(record);
        if (observation) observed.push(observation);
      } catch {
        continue;
      }
    }
    return observed;
  }

  /**
   * Latest run in a session containing a step request. Steps append to
   * the run's request list, so duplicate resumes presenting an older
   * (e.g. park) request id still resolve to the run.
   */
  findByRequest(sessionId: string, requestId: string): AgentRun | undefined {
    const rows = this.connection
      .prepare(
        `SELECT * FROM agent_runs WHERE session_id = ? ORDER BY rowid DESC`,
      )
      .all(sessionId) as AgentRunRow[];
    for (const row of rows) {
      try {
        const ids: unknown = JSON.parse(row.request_ids);
        if (Array.isArray(ids) && ids.includes(requestId)) {
          return toRun(row);
        }
      } catch {
        continue;
      }
    }
    return undefined;
  }

  private required(runId: string): AgentRun {
    const row = this.connection
      .prepare(`SELECT * FROM agent_runs WHERE id = ?`)
      .get(runId) as AgentRunRow | undefined;
    if (!row) throw new Error('agent_run_not_found');
    return toRun(row);
  }
}
