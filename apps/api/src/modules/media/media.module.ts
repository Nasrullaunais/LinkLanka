import { Module } from '@nestjs/common';

import { MediaController } from './media.controller';
import { StorageModule } from '../../core/common/storage';

@Module({
  imports: [StorageModule],
  controllers: [MediaController],
})
export class MediaModule {}
