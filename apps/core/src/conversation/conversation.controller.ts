import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ConversationService } from './conversation.service';
import {
  ConversationHistoryResponseDto,
  ConversationRequestDto,
  ConversationResponseDto,
} from './dto/conversation.dto';

@Controller('core/conversation')
export class ConversationController {
  constructor(private readonly conversation: ConversationService) {}

  @Post()
  @HttpCode(200)
  async converse(
    @Body() dto: ConversationRequestDto,
  ): Promise<ConversationResponseDto> {
    return this.conversation.converse(dto.message, dto.sessionId);
  }

  @Get(':id')
  history(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): ConversationHistoryResponseDto {
    return this.conversation.history(id);
  }
}
