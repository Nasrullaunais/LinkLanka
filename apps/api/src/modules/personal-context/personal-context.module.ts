import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PersonalContext } from './entities/personal-context.entity';
import { PersonalContextService } from './personal-context.service';

@Module({
  imports: [TypeOrmModule.forFeature([PersonalContext])],
  providers: [PersonalContextService],
  exports: [PersonalContextService],
})
export class PersonalContextModule {}
