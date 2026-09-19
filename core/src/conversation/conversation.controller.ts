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
import type {
  ConversationStreamEvent,
  TurnOutcome,
} from './conversation.service';
import {
  ConversationHistoryResponseDto,
  ConversationRequestDto,
  ConversationResponseDto,
  ResumeRequestDto,
} from './dto/conversation.dto';

@Controller('core/conversation')
export class ConversationController {
  constructor(private readonly conversation: ConversationService) {}

  @Post()
  @HttpCode(200)
  async converse(
    @Body() dto: ConversationRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ConversationResponseDto> {
    const outcome = await this.conversation.converse(
      dto.message,
      dto.sessionId,
    );
    if (outcome.status !== 'ok') res.status(202);
    return outcome;
  }

  /**
   * Resume a parked tool request after an approval decision (or poll a
   * running one). Never re-executes: the durable record answers.
   */
  @Post('resume')
  @HttpCode(200)
  async resume(
    @Body() dto: ResumeRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ConversationResponseDto> {
    const outcome: TurnOutcome = await this.conversation.resumeTurn(
      dto.requestId,
      dto.sessionId,
    );
    if (outcome.status !== 'ok') res.status(202);
    return outcome;
  }

  @Get(':id')
  async history(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ConversationHistoryResponseDto> {
    return this.conversation.history(id);
  }

  /**
   * Token-streaming variant. Browser-facing event stream:
   * `meta` → `token`* → (`tool` | `approval`)* → `done` | `error`.
   */
  @Post('stream')
  @HttpCode(200)
  async stream(
    @Body() dto: ConversationRequestDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const send = this.sse(res, req);
    const upstream = send.signal;
    await this.conversation.converseStream(
      dto.message,
      dto.sessionId,
      send.emit,
      upstream.signal,
    );
    send.end();
  }

  /** Streaming resume for a parked tool request. */
  @Post('resume-stream')
  @HttpCode(200)
  async resumeStream(
    @Body() dto: ResumeRequestDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const send = this.sse(res, req);
    await this.conversation.resumeStream(
      dto.requestId,
      dto.sessionId,
      send.emit,
      send.signal.signal,
    );
    send.end();
  }

  private sse(
    res: Response,
    req: Request,
  ): {
    emit: (event: ConversationStreamEvent) => void;
    signal: AbortController;
    end: () => void;
  } {
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

    const emit = (event: ConversationStreamEvent): void => {
      if (closed) return;
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    return {
      emit,
      signal: upstream,
      end: () => {
        if (!closed) res.end();
      },
    };
  }
}
