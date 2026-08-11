import { loadEnvironment } from './environment';

describe('loadEnvironment', () => {
  it('applies safe defaults', () => {
    expect(loadEnvironment({})).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
      TRUST_PROXY: false,
    });
  });

  it('rejects invalid runtime configuration', () => {
    expect(() => loadEnvironment({ PORT: 'not-a-port' })).toThrow(
      'Invalid environment configuration',
    );
  });
});
