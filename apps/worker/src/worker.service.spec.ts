import { Logger } from 'nestjs-pino';

import { loadEnvironment } from '../../../libs/platform/src/config';
import { DatabaseService } from '../../../libs/platform/src/database';

import { WorkerService } from './worker.service';

const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: () => ({ sendMail: mockSendMail }) },
}));

describe('WorkerService', () => {
  const logger = {
    log: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
  const outboxEvent = {
    findFirst: jest.fn().mockResolvedValue(undefined),
    updateMany: jest.fn(),
    update: jest.fn(),
  };
  const database = { outboxEvent } as unknown as DatabaseService;
  const environment = loadEnvironment({ NODE_ENV: 'test' });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('polls the transactional outbox until application shutdown', async () => {
    const service = new WorkerService(database, environment, logger);

    service.onApplicationBootstrap();
    await Promise.resolve();

    expect(jest.getTimerCount()).toBe(1);
    expect(logger.log).toHaveBeenCalledWith(
      'Worker started; transactional outbox processing is active',
    );

    await service.onApplicationShutdown('SIGTERM');

    expect(jest.getTimerCount()).toBe(0);
    expect(logger.log).toHaveBeenCalledWith({ signal: 'SIGTERM' }, 'Worker shutting down');
  });

  it('marks a delivered email and redacts its sensitive payload', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'sent' });
    outboxEvent.update.mockResolvedValue({});
    const service = new WorkerService(database, environment, logger);
    const deliver = service as unknown as {
      deliver(event: {
        id: string;
        type: string;
        payload: object;
        attempts: number;
        availableAt: Date;
      }): Promise<void>;
    };

    await deliver.deliver({
      id: 'event-1',
      type: 'email.send',
      payload: { to: 'sam@example.test', subject: 'Verify', text: 'Message' },
      attempts: 1,
      availableAt: new Date(),
    });

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'sam@example.test', messageId: expect.any(String) }),
    );
    expect(outboxEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'DELIVERED', payload: { redacted: true } }),
      }),
    );
  });

  it('schedules a bounded retry without persisting provider errors', async () => {
    mockSendMail.mockRejectedValue(new Error('secret provider detail'));
    outboxEvent.update.mockResolvedValue({});
    const service = new WorkerService(database, environment, logger);
    const deliver = service as unknown as {
      deliver(event: {
        id: string;
        type: string;
        payload: object;
        attempts: number;
        availableAt: Date;
      }): Promise<void>;
    };

    await deliver.deliver({
      id: 'event-2',
      type: 'email.send',
      payload: { to: 'sam@example.test', subject: 'Verify', text: 'Message' },
      attempts: 1,
      availableAt: new Date(),
    });

    expect(outboxEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PENDING', lastError: 'Delivery failed' }),
      }),
    );
    expect(JSON.stringify(outboxEvent.update.mock.calls)).not.toContain('secret provider detail');
  });
});
