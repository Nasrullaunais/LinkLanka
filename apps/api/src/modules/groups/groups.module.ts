import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ChatGroup } from '../chat/entities/chat-group.entity';
import { GroupMember } from '../chat/entities/group-member.entity';
import { Message } from '../chat/entities/message.entity';
import { User } from '../../core/identity/entities/user.entity';
import { GroupsController } from './groups.controller';
import { UsersController } from './users.controller';
import { GroupsService } from './groups.service';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatGroup, GroupMember, Message, User]),
    NotificationModule,
  ],
  controllers: [GroupsController, UsersController],
  providers: [GroupsService],
  exports: [GroupsService],
})
export class GroupsModule {}
