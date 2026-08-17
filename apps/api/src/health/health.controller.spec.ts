import { loadEnvironment } from '../../../../libs/platform/src/config';

import { HealthController } from './health.controller';

describe('HealthController', () => {
  const database = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
  const controller = new HealthController(
    loadEnvironment({
      NODE_ENV: 'test',
      SERVICE_NAME: 'test-service',
      AUTH_SECRET: 'test-auth-secret-that-is-long-enough-for-validation',
    }),
    database as never,
  );

  it('returns a liveness payload', () => {
    expect(controller.live()).toEqual({ status: 'ok', service: 'test-service' });
  });

  it('returns a readiness payload', async () => {
    await expect(controller.ready()).resolves.toEqual({ status: 'ok', service: 'test-service' });
  });
});
