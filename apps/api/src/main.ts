import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './core/common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Increase body size limit for large audio payloads
  app.use(require('express').json({ limit: '50mb' }));
  app.use(require('express').urlencoded({ limit: '50mb', extended: true }));

  // Return detailed validation errors on bad requests (400)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip properties not in the DTO
      forbidNonWhitelisted: true, // Error if unknown properties are sent
      transform: true, // Auto-transform payloads to DTO instances
    }),
  );

  // Catch all exceptions and return structured JSON responses
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');

  Logger.log(`Application running on port ${port}`, 'Bootstrap');
}
bootstrap();
