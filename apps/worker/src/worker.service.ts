import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

@Injectable()
export class WorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(private readonly logger: Logger) {}

  onApplicationBootstrap(): void {
    this.logger.log('Worker started; no queue processors are registered in Milestone 0');
  }

  onApplicationShutdown(signal?: string): void {
    this.logger.log({ signal }, 'Worker shutting down');
  }
}
