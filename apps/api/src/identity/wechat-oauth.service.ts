import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

import { type Environment } from '../../../../libs/platform/src/config';
import { DatabaseService } from '../../../../libs/platform/src/database';

import { safeWebReturnUrl } from '../http/auth-http';
import { authTokensMatch, hashAuthSecret } from './identity.service';

const transactionLifetimeMs = 10 * 60 * 1000;
const maximumProviderResponseBytes = 64 * 1024;

const accessTokenSchema = z.object({
  access_token: z.string().min(1).max(4_096),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1).max(4_096).optional(),
  openid: z.string().min(1).max(256),
  scope: z.string().min(1).max(512),
  unionid: z.string().min(1).max(256).optional(),
});

const profileSchema = z.object({
  openid: z.string().min(1).max(256),
  nickname: z.string().max(512).optional(),
  unionid: z.string().min(1).max(256).optional(),
});

const providerErrorSchema = z.object({
  errcode: z.number(),
  errmsg: z.string().optional(),
});

@Injectable()
export class WeChatOAuthService {
  constructor(private readonly database: DatabaseService) {}

  supports(environment: Environment, providerKey: string): boolean {
    return Boolean(
      environment.WECHAT_PROVIDER_KEY && providerKey === environment.WECHAT_PROVIDER_KEY,
    );
  }

  private provider(environment: Environment, providerKey: string) {
    if (
      !this.supports(environment, providerKey) ||
      !environment.WECHAT_APP_ID ||
      !environment.WECHAT_APP_SECRET
    ) {
      throw new ServiceUnavailableException('This WeChat provider is not configured.');
    }
    return {
      providerKey,
      appId: environment.WECHAT_APP_ID,
      appSecret: environment.WECHAT_APP_SECRET,
      issuer: `https://open.weixin.qq.com/${environment.WECHAT_APP_ID}`,
    };
  }

  callbackUrl(environment: Environment, providerKey: string): string {
    return new URL(`/api/auth/external/${providerKey}/callback`, environment.API_PUBLIC_ORIGIN)
      .href;
  }

  async start(environment: Environment, providerKey: string, returnTo: string) {
    const provider = this.provider(environment, providerKey);
    safeWebReturnUrl(returnTo, environment);
    const state = randomBytes(32).toString('base64url');
    const binding = randomBytes(32).toString('base64url');
    await this.database.oAuthProfileTransaction.create({
      data: {
        providerKey,
        stateHash: hashAuthSecret(environment.AUTH_SECRET, state),
        browserBindingHash: hashAuthSecret(environment.AUTH_SECRET, binding),
        returnTo,
        expiresAt: new Date(Date.now() + transactionLifetimeMs),
      },
    });

    const authorizationUrl = new URL('https://open.weixin.qq.com/connect/qrconnect');
    authorizationUrl.searchParams.set('appid', provider.appId);
    authorizationUrl.searchParams.set('redirect_uri', this.callbackUrl(environment, providerKey));
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('scope', 'snsapi_login');
    authorizationUrl.searchParams.set('state', state);
    authorizationUrl.hash = 'wechat_redirect';
    return { authorizationUrl: authorizationUrl.href, binding };
  }

