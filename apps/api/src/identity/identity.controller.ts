import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { ENVIRONMENT, type Environment } from '../../../../libs/platform/src/config';

import {
  assertAllowedOrigin,
  clearAuthCookie,
  readAuthCookie,
  safeWebReturnUrl,
  setAuthCookie,
} from '../http/auth-http';
import {
  authTokensMatch,
  csrfToken,
  hashAuthSecret,
  IdentityService,
  transientCsrfToken,
} from './identity.service';
import { OidcService } from './oidc.service';

const emailSchema = z.object({ email: z.string().email() });
const completionSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  password: z.string().min(15).max(128),
});
const loginSchema = z
  .union([
    z.object({ identifier: z.string().trim().min(1).max(320), password: z.string().min(1) }),
    z.object({ email: z.string().email(), password: z.string().min(1) }),
  ])
  .transform((value) => ({
    identifier: 'identifier' in value ? value.identifier : value.email,
    password: value.password,
  }));
const phoneSchema = z.object({ phone: z.string().trim().min(8).max(32) });
const phoneVerificationSchema = z.object({
  challengeId: z.string().min(32).max(128),
  code: z.string().regex(/^\d{6}$/),
});
const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(15).max(128),
});

@Controller('auth')
export class IdentityController {
  constructor(
    private readonly identity: IdentityService,
    private readonly oidc: OidcService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  private hash(value: string): string {
    return hashAuthSecret(this.environment.AUTH_SECRET, value);
  }
  private setSession(response: Response, secret: string): void {
    setAuthCookie(response, this.environment, 'session', secret, 7 * 24 * 60 * 60 * 1000);
  }
  private sessionSecret(request: Request): string {
    const secret = readAuthCookie(request, this.environment, 'session');
    if (!secret) throw new UnauthorizedException();
    return secret;
  }

  private sessionMetadata(request: Request) {
    const userAgent = request.get('user-agent')?.slice(0, 256);
    const address = request.ip ?? request.socket.remoteAddress ?? '';
    const prefix = address.includes(':')
      ? address.split(':').slice(0, 4).join(':')
      : address.split('.').slice(0, 3).join('.');
    return {
      userAgentSummary: userAgent,
      ipPrefixHash: prefix ? this.hash(`ip:${prefix}`) : undefined,
    };
  }

  private assertTransientCsrf(
    purpose: 'registration' | 'password-reset',
    transactionSecret: string,
    providedToken: string | undefined,
  ): void {
    const expected = transientCsrfToken(this.environment.AUTH_SECRET, purpose, transactionSecret);
    if (!authTokensMatch(expected, providedToken)) {
      throw new ForbiddenException('Invalid CSRF token.');
    }
  }

  private async obscureAccountExistence(operation: () => Promise<void>): Promise<void> {
    const startedAt = Date.now();
    await operation();
    const minimumDurationMs = 200 + Math.floor(Math.random() * 50);
    const remainingMs = minimumDurationMs - (Date.now() - startedAt);
    if (remainingMs > 0) await new Promise((resolve) => setTimeout(resolve, remainingMs));
  }

  @Post('registrations/email')
  @HttpCode(HttpStatus.ACCEPTED)
  async register(@Body() body: unknown, @Req() request: Request) {
    assertAllowedOrigin(request, this.environment);
    const { email } = emailSchema.parse(body);
    await this.obscureAccountExistence(() =>
      this.identity.startRegistration(
        email,
        (value) => this.hash(value),
        this.environment.API_PUBLIC_ORIGIN,
      ),
    );
    return { status: 'accepted' };
  }

  @Get('registrations/email/callback')
  async callback(@Query('token') token: string, @Res() response: Response) {
    const parsedToken = z.string().min(32).max(128).parse(token);
    if (!(await this.identity.verifyRegistration(parsedToken, (value) => this.hash(value))))
      throw new UnauthorizedException('Verification link is invalid or expired.');
    setAuthCookie(
      response,
      this.environment,
      'registration',
      `email.${parsedToken}`,
      30 * 60 * 1000,
    );
    return response.redirect(302, this.environment.WEB_APP_ORIGIN);
  }

  @Post('registrations/phone')
  @HttpCode(HttpStatus.ACCEPTED)
  async registerPhone(@Body() body: unknown, @Req() request: Request) {
    assertAllowedOrigin(request, this.environment);
    if (this.environment.SMS_PROVIDER === 'disabled') {
      throw new ServiceUnavailableException('Phone registration is not configured.');
    }
    const { phone } = phoneSchema.parse(body);
    let challengeId = '';
    await this.obscureAccountExistence(async () => {
      challengeId = await this.identity.startPhoneRegistration(phone, (value) => this.hash(value));
    });
    return { status: 'accepted', challengeId };
  }

  @Post('registrations/phone/verify')
  @HttpCode(HttpStatus.OK)
  async verifyPhoneRegistration(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertAllowedOrigin(request, this.environment);
    const { challengeId, code } = phoneVerificationSchema.parse(body);
    const completionToken = await this.identity.verifyPhoneRegistration(
      challengeId,
      code,
      (value) => this.hash(value),
    );
    setAuthCookie(
      response,
      this.environment,
      'registration',
      `phone.${completionToken}`,
      30 * 60 * 1000,
    );
    return { status: 'verified' };
  }

  @Get('registration-session')
  registrationSession(@Req() request: Request) {
    const token = readAuthCookie(request, this.environment, 'registration');
    if (!token) throw new UnauthorizedException('Registration session is required.');
    return {
      csrfToken: transientCsrfToken(this.environment.AUTH_SECRET, 'registration', token),
    };
  }

  @Post('registrations/complete')
  async complete(
    @Body() body: unknown,
    @Req() request: Request,
    @Headers('x-csrf-token') providedCsrf: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertAllowedOrigin(request, this.environment);
    const registrationToken = readAuthCookie(request, this.environment, 'registration');
    if (!registrationToken) throw new UnauthorizedException('Registration session is required.');
    this.assertTransientCsrf('registration', registrationToken, providedCsrf);
    const { displayName, password } = completionSchema.parse(body);
    const user = await this.identity.completeRegistration(
      registrationToken,
      displayName,
      password,
      (value) => this.hash(value),
    );
    this.setSession(
      response,
      await this.identity.createSession(
        user.id,
        (value) => this.hash(value),
        this.sessionMetadata(request),
      ),
    );
    clearAuthCookie(response, this.environment, 'registration');
    return { id: user.id, displayName: user.displayName };
  }

  @Post('login/password')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertAllowedOrigin(request, this.environment);
    const { identifier, password } = loginSchema.parse(body);
    const user = await this.identity.authenticate(identifier, password);
    this.setSession(
      response,
      await this.identity.createSession(
        user.id,
        (value) => this.hash(value),
        this.sessionMetadata(request),
      ),
    );
    return { id: user.id, displayName: user.displayName };
  }

