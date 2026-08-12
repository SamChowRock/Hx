import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type * as Oidc from 'openid-client';

import { type Environment } from '../../../../libs/platform/src/config';
import { DatabaseService } from '../../../../libs/platform/src/database';

import { hashAuthSecret } from './identity.service';
import { safeWebReturnUrl } from '../http/auth-http';

const transactionLifetimeMs = 10 * 60 * 1000;

@Injectable()
export class OidcService {
  private configuration?: Promise<Oidc.Configuration>;
  private library?: Promise<typeof import('openid-client')>;

  constructor(private readonly database: DatabaseService) {}

  private oidc(): Promise<typeof import('openid-client')> {
    this.library ??= Function('return import("openid-client")')() as Promise<
      typeof import('openid-client')
    >;
    return this.library;
  }

  private provider(environment: Environment, providerKey: string) {
    if (
      providerKey !== environment.OIDC_PROVIDER_KEY ||
      !environment.OIDC_ISSUER ||
      !environment.OIDC_CLIENT_ID
    ) {
      throw new ServiceUnavailableException('This OIDC provider is not configured.');
    }
    return {
      issuer: environment.OIDC_ISSUER,
      clientId: environment.OIDC_CLIENT_ID,
      clientSecret: environment.OIDC_CLIENT_SECRET,
    };
  }

  private async client(environment: Environment, providerKey: string) {
    const provider = this.provider(environment, providerKey);
    const oidc = await this.oidc();
    this.configuration ??= oidc.discovery(
      new URL(provider.issuer),
      provider.clientId,
      provider.clientSecret,
    );
    return this.configuration;
  }

  private key(secret: string): Buffer {
    return createHash('sha256').update(secret).digest();
  }

  private encrypt(secret: string, value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(secret), iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), ciphertext]
      .map((part) => part.toString('base64url'))
      .join('.');
  }

  private decrypt(secret: string, value: string): string {
    const [encodedIv, encodedTag, encodedCiphertext] = value.split('.');
    if (!encodedIv || !encodedTag || !encodedCiphertext) throw new UnauthorizedException();
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key(secret),
      Buffer.from(encodedIv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  callbackUrl(environment: Environment, providerKey: string): string {
    return new URL(`/api/auth/external/${providerKey}/callback`, environment.API_PUBLIC_ORIGIN)
      .href;
  }

  async start(environment: Environment, providerKey: string, returnTo: string) {
    safeWebReturnUrl(returnTo, environment);
    const [config, oidc] = await Promise.all([this.client(environment, providerKey), this.oidc()]);
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const binding = randomBytes(32).toString('base64url');
    await this.database.oidcTransaction.create({
      data: {
        providerKey,
        stateHash: hashAuthSecret(environment.AUTH_SECRET, state),
        browserBindingHash: hashAuthSecret(environment.AUTH_SECRET, binding),
        codeVerifierCiphertext: this.encrypt(environment.AUTH_SECRET, codeVerifier),
        nonceCiphertext: this.encrypt(environment.AUTH_SECRET, nonce),
        returnTo,
        expiresAt: new Date(Date.now() + transactionLifetimeMs),
      },
    });
    const authorizationUrl = oidc.buildAuthorizationUrl(config, {
      redirect_uri: this.callbackUrl(environment, providerKey),
      response_type: 'code',
      scope: 'openid profile email',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return { authorizationUrl: authorizationUrl.href, binding };
  }

  async complete(
    environment: Environment,
    providerKey: string,
    currentUrl: URL,
    binding: string | undefined,
  ) {
    const state = currentUrl.searchParams.get('state');
    if (!state || !binding) throw new UnauthorizedException('OIDC transaction is missing.');
    const transaction = await this.database.oidcTransaction.findFirst({
      where: {
        providerKey,
        stateHash: hashAuthSecret(environment.AUTH_SECRET, state),
        expiresAt: { gt: new Date() },
        consumedAt: null,
      },
    });
    if (
      !transaction ||
      transaction.browserBindingHash !== hashAuthSecret(environment.AUTH_SECRET, binding)
    )
      throw new UnauthorizedException('OIDC transaction is invalid or expired.');
    const [config, oidc] = await Promise.all([this.client(environment, providerKey), this.oidc()]);
    const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: this.decrypt(environment.AUTH_SECRET, transaction.codeVerifierCiphertext),
      expectedState: state,
      expectedNonce: this.decrypt(environment.AUTH_SECRET, transaction.nonceCiphertext),
    });
    const claims = tokens.claims();
    if (!claims?.sub) throw new UnauthorizedException('OIDC provider did not return a subject.');
    const provider = this.provider(environment, providerKey);
    const user = await this.database.$transaction(async (tx) => {
      const consumed = await tx.oidcTransaction.updateMany({
        where: { id: transaction.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) {
        throw new UnauthorizedException('OIDC transaction was already consumed.');
      }
      const existing = await tx.externalIdentity.findUnique({
        where: { issuer_providerSubject: { issuer: provider.issuer, providerSubject: claims.sub } },
      });
      if (existing) {
        await tx.externalIdentity.update({
          where: { id: existing.id },
          data: { lastLoginAt: new Date() },
        });
        const existingUser = await tx.user.findUniqueOrThrow({ where: { id: existing.userId } });
        if (existingUser.status !== 'ACTIVE') {
          throw new UnauthorizedException('This account is disabled.');
        }
        await tx.auditEvent.create({
          data: {
            actorUserId: existingUser.id,
            action: 'auth.oidc.login_succeeded',
            targetType: 'user',
            targetId: existingUser.id,
          },
        });
        return existingUser;
      }
      const displayName = typeof claims.name === 'string' ? claims.name.slice(0, 100) : 'OIDC user';
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
          providerSubject: claims.sub,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId: created.id,
          action: 'auth.oidc.login_succeeded',
          targetType: 'user',
          targetId: created.id,
        },
      });
      return created;
    });
    return { user, returnTo: transaction.returnTo };
  }
}
