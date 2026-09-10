import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ChatMessage } from '../../llm/llm.client';

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
}

export class ConversationHistoryResponseDto {
  sessionId!: string;
  messages!: ChatMessage[];
}
