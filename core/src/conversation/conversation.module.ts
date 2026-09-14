import { Module } from '@nestjs/common';
import { coreConfigProvider } from '../config';
import { ApprovalRepository } from '../approvals/approval.repository';
import { ApprovalService } from '../approvals/approval.service';
import { ApprovalsController } from '../approvals/approvals.controller';
import { ClarificationRepository } from '../clarifications/clarification.repository';
import { ClarificationService } from '../clarifications/clarification.service';
import { ClarificationsController } from '../clarifications/clarifications.controller';
import { SqliteClarificationRepository } from '../clarifications/sqlite-clarification.repository';
import { SqliteApprovalRepository } from '../approvals/sqlite-approval.repository';
import { CommandDispatcher } from '../commands/command-dispatcher';
import { DisplayPreferenceStore } from '../commands/display-preferences';
import { HostHealthProvider } from '../commands/host-health';
import {
  conversationLlmClientProvider,
  memoryLlmClientProvider,
} from '../llm/llm-client.providers';
import { LlmMemoryCandidateExtractor } from '../memory/llm-memory-candidate-extractor';
import { MemoryCandidateExtractor } from '../memory/memory-candidate-extractor';
import { MemoryCandidateRepository } from '../memory/memory-candidate.repository';
import { MemoryDatabaseService } from '../memory/memory-database.service';
import { SqliteMemoryCandidateRepository } from '../memory/sqlite-memory-candidate.repository';
import { SessionDatabaseService } from '../session/session-database.service';
import { SessionRepository } from '../session/session.repository';
import { SqliteSessionRepository } from '../session/sqlite-session.repository';
import { SkillService } from '../skills/skill.service';
import { SkillsController } from '../skills/skills.controller';
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
    ApprovalsController,
    ClarificationsController,
    SkillsController,
  ],
  providers: [
    coreConfigProvider,
    SessionDatabaseService,
    MemoryDatabaseService,
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
    {
      provide: ApprovalRepository,
      useClass: SqliteApprovalRepository,
    },
    ApprovalService,
    {
      provide: ClarificationRepository,
      useClass: SqliteClarificationRepository,
    },
    ClarificationService,
    memoryLlmClientProvider,
    conversationLlmClientProvider,
    DisplayPreferenceStore,
    HostHealthProvider,
    SkillService,
    CommandDispatcher,
    ConversationService,
    SessionStore,
  ],
  exports: [ConversationService],
})
export class ConversationModule {}
