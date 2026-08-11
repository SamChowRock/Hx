import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';

import { loadEnvironment } from '../../../libs/platform/src/config';

import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  const environment = loadEnvironment();
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  const logger = app.get(PinoLogger);

  app.useLogger(logger);
  app.enableShutdownHooks();
  logger.log({ environment: environment.NODE_ENV }, 'Worker ready');
}

void bootstrap().catch((error: unknown) => {
  Logger.error(error, 'Worker bootstrap failed');
  process.exitCode = 1;
});