  async complete(
    environment: Environment,
    providerKey: string,
    currentUrl: URL,
    binding: string | undefined,
  ) {
    const provider = this.provider(environment, providerKey);
    const state = currentUrl.searchParams.get('state');
    const code = currentUrl.searchParams.get('code');
    if (!state || !code || !binding) {
      throw new UnauthorizedException('WeChat OAuth transaction is missing.');
    }
    const transaction = await this.database.oAuthProfileTransaction.findFirst({
      where: {
        providerKey,
        stateHash: hashAuthSecret(environment.AUTH_SECRET, state),
        expiresAt: { gt: new Date() },
        consumedAt: null,
      },
    });
    if (
      !transaction ||
      !authTokensMatch(
        transaction.browserBindingHash,
        hashAuthSecret(environment.AUTH_SECRET, binding),
      )
    ) {
      throw new UnauthorizedException('WeChat OAuth transaction is invalid or expired.');
    }

    const tokenUrl = new URL('https://api.weixin.qq.com/sns/oauth2/access_token');
    tokenUrl.searchParams.set('appid', provider.appId);
    tokenUrl.searchParams.set('secret', provider.appSecret);
    tokenUrl.searchParams.set('code', code);
    tokenUrl.searchParams.set('grant_type', 'authorization_code');
    const tokenPayload = await this.requestProvider(tokenUrl);
    this.assertNoProviderError(tokenPayload);
    const tokenResult = accessTokenSchema.safeParse(tokenPayload);
    if (!tokenResult.success) {
      throw new ServiceUnavailableException('WeChat OAuth provider returned an invalid response.');
    }
    const token = tokenResult.data;
    if (
      !token.scope
        .split(',')
        .map((scope) => scope.trim())
        .includes('snsapi_login')
    ) {
      throw new UnauthorizedException('WeChat OAuth scope is invalid.');
    }

    const profileUrl = new URL('https://api.weixin.qq.com/sns/userinfo');
    profileUrl.searchParams.set('access_token', token.access_token);
    profileUrl.searchParams.set('openid', token.openid);
    profileUrl.searchParams.set('lang', 'zh_CN');
    const profilePayload = await this.requestProvider(profileUrl);
    this.assertNoProviderError(profilePayload);
    const profileResult = profileSchema.safeParse(profilePayload);
    if (!profileResult.success) {
      throw new ServiceUnavailableException('WeChat OAuth provider returned an invalid response.');
    }
    const profile = profileResult.data;
    if (profile.openid !== token.openid) {
      throw new UnauthorizedException('WeChat profile identity does not match the token.');
    }
    if (profile.unionid && token.unionid && profile.unionid !== token.unionid) {
      throw new UnauthorizedException('WeChat UnionID is inconsistent.');
    }

    // OpenID is stable inside one website application. UnionID is scoped to a
    // WeChat Open Platform account and may appear only after an application is
    // bound, so using it opportunistically would make the identity key change.
    const providerSubject = `openid:${token.openid}`;
    const displayName =
      profile.nickname
        ?.replace(/\p{Cc}/gu, '')
        .trim()
        .slice(0, 100) || 'WeChat user';
    const user = await this.database.$transaction(async (tx) => {
      const consumed = await tx.oAuthProfileTransaction.updateMany({
        where: { id: transaction.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) {
        throw new UnauthorizedException('WeChat OAuth transaction was already consumed.');
      }
      const existing = await tx.externalIdentity.findUnique({
        where: {
          issuer_providerSubject: { issuer: provider.issuer, providerSubject },
        },
      });
      if (existing) {
        const existingUser = await tx.user.findUniqueOrThrow({ where: { id: existing.userId } });
        if (existingUser.status !== 'ACTIVE') {
          throw new UnauthorizedException('This account is disabled.');
        }
        await tx.externalIdentity.update({
          where: { id: existing.id },
          data: { lastLoginAt: new Date() },
        });
        await tx.auditEvent.create({
          data: {
            actorUserId: existingUser.id,
            action: 'auth.wechat.login_succeeded',
            targetType: 'user',
            targetId: existingUser.id,
          },
        });
        return existingUser;
      }

      const created = await tx.user.create({
        data: {
          displayName,
          memberships: {
            create: {
              organization: { create: { name: `${displayName}'s organization` } },
              role: 'OWNER',
            },
          },
        },
      });
      await tx.externalIdentity.create({
        data: {
          userId: created.id,
          providerKey,
          issuer: provider.issuer,
          providerSubject,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId: created.id,
          action: 'auth.wechat.login_succeeded',
          targetType: 'user',
          targetId: created.id,
        },
      });
      return created;
    });
    return { user, returnTo: transaction.returnTo };
  }

  private async requestProvider(url: URL): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ServiceUnavailableException('WeChat OAuth provider is unavailable.');
    }
    if (!response.ok) {
      throw new ServiceUnavailableException('WeChat OAuth provider is unavailable.');
    }
    try {
      if (!response.body) {
        throw new ServiceUnavailableException(
          'WeChat OAuth provider returned an invalid response.',
        );
      }
      const declaredSize = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredSize) && declaredSize > maximumProviderResponseBytes) {
        throw new ServiceUnavailableException(
          'WeChat OAuth provider returned an invalid response.',
        );
      }
      const reader = response.body.getReader();
      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        receivedBytes += chunk.value.byteLength;
        if (receivedBytes > maximumProviderResponseBytes) {
          await reader.cancel();
          throw new ServiceUnavailableException(
            'WeChat OAuth provider returned an invalid response.',
          );
        }
        chunks.push(Buffer.from(chunk.value));
      }
      const body = Buffer.concat(chunks).toString('utf8');
      return JSON.parse(body) as unknown;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('WeChat OAuth provider returned an invalid response.');
    }
  }

  private assertNoProviderError(payload: unknown): void {
    const providerError = providerErrorSchema.safeParse(payload);
    if (providerError.success && providerError.data.errcode !== 0) {
      throw new UnauthorizedException('WeChat rejected the authorization code.');
    }
  }
}
