import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { ChatGroup } from './entities/chat-group.entity';
import { Message } from './entities/message.entity';
import { GroupMember } from './entities/group-member.entity';
import { WsJwtGuard } from './guards/ws-jwt.guard';
import { PersonalContextModule } from '../personal-context/personal-context.module';
import { TranslationModule } from '../translation/translation.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Message, ChatGroup, GroupMember]),
    PersonalContextModule,
    TranslationModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  providers: [ChatGateway, ChatService, WsJwtGuard],
})
export class ChatModule {}
