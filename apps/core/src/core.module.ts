import { Module } from '@nestjs/common';
import { CoreController } from './core.controller';
import { CoreService } from './core.service';
import { TestClientController } from './test-client.controller';
import { ConversationModule } from './conversation/conversation.module';

@Module({
  imports: [ConversationModule],
  controllers: [CoreController, TestClientController],
  providers: [CoreService],
})
export class CoreModule {}
