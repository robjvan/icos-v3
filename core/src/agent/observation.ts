import type { ToolName } from '../tools/tool-registry';
import type {
  ExecutionOutcome,
  RenameOutcome,
  ToolExecutionRecord,
} from '../tools/tool-execution.repository';

/**
 * M9d observation: a completed action with its authoritative result,
 * linked to the originating invocation. Derived from M8 ledger rows —
 * never duplicated, never reconstructed. Failures stay failures and
 * unknown outcomes stay unknown; only the status label interprets.
 */
export type ObservationStatus = 'succeeded' | 'failed' | 'unknown';

export interface RunObservation {
  requestId: string;
  invocationId: string;
  tool: ToolName;
  args: Record<string, unknown>;
  status: ObservationStatus;
  result: ExecutionOutcome | RenameOutcome;
}

export function observationStatus(
  execution: ExecutionOutcome | RenameOutcome,
): ObservationStatus {
  if (execution.ok) return 'succeeded';
  if (execution.failure.code === 'unknown') return 'unknown';
  return 'failed';
}

/**
 * Build the observation for a ledger record, or undefined when the
 * record has no durable execution yet (pending, parked, invalid).
 * The result payload passes through untouched.
 */
export function observationFromRecord(
  record: ToolExecutionRecord,
): RunObservation | undefined {
  if (!record.invocationId || !record.execution) return undefined;
  const validation = record.validation;
  if (!validation.ok || !('request' in validation)) return undefined;
  return {
    requestId: record.requestId,
    invocationId: record.invocationId,
    tool: validation.request.name,
    args: JSON.parse(JSON.stringify(validation.request.args)) as Record<
      string,
      unknown
    >,
    status: observationStatus(record.execution),
    result: record.execution,
  };
}
