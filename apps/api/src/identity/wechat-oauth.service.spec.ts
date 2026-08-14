import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

import { loadEnvironment } from '../../../../libs/platform/src/config';

import { WeChatOAuthService } from './wechat-oauth.service';

describe('WeChatOAuthService', () => {
  const environment = loadEnvironment({
    NODE_ENV: 'test',
    AUTH_SECRET: 'test-auth-secret-that-is-long-enough-for-validation',
    WEB_APP_ORIGIN: 'http://localhost:5173',
    API_PUBLIC_ORIGIN: 'http://localhost:3000',
    WECHAT_PROVIDER_KEY: 'wechat',
    WECHAT_APP_ID: 'wx-test-application',
    WECHAT_APP_SECRET: 'wechat-test-secret',
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects an unconfigured provider before creating a transaction', async () => {
    const service = new WeChatOAuthService({} as never);
    await expect(service.start(environment, 'unknown', '/')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('builds a bound website QR authorization transaction', async () => {
    const database = {
      oAuthProfileTransaction: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = new WeChatOAuthService(database as never);

    const result = await service.start(environment, 'wechat', '/settings');
    const authorizationUrl = new URL(result.authorizationUrl);
    expect(authorizationUrl.origin).toBe('https://open.weixin.qq.com');
    expect(authorizationUrl.pathname).toBe('/connect/qrconnect');
    expect(authorizationUrl.searchParams.get('appid')).toBe('wx-test-application');
    expect(authorizationUrl.searchParams.get('scope')).toBe('snsapi_login');
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/api/auth/external/wechat/callback',
    );
    expect(authorizationUrl.searchParams.get('state')).toEqual(expect.any(String));
    expect(authorizationUrl.hash).toBe('#wechat_redirect');
    expect(database.oAuthProfileTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        providerKey: 'wechat',
        stateHash: expect.any(String),
        browserBindingHash: expect.any(String),
        returnTo: '/settings',
      }),
    });
  });

  it('exchanges the code server-side and maps the app-scoped OpenID to an existing user', async () => {
    let storedTransaction: Record<string, unknown> | undefined;
    const transactionClient = {
      oAuthProfileTransaction: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      externalIdentity: {
        findUnique: jest.fn().mockResolvedValue({ id: 'identity-1', userId: 'user-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      user: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 'user-1', displayName: '微信用户', status: 'ACTIVE' }),
      },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const database = {
      oAuthProfileTransaction: {
        create: jest.fn(({ data }) => {
          storedTransaction = { id: 'transaction-1', ...data };
          return Promise.resolve(storedTransaction);
        }),
        findFirst: jest.fn(() => Promise.resolve(storedTransaction)),
      },
      $transaction: jest.fn((operation) => operation(transactionClient)),
    };
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'temporary-wechat-access-token',
            expires_in: 7_200,
            refresh_token: 'temporary-refresh-token',
            openid: 'openid-1',
            scope: 'snsapi_login',
            unionid: 'unionid-1',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ openid: 'openid-1', nickname: '微信用户', unionid: 'unionid-1' }),
          { status: 200 },
        ),
      );
    const service = new WeChatOAuthService(database as never);
    const started = await service.start(environment, 'wechat', '/projects');
    const state = new URL(started.authorizationUrl).searchParams.get('state');
    const callback = new URL('http://localhost:3000/api/auth/external/wechat/callback');
    callback.searchParams.set('code', 'single-use-code');
    callback.searchParams.set('state', state ?? '');

    await expect(
      service.complete(environment, 'wechat', callback, started.binding),
    ).resolves.toEqual({
      user: expect.objectContaining({ id: 'user-1' }),
      returnTo: '/projects',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(transactionClient.externalIdentity.findUnique).toHaveBeenCalledWith({
      where: {
        issuer_providerSubject: {
          issuer: 'https://open.weixin.qq.com/wx-test-application',
          providerSubject: 'openid:openid-1',
        },
      },
    });
    expect(transactionClient.oAuthProfileTransaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'transaction-1', consumedAt: null } }),
    );
    const databaseWrites = JSON.stringify([
      database.oAuthProfileTransaction.create.mock.calls,
      transactionClient.oAuthProfileTransaction.updateMany.mock.calls,
      transactionClient.externalIdentity.update.mock.calls,
      transactionClient.auditEvent.create.mock.calls,
    ]);
    expect(databaseWrites).not.toContain('temporary-wechat-access-token');
    expect(databaseWrites).not.toContain('temporary-refresh-token');
  });

  it('rejects a mismatched browser binding before contacting WeChat', async () => {
    const database = {
      oAuthProfileTransaction: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'transaction-1',
          browserBindingHash: 'different-binding-hash',
        }),
      },
    };
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    const service = new WeChatOAuthService(database as never);
    const callback = new URL(
      'http://localhost:3000/api/auth/external/wechat/callback?code=code&state=state',
    );

    await expect(
      service.complete(environment, 'wechat', callback, 'binding'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
