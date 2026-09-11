import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import type { CommandPayload } from '../conversation.service';
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

export class ConversationResponseDto {
  sessionId!: string;
  reply!: string;
  model!: string;
  command?: CommandPayload;
}

export class ConversationHistoryResponseDto {
  sessionId!: string;
  messages!: HistoryMessage[];
}
