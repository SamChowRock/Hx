import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

@Injectable()
export class WorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private keepAliveHandle?: NodeJS.Timeout;

  constructor(private readonly logger: Logger) {}

  onApplicationBootstrap(): void {
    // Queue consumers will keep the event loop active from Milestone 3 onward.
    this.keepAliveHandle = setInterval(() => undefined, 60_000);
    this.logger.log('Worker started; no queue processors are registered in Milestone 0');
  }

  onApplicationShutdown(signal?: string): void {
    if (this.keepAliveHandle) {
      clearInterval(this.keepAliveHandle);
      this.keepAliveHandle = undefined;
    }

    this.logger.log({ signal }, 'Worker shutting down');
  }
}
