import { BadRequestException } from '@nestjs/common';

import { loadEnvironment } from '../../../../libs/platform/src/config';

import { authCookieName, safeWebReturnUrl } from './auth-http';

describe('authentication HTTP boundaries', () => {
  const development = loadEnvironment({ NODE_ENV: 'test' });
  const production = loadEnvironment({
    NODE_ENV: 'production',
    AUTH_SECRET: 'production-auth-secret-that-is-long-enough',
    WEB_APP_ORIGIN: 'https://app.example.test',
    API_PUBLIC_ORIGIN: 'https://api.example.test',
    API_CORS_ORIGINS: 'https://app.example.test',
  });

  it('uses __Host cookies only when Secure cookies are available', () => {
    expect(authCookieName(development, 'session')).toBe('dev-session');
    expect(authCookieName(production, 'session')).toBe('__Host-session');
  });

  it.each(['//evil.example', '/\\evil.example', 'https://evil.example', 'not-relative'])(
    'rejects unsafe return target %s',
    (returnTo) => {
      expect(() => safeWebReturnUrl(returnTo, development)).toThrow(BadRequestException);
    },
  );

  it('keeps a relative return target on the configured web origin', () => {
    expect(safeWebReturnUrl('/settings?tab=security', production).href).toBe(
      'https://app.example.test/settings?tab=security',
    );
  });
});
