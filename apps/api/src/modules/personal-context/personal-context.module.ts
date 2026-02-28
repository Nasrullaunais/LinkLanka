import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PersonalContext } from './entities/personal-context.entity';
import { PersonalContextController } from './personal-context.controller';
import { PersonalContextService } from './personal-context.service';

@Module({
  imports: [TypeOrmModule.forFeature([PersonalContext])],
  controllers: [PersonalContextController],
  providers: [PersonalContextService],
  exports: [PersonalContextService],
})
export class PersonalContextModule {}
