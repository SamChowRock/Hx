import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

import { DatabaseService } from '../../../../libs/platform/src/database';

const registrationLifetimeMs = 30 * 60 * 1000;
const sessionAbsoluteLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const sessionIdleLifetimeMs = 30 * 60 * 1000;
const sessionTouchIntervalMs = 5 * 60 * 1000;
const passwordResetLifetimeMs = 30 * 60 * 1000;
const phoneCodeLifetimeMs = 10 * 60 * 1000;
const phoneSendCooldownMs = 60 * 1000;
const phoneSendWindowMs = 60 * 60 * 1000;
const phoneMaxSendsPerWindow = 5;
const phoneMaxFailedAttempts = 5;
const passwordOptions = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
  raw: false,
} satisfies argon2.HashOptions & { raw: false };

export type SessionMetadata = {
  userAgentSummary?: string;
  ipPrefixHash?: string;
};

@Injectable()
export class IdentityService {
  private activePasswordOperations = 0;
  private readonly passwordWaiters: Array<() => void> = [];
  private dummyPasswordHash?: Promise<string>;

  constructor(private readonly database: DatabaseService) {}

  private async withPasswordCapacity<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activePasswordOperations >= 4) {
      await new Promise<void>((resolve) => this.passwordWaiters.push(resolve));
    }
    this.activePasswordOperations += 1;
    try {
      return await operation();
    } finally {
      this.activePasswordOperations -= 1;
      this.passwordWaiters.shift()?.();
    }
  }

  private hashPassword(password: string): Promise<string> {
    return this.withPasswordCapacity(() => argon2.hash(password, passwordOptions));
  }

  private verifyPassword(hash: string, password: string): Promise<boolean> {
    return this.withPasswordCapacity(() => argon2.verify(hash, password));
  }

  normalizeEmail(value: string): string {
    return value.trim().toLowerCase();
  }

  normalizePhone(value: string): string | undefined {
    const phone = parsePhoneNumberFromString(value.trim());
    return phone?.isValid() ? phone.number : undefined;
  }

  async startRegistration(
    email: string,
    tokenHash: (value: string) => string,
    apiPublicOrigin: string,
  ): Promise<void> {
    const normalizedEmail = this.normalizeEmail(email);
    const token = randomBytes(32).toString('base64url');
    const contact = await this.database.userContact.findUnique({
      where: { type_normalizedValue: { type: 'EMAIL', normalizedValue: normalizedEmail } },
    });
    if (contact?.retiredAt === null) return;

    const verificationUrl = new URL('/api/auth/registrations/email/callback', apiPublicOrigin);
    verificationUrl.searchParams.set('token', token);
    await this.database.$transaction(async (tx) => {
      await tx.registrationIntent.upsert({
        where: { normalizedEmail },
        create: {
          normalizedEmail,
          tokenHash: tokenHash(token),
          expiresAt: new Date(Date.now() + registrationLifetimeMs),
        },
        update: {
          tokenHash: tokenHash(token),
          status: 'PENDING',
          expiresAt: new Date(Date.now() + registrationLifetimeMs),
          verifiedAt: null,
          consumedAt: null,
        },
      });
      await tx.outboxEvent.create({
        data: {
          type: 'email.send',
          payload: {
            to: normalizedEmail,
            subject: 'Verify your account',
            text: `Verify your account: ${verificationUrl.href}`,
          },
        },
      });
    });
  }

  async verifyRegistration(token: string, tokenHash: (value: string) => string): Promise<boolean> {
    const result = await this.database.registrationIntent.updateMany({
      where: { tokenHash: tokenHash(token), status: 'PENDING', expiresAt: { gt: new Date() } },
      data: {
        status: 'VERIFIED',
        verifiedAt: new Date(),
        expiresAt: new Date(Date.now() + registrationLifetimeMs),
      },
    });
    return result.count === 1;
  }

  async startPhoneRegistration(
    phone: string,
    tokenHash: (value: string) => string,
  ): Promise<string> {
    const normalizedPhone = this.normalizePhone(phone);
    if (!normalizedPhone) throw new BadRequestException('Phone number is invalid.');
    const challengeId = randomBytes(32).toString('base64url');
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const [contact, previous] = await Promise.all([
      this.database.userContact.findUnique({
        where: { type_normalizedValue: { type: 'PHONE', normalizedValue: normalizedPhone } },
      }),
      this.database.phoneRegistrationIntent.findUnique({ where: { normalizedPhone } }),
    ]);
    if (contact?.retiredAt === null) return challengeId;

    const now = new Date();
    const withinWindow =
      previous !== null &&
      now.getTime() - previous.sendWindowStartedAt.getTime() < phoneSendWindowMs;
    const coolingDown =
      previous !== null && now.getTime() - previous.lastSentAt.getTime() < phoneSendCooldownMs;
    if (coolingDown || (withinWindow && previous.sentCount >= phoneMaxSendsPerWindow)) {
      return challengeId;
    }
    const sentCount = withinWindow && previous ? previous.sentCount + 1 : 1;
    const sendWindowStartedAt = withinWindow && previous ? previous.sendWindowStartedAt : now;

    await this.database.$transaction(async (tx) => {
      await tx.phoneRegistrationIntent.upsert({
        where: { normalizedPhone },
        create: {
          normalizedPhone,
          challengeIdHash: tokenHash(challengeId),
          codeHash: tokenHash(`phone-code:${challengeId}:${code}`),
          expiresAt: new Date(now.getTime() + phoneCodeLifetimeMs),
        },
        update: {
          challengeIdHash: tokenHash(challengeId),
          codeHash: tokenHash(`phone-code:${challengeId}:${code}`),
          completionTokenHash: null,
          status: 'PENDING',
          failedAttempts: 0,
          sentCount,
          sendWindowStartedAt,
          lastSentAt: now,
          expiresAt: new Date(now.getTime() + phoneCodeLifetimeMs),
          verifiedAt: null,
          consumedAt: null,
        },
      });
      await tx.outboxEvent.create({
        data: {
          type: 'sms.send',
          payload: {
            to: normalizedPhone,
            body: `Your verification code is ${code}. It expires in 10 minutes.`,
          },
        },
      });
    });
    return challengeId;
  }

  async verifyPhoneRegistration(
    challengeId: string,
    code: string,
    tokenHash: (value: string) => string,
  ): Promise<string> {
    const intent = await this.database.phoneRegistrationIntent.findFirst({
      where: {
        challengeIdHash: tokenHash(challengeId),
        status: 'PENDING',
        expiresAt: { gt: new Date() },
        consumedAt: null,
        failedAttempts: { lt: phoneMaxFailedAttempts },
      },
    });
    const providedHash = tokenHash(`phone-code:${challengeId}:${code}`);
    if (!intent || !authTokensMatch(intent.codeHash, providedHash)) {
      if (intent) {
        await this.database.phoneRegistrationIntent.updateMany({
          where: {
            id: intent.id,
            status: 'PENDING',
            failedAttempts: { lt: phoneMaxFailedAttempts },
          },
          data: { failedAttempts: { increment: 1 } },
        });
      }
      throw new UnauthorizedException('Verification challenge is invalid or expired.');
    }

    const completionToken = randomBytes(32).toString('base64url');
    const verified = await this.database.phoneRegistrationIntent.updateMany({
      where: {
        id: intent.id,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
        failedAttempts: { lt: phoneMaxFailedAttempts },
      },
      data: {
        status: 'VERIFIED',
        verifiedAt: new Date(),
        completionTokenHash: tokenHash(completionToken),
        expiresAt: new Date(Date.now() + registrationLifetimeMs),
      },
    });
    if (verified.count !== 1) {
      throw new UnauthorizedException('Verification challenge is invalid or expired.');
    }
    return completionToken;
  }

  async completeRegistration(
    registrationSession: string,
    displayName: string,
    password: string,
    tokenHash: (value: string) => string,
  ) {
    const separator = registrationSession.indexOf('.');
    const method = registrationSession.slice(0, separator);
    const secret = separator > 0 ? registrationSession.slice(separator + 1) : '';
    const emailIntent =
      method === 'email'
        ? await this.database.registrationIntent.findFirst({
            where: {
              tokenHash: tokenHash(secret),
              status: 'VERIFIED',
              expiresAt: { gt: new Date() },
              consumedAt: null,
            },
          })
        : null;
    const phoneIntent =
      method === 'phone'
        ? await this.database.phoneRegistrationIntent.findFirst({
            where: {
              completionTokenHash: tokenHash(secret),
              status: 'VERIFIED',
              expiresAt: { gt: new Date() },
              consumedAt: null,
            },
          })
        : null;
    const registration = emailIntent
      ? {
          method: 'email' as const,
          id: emailIntent.id,
          type: 'EMAIL' as const,
          normalizedValue: emailIntent.normalizedEmail,
        }
      : phoneIntent
        ? {
            method: 'phone' as const,
            id: phoneIntent.id,
            type: 'PHONE' as const,
            normalizedValue: phoneIntent.normalizedPhone,
          }
        : undefined;
    if (!registration) {
      throw new UnauthorizedException('Registration verification is invalid or expired.');
    }

    const passwordHash = await this.hashPassword(password);
    return this.database.$transaction(async (tx) => {
      const consumed =
        registration.method === 'email'
          ? await tx.registrationIntent.updateMany({
              where: { id: registration.id, status: 'VERIFIED', consumedAt: null },
              data: { status: 'CONSUMED', consumedAt: new Date() },
            })
          : await tx.phoneRegistrationIntent.updateMany({
              where: { id: registration.id, status: 'VERIFIED', consumedAt: null },
              data: { status: 'CONSUMED', consumedAt: new Date() },
            });
      if (consumed.count !== 1) throw new ConflictException('Registration was already completed.');
      const user = await tx.user.create({
        data: {
          displayName,
          contacts: {
            create: {
              type: registration.type,
              normalizedValue: registration.normalizedValue,
              verifiedAt: new Date(),
            },
          },
          credential: { create: { passwordHash } },
          memberships: {
            create: {
              organization: { create: { name: `${displayName}'s organization` } },
              role: 'OWNER',
            },
          },
        },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId: user.id,
          action: 'auth.registration.completed',
          targetType: 'user',
          targetId: user.id,
        },
      });
      return user;
    });
  }

  async authenticate(identifier: string, password: string) {
    const isEmail = identifier.includes('@');
    const normalizedValue = isEmail
      ? this.normalizeEmail(identifier)
      : this.normalizePhone(identifier);
    const contact = await this.database.userContact.findUnique({
      where: {
        type_normalizedValue: normalizedValue
          ? { type: isEmail ? 'EMAIL' : 'PHONE', normalizedValue }
          : { type: isEmail ? 'EMAIL' : 'PHONE', normalizedValue: '__invalid_identifier__' },
      },
      include: { user: { include: { credential: true } } },
    });
    this.dummyPasswordHash ??= this.hashPassword('not-a-real-password-credential');
    const hash = contact?.user.credential?.passwordHash ?? (await this.dummyPasswordHash);
    const passwordMatches = await this.verifyPassword(hash, password);
    const valid =
      Boolean(contact?.user.credential) &&
      contact?.retiredAt === null &&
      contact?.user.status === 'ACTIVE' &&
      passwordMatches;

    await this.database.auditEvent.create({
      data: {
        actorUserId: contact?.userId,
        action: valid ? 'auth.password.login_succeeded' : 'auth.password.login_failed',
        targetType: 'user',
        targetId: contact?.userId,
      },
    });

    if (!valid || !contact?.user.credential)
      throw new UnauthorizedException('Invalid email or password.');

    if (argon2.needsRehash(contact.user.credential.passwordHash, passwordOptions)) {
      await this.database.passwordCredential.update({
        where: { userId: contact.userId },
        data: { passwordHash: await this.hashPassword(password) },
      });
    }
    return contact.user;
  }

  async createSession(
    userId: string,
    tokenHash: (value: string) => string,
    metadata: SessionMetadata = {},
  ): Promise<string> {
    const secret = randomBytes(32).toString('base64url');
    const csrf = tokenHash(`csrf:${secret}`);
    const now = Date.now();
    await this.database.session.create({
      data: {
        userId,
        secretHash: tokenHash(secret),
        csrfSecretHash: tokenHash(csrf),
        absoluteExpiresAt: new Date(now + sessionAbsoluteLifetimeMs),
        idleExpiresAt: new Date(now + sessionIdleLifetimeMs),
        userAgentSummary: metadata.userAgentSummary,
        ipPrefixHash: metadata.ipPrefixHash,
      },
    });
    return secret;
  }

  async currentSession(secret: string, tokenHash: (value: string) => string) {
    const session = await this.database.session.findFirst({
      where: {
        secretHash: tokenHash(secret),
        revokedAt: null,
        absoluteExpiresAt: { gt: new Date() },
        idleExpiresAt: { gt: new Date() },
      },
      include: { user: { include: { memberships: true } } },
    });
    if (session && Date.now() - session.lastSeenAt.getTime() >= sessionTouchIntervalMs) {
      const idleExpiresAt = new Date(
        Math.min(Date.now() + sessionIdleLifetimeMs, session.absoluteExpiresAt.getTime()),
      );
      await this.database.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date(), idleExpiresAt },
      });
    }
    return session;
  }

  assertSessionCsrf(
    csrfSecretHash: string,
    providedToken: string | undefined,
    tokenHash: (value: string) => string,
  ): void {
    if (!providedToken) throw new ForbiddenException('Invalid CSRF token.');
    const expected = Buffer.from(csrfSecretHash);
    const actual = Buffer.from(tokenHash(providedToken));
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new ForbiddenException('Invalid CSRF token.');
    }
  }

  async listSessions(userId: string) {
    return this.database.session.findMany({
      where: { userId, revokedAt: null, absoluteExpiresAt: { gt: new Date() } },
      select: {
        id: true,
        createdAt: true,
        lastSeenAt: true,
        absoluteExpiresAt: true,
        idleExpiresAt: true,
        userAgentSummary: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const result = await this.database.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: 'user_revoked' },
    });
    if (result.count !== 1) throw new NotFoundException('Session was not found.');
    await this.database.auditEvent.create({
      data: {
        actorUserId: userId,
        action: 'auth.session.revoked',
        targetType: 'session',
        targetId: sessionId,
      },
    });
  }

  async changePassword(
    userId: string,
    currentSessionId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const credential = await this.database.passwordCredential.findUnique({ where: { userId } });
    const valid = credential
      ? await this.verifyPassword(credential.passwordHash, currentPassword)
      : false;
    if (!credential || !valid) throw new UnauthorizedException('Current password is invalid.');
    const passwordHash = await this.hashPassword(newPassword);
    await this.database.$transaction(async (tx) => {
      await tx.passwordCredential.update({
        where: { userId },
        data: { passwordHash, passwordChangedAt: new Date() },
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: 'password_changed' },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          action: 'auth.password.changed',
          targetType: 'session',
          targetId: currentSessionId,
        },
      });
    });
  }

  async logout(secret: string, tokenHash: (value: string) => string): Promise<void> {
    const session = await this.currentSession(secret, tokenHash);
    await this.database.$transaction(async (tx) => {
      await tx.session.updateMany({
        where: { secretHash: tokenHash(secret), revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: 'logout' },
      });
      if (session)
        await tx.auditEvent.create({
          data: {
            actorUserId: session.userId,
            action: 'auth.session.logout',
            targetType: 'session',
            targetId: session.id,
          },
        });
    });
  }

  async startPasswordReset(
    email: string,
    tokenHash: (value: string) => string,
    apiPublicOrigin: string,
  ): Promise<void> {
    const normalizedEmail = this.normalizeEmail(email);
    const token = randomBytes(32).toString('base64url');
    const contact = await this.database.userContact.findUnique({
      where: {
        type_normalizedValue: { type: 'EMAIL', normalizedValue: normalizedEmail },
      },
    });
    if (!contact || contact.retiredAt !== null) return;

    const resetUrl = new URL('/api/auth/password/reset/callback', apiPublicOrigin);
    resetUrl.searchParams.set('token', token);
    await this.database.$transaction(async (tx) => {
      await tx.passwordResetIntent.upsert({
        where: { userId: contact.userId },
        create: {
          userId: contact.userId,
          tokenHash: tokenHash(token),
          expiresAt: new Date(Date.now() + passwordResetLifetimeMs),
        },
        update: {
          tokenHash: tokenHash(token),
          expiresAt: new Date(Date.now() + passwordResetLifetimeMs),
          consumedAt: null,
        },
      });
      await tx.outboxEvent.create({
        data: {
          type: 'email.send',
          payload: {
            to: normalizedEmail,
            subject: 'Reset your password',
            text: `Reset your password: ${resetUrl.href}`,
          },
        },
      });
    });
  }

  async verifyPasswordReset(token: string, tokenHash: (value: string) => string): Promise<boolean> {
    const result = await this.database.passwordResetIntent.findFirst({
      where: { tokenHash: tokenHash(token), expiresAt: { gt: new Date() }, consumedAt: null },
    });
    return result !== null;
  }

  async resetPassword(
    token: string,
    password: string,
    tokenHash: (value: string) => string,
  ): Promise<void> {
    const intent = await this.database.passwordResetIntent.findFirst({
      where: { tokenHash: tokenHash(token), expiresAt: { gt: new Date() }, consumedAt: null },
    });
    if (!intent) throw new UnauthorizedException('Password reset is invalid or expired.');
    const passwordHash = await this.hashPassword(password);
    await this.database.$transaction(async (tx) => {
      const consumed = await tx.passwordResetIntent.updateMany({
        where: { id: intent.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) throw new ConflictException('Password reset was already used.');
      await tx.passwordCredential.update({
        where: { userId: intent.userId },
        data: { passwordHash, passwordChangedAt: new Date() },
      });
      await tx.session.updateMany({
        where: { userId: intent.userId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: 'password_reset' },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId: intent.userId,
          action: 'auth.password.reset',
          targetType: 'user',
          targetId: intent.userId,
        },
      });
    });
  }
}

export function hashAuthSecret(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function csrfToken(secret: string, sessionSecret: string): string {
  return hashAuthSecret(secret, `csrf:${sessionSecret}`);
}

export function transientCsrfToken(
  secret: string,
  purpose: 'registration' | 'password-reset',
  transactionSecret: string,
): string {
  return hashAuthSecret(secret, `csrf:${purpose}:${transactionSecret}`);
}

export function authTokensMatch(expected: string, actual: string | undefined): boolean {
  if (!actual) return false;
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}
