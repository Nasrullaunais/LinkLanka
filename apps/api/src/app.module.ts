import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './core/database/database.module';
import path from 'path';
import { IdentityModule } from './core/identity/identity.module';
import { ChatModule } from './modules/chat/chat.module';
import { PersonalContextModule } from './modules/personal-context/personal-context.module';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Makes .env available everywhere
      // Traverse up from apps/api/dist to the monorepo root
      envFilePath: path.resolve(process.cwd(), '../../.env'),
    }),
    DatabaseModule,
    IdentityModule,
    ChatModule,
    PersonalContextModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
