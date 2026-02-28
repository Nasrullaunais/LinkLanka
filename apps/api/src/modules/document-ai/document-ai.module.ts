import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

import { Message } from '../chat/entities/message.entity';
import { DocumentAiService } from './document-ai.service';
import { DocumentAiController } from './document-ai.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Message]), ConfigModule],
  controllers: [DocumentAiController],
  providers: [DocumentAiService],
  exports: [DocumentAiService],
})
export class DocumentAiModule {}
