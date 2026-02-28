import { Module } from '@nestjs/common';
import { DialectController } from './dialect.controller';
import { DialectService } from './dialect.service';

@Module({
  controllers: [DialectController],
  providers: [DialectService],
  exports: [DialectService],
})
export class DialectModule {}
