import { HealthController } from './health.controller';

describe('HealthController', () => {
  const controller = new HealthController({
    NODE_ENV: 'test',
    PORT: 3000,
    LOG_LEVEL: 'info',
    API_CORS_ORIGINS: '',
    SERVICE_NAME: 'test-service',
    TRUST_PROXY: false,
  });

  it('returns a liveness payload', () => {
    expect(controller.live()).toEqual({ status: 'ok', service: 'test-service' });
  });

  it('returns a readiness payload', () => {
    expect(controller.ready()).toEqual({ status: 'ok', service: 'test-service' });
  });
});
