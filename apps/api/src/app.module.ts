import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './core/database/database.module';
import path, { join } from 'path';
import { IdentityModule } from './core/identity/identity.module';
import { AudioModule } from './modules/audio/audio.module';
import { ChatModule } from './modules/chat/chat.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { PersonalContextModule } from './modules/personal-context/personal-context.module';
import { MediaModule } from './modules/media/media.module';
import { GroupsModule } from './modules/groups/groups.module';
import { DialectModule } from './modules/dialect/dialect.module';
import { DocumentAiModule } from './modules/document-ai/document-ai.module';
import { NotificationModule } from './modules/notification/notification.module';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Makes .env available everywhere
      // Traverse up from apps/api/dist to the monorepo root
      envFilePath: path.resolve(process.cwd(), '../../.env'),
    }),
    // Global rate-limiter storage: 500 req / 60 s default;
    // individual routes can override via @Throttle().
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 500 }]),
    DatabaseModule,
    IdentityModule,
    ChatModule,
    AudioModule,
    GroupsModule,
    PersonalContextModule,
    MediaModule,
    DialectModule,
    DocumentAiModule,
    NotificationModule,
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'uploads'),
      serveRoot: '/uploads', // Files will be available at http://localhost:3000/uploads/...
    }),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Bind ThrottlerGuard globally so every route is protected by default.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
