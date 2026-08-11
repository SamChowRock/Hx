import { Logger } from 'nestjs-pino';

import { WorkerService } from './worker.service';

describe('WorkerService', () => {
  const logger = {
    log: jest.fn(),
  } as unknown as Logger;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps the process active until application shutdown', () => {
    const service = new WorkerService(logger);

    service.onApplicationBootstrap();

    expect(jest.getTimerCount()).toBe(1);
    expect(logger.log).toHaveBeenCalledWith(
      'Worker started; no queue processors are registered in Milestone 0',
    );

    service.onApplicationShutdown('SIGTERM');

    expect(jest.getTimerCount()).toBe(0);
    expect(logger.log).toHaveBeenCalledWith({ signal: 'SIGTERM' }, 'Worker shutting down');
  });
});
