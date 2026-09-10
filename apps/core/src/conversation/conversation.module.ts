import { Module } from '@nestjs/common';
import { coreConfigProvider } from '../config';
import { LlmClient } from '../llm/llm.client';
import { SessionRepository } from '../session/session.repository';
import { SqliteSessionRepository } from '../session/sqlite-session.repository';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';
import { SessionStore } from './session.store';
import { SessionsController } from './sessions.controller';

@Module({
  controllers: [ConversationController, SessionsController],
  providers: [
    coreConfigProvider,
    {
      provide: SessionRepository,
      useClass: SqliteSessionRepository,
    },
    ConversationService,
    SessionStore,
    LlmClient,
  ],
  exports: [ConversationService],
})
export class ConversationModule {}
