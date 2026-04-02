import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

import { Message } from '../chat/entities/message.entity';
import { DocumentAiService } from './document-ai.service';
import { DocumentAiController } from './document-ai.controller';
import { StorageModule } from '../../core/common/storage';

@Module({
  imports: [TypeOrmModule.forFeature([Message]), ConfigModule, StorageModule],
  controllers: [DocumentAiController],
  providers: [DocumentAiService],
  exports: [DocumentAiService],
})
export class DocumentAiModule {}