  @Post('external/:provider/start')
  @HttpCode(HttpStatus.OK)
  async startOidc(
    @Param('provider') provider: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertAllowedOrigin(request, this.environment);
    const returnTo = z.object({ returnTo: z.string().default('/') }).parse(body).returnTo;
    safeWebReturnUrl(returnTo, this.environment);
    const transaction = await this.oidc.start(this.environment, provider, returnTo);
    setAuthCookie(
      response,
      this.environment,
      'oidc-transaction',
      transaction.binding,
      10 * 60 * 1000,
    );
    return { authorizationUrl: transaction.authorizationUrl };
  }

  @Get('external/:provider/callback')
  async oidcCallback(
    @Param('provider') provider: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const binding = readAuthCookie(request, this.environment, 'oidc-transaction');
    const currentUrl = new URL(request.originalUrl, this.environment.API_PUBLIC_ORIGIN);
    const result = await this.oidc.complete(this.environment, provider, currentUrl, binding);
    this.setSession(
      response,
      await this.identity.createSession(
        result.user.id,
        (value) => this.hash(value),
        this.sessionMetadata(request),
      ),
    );
    clearAuthCookie(response, this.environment, 'oidc-transaction');
    return response.redirect(302, safeWebReturnUrl(result.returnTo, this.environment).href);
  }

  @Post('password/reset/request')
  @HttpCode(HttpStatus.ACCEPTED)
  async requestPasswordReset(@Body() body: unknown, @Req() request: Request) {
    assertAllowedOrigin(request, this.environment);
    const { email } = emailSchema.parse(body);
    await this.obscureAccountExistence(() =>
      this.identity.startPasswordReset(
        email,
        (value) => this.hash(value),
        this.environment.API_PUBLIC_ORIGIN,
      ),
    );
    return { status: 'accepted' };
  }

  @Get('password/reset/callback')
  async passwordResetCallback(@Query('token') token: string, @Res() response: Response) {
    const parsedToken = z.string().min(32).max(128).parse(token);
    if (!(await this.identity.verifyPasswordReset(parsedToken, (value) => this.hash(value))))
      throw new UnauthorizedException('Password reset link is invalid or expired.');
    setAuthCookie(response, this.environment, 'password-reset', parsedToken, 30 * 60 * 1000);
    return response.redirect(302, this.environment.WEB_APP_ORIGIN);
  }

