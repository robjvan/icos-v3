import { Controller, Get, Query } from '@nestjs/common';
import { ConversationService } from './conversation.service';
import {
  ListSessionsQueryDto,
  ListSessionsResponseDto,
  SearchSessionsQueryDto,
  SearchSessionsResponseDto,
} from './dto/sessions.dto';

@Controller('core/sessions')
export class SessionsController {
  constructor(private readonly conversation: ConversationService) {}

  @Get()
  async list(
    @Query() query: ListSessionsQueryDto,
  ): Promise<ListSessionsResponseDto> {
    const sessions = await this.conversation.listSessions({
      limit: query.limit,
      offset: query.offset,
    });
    return { sessions };
  }

  @Get('search')
  async search(
    @Query() query: SearchSessionsQueryDto,
  ): Promise<SearchSessionsResponseDto> {
    const results = await this.conversation.searchSessions(query.q, {
      limit: query.limit,
      sessionId: query.sessionId,
    });
    return { results };
  }
}
