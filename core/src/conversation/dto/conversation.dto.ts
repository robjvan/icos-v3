import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import type {
  ApprovalSummary,
  CommandPayload,
  ToolSummary,
  TurnStatus,
} from '../conversation.service';
import type { HistoryMessage } from '../session.store';

export class ConversationRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  message!: string;

  @IsOptional()
  @IsUUID()
  sessionId?: string;
}

export class ResumeRequestDto {
  @IsUUID()
  sessionId!: string;

  @IsUUID()
  requestId!: string;
}

export class ConversationResponseDto {
  status!: TurnStatus;
  sessionId!: string;
  requestId?: string;
  reply!: string;
  model!: string;
  command?: CommandPayload;
  tool?: ToolSummary;
  approval?: ApprovalSummary;
  outcome?: 'rejected' | 'cancelled' | 'expired';
  result?: unknown;
}

export class ConversationHistoryResponseDto {
  sessionId!: string;
  messages!: HistoryMessage[];
}
