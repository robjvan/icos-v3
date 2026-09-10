import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConversationService } from './conversation.service';
import type { ConversationStreamEvent } from './conversation.service';
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

  /**
   * Token-streaming variant. Browser-facing event stream:
   * `meta` → `token`* → `done` | `error`.
   */
  @Post('stream')
  @HttpCode(200)
  async stream(
    @Body() dto: ConversationRequestDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const upstream = new AbortController();
    let closed = false;
    req.on('close', () => {
      closed = true;
      upstream.abort();
    });

    const send = (event: ConversationStreamEvent): void => {
      if (closed) return;
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    await this.conversation.converseStream(
      dto.message,
      dto.sessionId,
      send,
      upstream.signal,
    );
    if (!closed) res.end();
  }
}
