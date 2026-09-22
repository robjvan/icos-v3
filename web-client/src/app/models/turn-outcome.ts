import type {
  ApprovalSummary,
  CommandPayload,
  ToolSummary,
  TurnStatus,
} from './stream-event';

/** Non-streaming turn result. Mirrors core `ConversationResponseDto`. */
export interface TurnOutcome {
  readonly status: TurnStatus;
  readonly sessionId: string;
  readonly requestId?: string;
  readonly reply: string;
  readonly model: string;
  readonly command?: CommandPayload;
  readonly tool?: ToolSummary;
  readonly approval?: ApprovalSummary;
  readonly outcome?: 'rejected' | 'cancelled' | 'expired';
  readonly result?: unknown;
}
