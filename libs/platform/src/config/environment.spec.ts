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

  it('treats blank optional provider values as disabled', () => {
    expect(
      loadEnvironment({
        OIDC_PROVIDER_KEY: '',
        OIDC_ISSUER: '',
        OIDC_CLIENT_ID: '',
        OIDC_CLIENT_SECRET: '',
        WECHAT_PROVIDER_KEY: '',
        WECHAT_APP_ID: '',
        WECHAT_APP_SECRET: '',
      }),
    ).toMatchObject({ OIDC_PROVIDER_KEY: undefined, WECHAT_PROVIDER_KEY: undefined });
  });

  it('requires complete and non-conflicting WeChat configuration', () => {
    expect(() => loadEnvironment({ WECHAT_PROVIDER_KEY: 'wechat' })).toThrow(
      /WeChat provider key, AppID, and AppSecret/,
    );
    expect(() =>
      loadEnvironment({
        OIDC_PROVIDER_KEY: 'wechat',
        OIDC_ISSUER: 'https://issuer.example.test',
        OIDC_CLIENT_ID: 'client-id',
        WECHAT_PROVIDER_KEY: 'wechat',
        WECHAT_APP_ID: 'wx-app-id',
        WECHAT_APP_SECRET: 'app-secret',
      }),
    ).toThrow(/must not conflict with OIDC_PROVIDER_KEY/);
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
