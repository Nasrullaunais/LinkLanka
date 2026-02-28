import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { ChatGroup } from './entities/chat-group.entity';
import { Message } from './entities/message.entity';
import { GroupMember } from './entities/group-member.entity';
import { WsJwtGuard } from './guards/ws-jwt.guard';
import { PersonalContextModule } from '../personal-context/personal-context.module';
import { TranslationModule } from '../translation/translation.module';
import { GroupsModule } from '../groups/groups.module';
import { ActionModule } from '../actions/action.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Message, ChatGroup, GroupMember]),
    PersonalContextModule,
    TranslationModule,
    GroupsModule,
    ActionModule,
    NotificationModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [ChatController],
  providers: [ChatGateway, ChatService, WsJwtGuard],
  // Export gateway + service so AudioModule can inject them without circular deps.
  exports: [ChatGateway, ChatService],
})
export class ChatModule {}
