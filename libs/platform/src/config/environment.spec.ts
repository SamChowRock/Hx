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

  it('rejects development secrets and insecure origins in production', () => {
    expect(() => loadEnvironment({ NODE_ENV: 'production' })).toThrow(/AUTH_SECRET/);
    expect(() =>
      loadEnvironment({
        NODE_ENV: 'production',
        AUTH_SECRET: 'production-auth-secret-that-is-long-enough',
        API_CORS_ORIGINS: 'http://localhost:5173',
      }),
    ).toThrow(/HTTPS/);
  });

  it('requires complete OIDC configuration', () => {
    expect(() => loadEnvironment({ OIDC_PROVIDER_KEY: 'example' })).toThrow(
      /OIDC provider key, issuer, and client ID/,
    );
  });

  it('requires complete Twilio configuration before enabling SMS', () => {
    expect(() => loadEnvironment({ SMS_PROVIDER: 'twilio' })).toThrow(
      /TWILIO_ACCOUNT_SID.*TWILIO_AUTH_TOKEN.*TWILIO_FROM/,
    );
  });

  it('accepts an explicit production security boundary', () => {
    expect(
      loadEnvironment({
        NODE_ENV: 'production',
        AUTH_SECRET: 'production-auth-secret-that-is-long-enough',
        WEB_APP_ORIGIN: 'https://app.example.test',
        API_PUBLIC_ORIGIN: 'https://api.example.test',
        API_CORS_ORIGINS: 'https://app.example.test',
      }),
    ).toMatchObject({ NODE_ENV: 'production' });
  });
});
