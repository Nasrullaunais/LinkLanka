import { Module } from '@nestjs/common';

import { AudioController } from './audio.controller';
import { AudioService } from './audio.service';
import { ChatModule } from '../chat/chat.module';
import { GroupsModule } from '../groups/groups.module';
import { PersonalContextModule } from '../personal-context/personal-context.module';
import { TranslationModule } from '../translation/translation.module';
import { ActionModule } from '../actions/action.module';

/**
 * AudioModule — owns the dedicated audio REST processing pipeline.
 *
 * Dependency graph (no circularity):
 *   AudioModule → ChatModule (for ChatGateway broadcast + ChatService save)
 *   ChatModule  → (no longer depends on AudioModule)
 */
@Module({
  imports: [
    // Provides ChatGateway (for broadcastToGroup) and ChatService (for saveMessage).
    // ChatModule no longer imports AudioModule so there is no circular dependency.
    ChatModule,
    GroupsModule,
    PersonalContextModule,
    TranslationModule,
    ActionModule,
  ],
  controllers: [AudioController],
  providers: [AudioService],
  exports: [AudioService],
})
export class AudioModule {}
