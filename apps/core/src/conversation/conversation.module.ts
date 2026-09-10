import { Module } from '@nestjs/common';
import { coreConfigProvider } from '../config';
import { LlmClient } from '../llm/llm.client';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';
import { SessionStore } from './session.store';

@Module({
  controllers: [ConversationController],
  providers: [coreConfigProvider, ConversationService, SessionStore, LlmClient],
  exports: [ConversationService],
})
export class ConversationModule {}
