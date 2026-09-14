import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ClarificationService } from './clarification.service';
import {
  AnswerClarificationDto,
  CreateClarificationDto,
  ListClarificationsQueryDto,
  ResolveClarificationDto,
} from './dto/clarifications.dto';

/**
 * Explicit clarification API. Answers bind to the request id plus the
 * owning session — ordinary conversation text can never resolve a
 * pending question, so answers cannot leak in as unrelated turns.
 */
@Controller('core/clarifications')
export class ClarificationsController {
  constructor(private readonly clarifications: ClarificationService) {}

  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreateClarificationDto) {
    return this.clarifications.create({
      sessionId: dto.sessionId,
      question: dto.question,
      ...(dto.options !== undefined ? { options: dto.options } : {}),
      ...(dto.ttlMs !== undefined ? { ttlMs: dto.ttlMs } : {}),
    });
  }

  @Get()
  async list(@Query() query: ListClarificationsQueryDto) {
    const clarifications = await this.clarifications.list({
      ...(query.sessionId !== undefined ? { sessionId: query.sessionId } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
    });
    return { clarifications };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.clarifications.get(id);
  }

  @Post(':id/answer')
  @HttpCode(200)
  async answer(@Param('id') id: string, @Body() dto: AnswerClarificationDto) {
    return this.clarifications.answer(id, dto.sessionId, dto.answer);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@Param('id') id: string, @Body() dto: ResolveClarificationDto) {
    return this.clarifications.cancel(id, dto.sessionId);
  }
}
