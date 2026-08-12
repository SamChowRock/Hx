import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { LoggerErrorInterceptor, Logger as PinoLogger } from 'nestjs-pino';

import { corsOrigins, loadEnvironment } from '../../../libs/platform/src/config';

import { AppModule } from './app.module';
import { configureApplication } from './configure-application';

async function bootstrap(): Promise<void> {
  const environment = loadEnvironment();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(PinoLogger);

  app.useLogger(logger);
  configureApplication(app, environment);
  app.useGlobalInterceptors(new LoggerErrorInterceptor());
  app.enableShutdownHooks();

  if (environment.TRUST_PROXY) {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }

  const origins = corsOrigins(environment);
  app.enableCors({
    origin: origins.length > 0 ? origins : false,
    credentials: true,
  });

  if (environment.NODE_ENV === 'development' || environment.NODE_ENV === 'test') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('NestJS Production Scaffold')
        .setDescription('HTTP contract for the modular-monolith API.')
        .setVersion('0.1.0')
        .build(),
    );
    SwaggerModule.setup('docs', app, document, { useGlobalPrefix: false });
  }

  await app.listen(environment.PORT, '0.0.0.0');
  logger.log({ port: environment.PORT, environment: environment.NODE_ENV }, 'API started');
}

void bootstrap().catch((error: unknown) => {
  Logger.error(error, 'API bootstrap failed');
  process.exitCode = 1;
});
