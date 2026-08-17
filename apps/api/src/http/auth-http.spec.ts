import { BadRequestException } from '@nestjs/common';

import { loadEnvironment } from '../../../../libs/platform/src/config';

import { authCookieName, safeWebReturnUrl, setAuthCookie } from './auth-http';

describe('authentication HTTP boundaries', () => {
  const development = loadEnvironment({ NODE_ENV: 'test' });
  const production = loadEnvironment({
    NODE_ENV: 'production',
    AUTH_SECRET: 'production-auth-secret-that-is-long-enough',
    WEB_APP_ORIGIN: 'https://app.example.test',
    API_PUBLIC_ORIGIN: 'https://api.example.test',
    API_CORS_ORIGINS: 'https://app.example.test',
    OBJECT_STORAGE_ENDPOINT: 'https://objects.example.test',
    OBJECT_STORAGE_ACCESS_KEY: 'production-access-key',
    OBJECT_STORAGE_SECRET_KEY: 'production-secret-key',
  });

  it('uses __Host cookies only when Secure cookies are available', () => {
    expect(authCookieName(development, 'session')).toBe('dev-session');
    expect(authCookieName(production, 'session')).toBe('__Host-session');
  });

  it('uses Lax only for the cross-site external login transaction cookie', () => {
    const response = { cookie: jest.fn() };
    setAuthCookie(response as never, production, 'external-transaction', 'binding', 60_000);
    setAuthCookie(response as never, production, 'session', 'session', 60_000);

    expect(response.cookie).toHaveBeenNthCalledWith(
      1,
      '__Host-external-transaction',
      'binding',
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' }),
    );
    expect(response.cookie).toHaveBeenNthCalledWith(
      2,
      '__Host-session',
      'session',
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'strict', path: '/' }),
    );
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
