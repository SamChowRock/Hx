import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

import { type Environment } from '../../../../libs/platform/src/config';

import { OidcService } from './oidc.service';

describe('OidcService', () => {
  const environment: Environment = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://scaffold:scaffold@localhost:5432/scaffold',
    PORT: 3000,
    LOG_LEVEL: 'info',
    API_CORS_ORIGINS: '',
    SERVICE_NAME: 'test',
    TRUST_PROXY: false,
    AUTH_SECRET: 'test-auth-secret-that-is-long-enough-for-validation',
    SMTP_URL: 'smtp://localhost:1025',
    EMAIL_FROM: 'no-reply@example.test',
    SMS_PROVIDER: 'disabled',
    WEB_APP_ORIGIN: 'http://localhost:5173',
    API_PUBLIC_ORIGIN: 'http://localhost:3000',
  };

  it('rejects an unconfigured provider before creating an OIDC transaction', async () => {
    const service = new OidcService({} as never);
    await expect(service.start(environment, 'example', '/')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('builds an exact API callback URL', () => {
    const service = new OidcService({} as never);
    expect(service.callbackUrl(environment, 'example')).toBe(
      'http://localhost:3000/api/auth/external/example/callback',
    );
  });

  it.each(['//evil.example', '/\\evil.example', 'https://evil.example'])(
    'rejects an unsafe post-login return target before provider discovery',
    async (returnTo) => {
      const service = new OidcService({} as never);
      await expect(service.start(environment, 'example', returnTo)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );

  it('binds state, nonce, PKCE, browser state, and one-time consumption', async () => {
    const configured = {
      ...environment,
      OIDC_PROVIDER_KEY: 'example',
      OIDC_ISSUER: 'https://issuer.example',
      OIDC_CLIENT_ID: 'client-id',
    };
    let storedTransaction: Record<string, unknown> | undefined;
    const transactionClient = {
      oidcTransaction: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      externalIdentity: {
        findUnique: jest.fn().mockResolvedValue({ id: 'identity-1', userId: 'user-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      user: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 'user-1', displayName: 'Existing', status: 'ACTIVE' }),
      },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const database = {
      oidcTransaction: {
        create: jest.fn(({ data }) => {
          storedTransaction = { id: 'transaction-1', ...data };
          return Promise.resolve(storedTransaction);
        }),
        findFirst: jest.fn(() => Promise.resolve(storedTransaction)),
      },
      $transaction: jest.fn((operation) => operation(transactionClient)),
    };
    const authorizationCodeGrant = jest.fn().mockResolvedValue({
      claims: () => ({ sub: 'subject-1', name: 'Existing' }),
    });
    const oidc = {
      discovery: jest.fn().mockResolvedValue({}),
      randomPKCECodeVerifier: () => 'pkce-verifier',
      calculatePKCECodeChallenge: jest.fn().mockResolvedValue('pkce-challenge'),
      randomState: () => 'oidc-state',
      randomNonce: () => 'oidc-nonce',
      buildAuthorizationUrl: jest.fn((_configuration, parameters) => {
        const url = new URL('https://issuer.example/authorize');
        for (const [name, value] of Object.entries(parameters)) {
          if (typeof value === 'string') url.searchParams.set(name, value);
        }
        return url;
      }),
      authorizationCodeGrant,
    };
    const service = new OidcService(database as never);
    const internals = service as unknown as {
      library: Promise<typeof oidc>;
      configuration: Promise<object>;
    };
    internals.library = Promise.resolve(oidc);
    internals.configuration = Promise.resolve({});

    const started = await service.start(configured, 'example', '/settings');
    const authorizationUrl = new URL(started.authorizationUrl);
    expect(authorizationUrl.searchParams.get('state')).toBe('oidc-state');
    expect(authorizationUrl.searchParams.get('nonce')).toBe('oidc-nonce');
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(storedTransaction?.codeVerifierCiphertext).not.toBe('pkce-verifier');
    expect(storedTransaction?.nonceCiphertext).not.toBe('oidc-nonce');

    const callback = new URL('http://localhost:3000/api/auth/external/example/callback');
    callback.searchParams.set('state', 'oidc-state');
    callback.searchParams.set('code', 'authorization-code');
    await expect(
      service.complete(configured, 'example', callback, started.binding),
    ).resolves.toEqual({
      user: expect.objectContaining({ id: 'user-1' }),
      returnTo: '/settings',
    });
    expect(authorizationCodeGrant).toHaveBeenCalledWith(
      expect.anything(),
      callback,
      expect.objectContaining({
        expectedState: 'oidc-state',
        expectedNonce: 'oidc-nonce',
        pkceCodeVerifier: 'pkce-verifier',
      }),
    );
    expect(transactionClient.oidcTransaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'transaction-1', consumedAt: null } }),
    );

    await expect(
      service.complete(configured, 'example', callback, 'wrong-binding'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
