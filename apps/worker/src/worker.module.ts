import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { EnvironmentModule } from '../../../libs/platform/src/config';
import { DatabaseModule } from '../../../libs/platform/src/database';

import { WorkerService } from './worker.service';

@Module({
  imports: [EnvironmentModule, DatabaseModule, LoggerModule.forRoot()],
  providers: [WorkerService],
})
export class WorkerModule {}
