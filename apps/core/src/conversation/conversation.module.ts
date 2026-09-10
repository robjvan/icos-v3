import { Module } from '@nestjs/common';
import { coreConfigProvider } from '../config';
import { LlmClient } from '../llm/llm.client';
import { memoryLlmClientProvider } from '../llm/llm-client.providers';
import { LlmMemoryCandidateExtractor } from '../memory/llm-memory-candidate-extractor';
import { MemoryCandidateExtractor } from '../memory/memory-candidate-extractor';
import { MemoryCandidateRepository } from '../memory/memory-candidate.repository';
import { SqliteMemoryCandidateRepository } from '../memory/sqlite-memory-candidate.repository';
import { DatabaseService } from '../session/database.service';
import { SessionRepository } from '../session/session.repository';
import { SqliteSessionRepository } from '../session/sqlite-session.repository';
import { CandidatesController } from './candidates.controller';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';
import { SessionStore } from './session.store';
import { SessionsController } from './sessions.controller';

@Module({
  controllers: [
    ConversationController,
    SessionsController,
    CandidatesController,
  ],
  providers: [
    coreConfigProvider,
    DatabaseService,
    {
      provide: SessionRepository,
      useClass: SqliteSessionRepository,
    },
    {
      provide: MemoryCandidateRepository,
      useClass: SqliteMemoryCandidateRepository,
    },
    {
      provide: MemoryCandidateExtractor,
      useClass: LlmMemoryCandidateExtractor,
    },
    memoryLlmClientProvider,
    ConversationService,
    SessionStore,
    LlmClient,
  ],
  exports: [ConversationService],
})
export class ConversationModule {}
