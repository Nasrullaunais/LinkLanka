import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { TranslationService } from './translation.service';
import { StorageModule } from '../../core/common/storage';

@Module({
  imports: [ConfigModule, StorageModule],
  providers: [TranslationService],
  exports: [TranslationService],
})
export class TranslationModule {}
