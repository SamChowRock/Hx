import { HealthController } from './health.controller';

describe('HealthController', () => {
  const database = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
  const controller = new HealthController(
    {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://scaffold:scaffold@localhost:5432/scaffold',
      PORT: 3000,
      LOG_LEVEL: 'info',
      API_CORS_ORIGINS: '',
      SERVICE_NAME: 'test-service',
      TRUST_PROXY: false,
      AUTH_SECRET: 'test-auth-secret-that-is-long-enough-for-validation',
      SMTP_URL: 'smtp://localhost:1025',
      EMAIL_FROM: 'no-reply@example.test',
      SMS_PROVIDER: 'disabled',
      WEB_APP_ORIGIN: 'http://localhost:5173',
      API_PUBLIC_ORIGIN: 'http://localhost:3000',
    },
    database as never,
  );

  it('returns a liveness payload', () => {
    expect(controller.live()).toEqual({ status: 'ok', service: 'test-service' });
  });

  it('returns a readiness payload', async () => {
    await expect(controller.ready()).resolves.toEqual({ status: 'ok', service: 'test-service' });
  });
});