  @Get('password/reset/session')
  passwordResetSession(@Req() request: Request) {
    const token = readAuthCookie(request, this.environment, 'password-reset');
    if (!token) throw new UnauthorizedException('Password reset session is required.');
    return {
      csrfToken: transientCsrfToken(this.environment.AUTH_SECRET, 'password-reset', token),
    };
  }

  @Post('password/reset/confirm')
  @HttpCode(HttpStatus.OK)
  async confirmPasswordReset(
    @Body() body: unknown,
    @Req() request: Request,
    @Headers('x-csrf-token') providedCsrf: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertAllowedOrigin(request, this.environment);
    const token = readAuthCookie(request, this.environment, 'password-reset');
    if (!token) throw new UnauthorizedException('Password reset session is required.');
    this.assertTransientCsrf('password-reset', token, providedCsrf);
    const { password } = completionSchema.pick({ password: true }).parse(body);
    await this.identity.resetPassword(token, password, (value) => this.hash(value));
    clearAuthCookie(response, this.environment, 'password-reset');
    return { status: 'ok' };
  }

  @Get('session')
  async session(@Req() request: Request) {
    const secret = this.sessionSecret(request);
    const session = await this.identity.currentSession(secret, (value) => this.hash(value));
    if (!session || session.user.status !== 'ACTIVE') throw new UnauthorizedException();
    return {
      user: { id: session.user.id, displayName: session.user.displayName },
      organizations: session.user.memberships.map((membership) => ({
        id: membership.organizationId,
        role: membership.role,
      })),
      csrfToken: csrfToken(this.environment.AUTH_SECRET, secret),
    };
  }

  @Get('sessions')
  async sessions(@Req() request: Request) {
    const secret = this.sessionSecret(request);
    const session = await this.identity.currentSession(secret, (value) => this.hash(value));
    if (!session || session.user.status !== 'ACTIVE') throw new UnauthorizedException();
    const sessions = await this.identity.listSessions(session.userId);
    return sessions.map((candidate) => ({
      ...candidate,
      current: candidate.id === session.id,
    }));
  }

  @Delete('sessions/:sessionId')
  async revokeSession(
    @Param('sessionId') sessionId: string,
    @Req() request: Request,
    @Headers('x-csrf-token') providedCsrf: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertAllowedOrigin(request, this.environment);
    sessionId = z.string().uuid().parse(sessionId);
    const secret = this.sessionSecret(request);
    const session = await this.identity.currentSession(secret, (value) => this.hash(value));
    if (!session || session.user.status !== 'ACTIVE') throw new UnauthorizedException();
    this.identity.assertSessionCsrf(session.csrfSecretHash, providedCsrf, (value) =>
      this.hash(value),
    );
    await this.identity.revokeSession(session.userId, sessionId);
    if (session.id === sessionId) clearAuthCookie(response, this.environment, 'session');
    return { status: 'ok' };
  }

  @Post('password/change')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body() body: unknown,
    @Req() request: Request,
    @Headers('x-csrf-token') providedCsrf: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertAllowedOrigin(request, this.environment);
    const secret = this.sessionSecret(request);
    const session = await this.identity.currentSession(secret, (value) => this.hash(value));
    if (!session || session.user.status !== 'ACTIVE') throw new UnauthorizedException();
    this.identity.assertSessionCsrf(session.csrfSecretHash, providedCsrf, (value) =>
      this.hash(value),
    );
    const { currentPassword, newPassword } = passwordChangeSchema.parse(body);
    await this.identity.changePassword(session.userId, session.id, currentPassword, newPassword);
    this.setSession(
      response,
      await this.identity.createSession(
        session.userId,
        (value) => this.hash(value),
        this.sessionMetadata(request),
      ),
    );
    return { status: 'ok' };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() request: Request,
    @Headers('x-csrf-token') providedCsrf: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertAllowedOrigin(request, this.environment);
    const secret = this.sessionSecret(request);
    const session = await this.identity.currentSession(secret, (value) => this.hash(value));
    if (!session || session.user.status !== 'ACTIVE') throw new UnauthorizedException();
    this.identity.assertSessionCsrf(session.csrfSecretHash, providedCsrf, (value) =>
      this.hash(value),
    );
    await this.identity.logout(secret, (value) => this.hash(value));
    clearAuthCookie(response, this.environment, 'session');
    return { status: 'ok' };
  }
}
