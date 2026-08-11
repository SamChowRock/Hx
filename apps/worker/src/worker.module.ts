import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { WorkerService } from './worker.service';

@Module({
  imports: [LoggerModule.forRoot()],
  providers: [WorkerService],
})
export class WorkerModule {}
