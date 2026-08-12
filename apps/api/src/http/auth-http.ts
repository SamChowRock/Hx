import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Request, Response } from 'express';

import { type Environment } from '../../../../libs/platform/src/config';

type AuthCookieKind = 'session' | 'registration' | 'password-reset' | 'oidc-transaction';

export function authCookieName(environment: Environment, kind: AuthCookieKind): string {
  const prefix =
    environment.NODE_ENV === 'production' || environment.NODE_ENV === 'staging'
      ? '__Host-'
      : 'dev-';
  return `${prefix}${kind}`;
}

export function setAuthCookie(
  response: Response,
  environment: Environment,
  kind: AuthCookieKind,
  value: string,
  maxAgeMs?: number,
): void {
  response.cookie(authCookieName(environment, kind), value, {
    httpOnly: true,
    secure: environment.NODE_ENV === 'production' || environment.NODE_ENV === 'staging',
    sameSite: kind === 'oidc-transaction' ? 'lax' : 'strict',
    path: '/',
    maxAge: maxAgeMs,
  });
}

export function clearAuthCookie(
  response: Response,
  environment: Environment,
  kind: AuthCookieKind,
): void {
  response.clearCookie(authCookieName(environment, kind), {
    httpOnly: true,
    secure: environment.NODE_ENV === 'production' || environment.NODE_ENV === 'staging',
    sameSite: kind === 'oidc-transaction' ? 'lax' : 'strict',
    path: '/',
  });
}

export function readAuthCookie(
  request: Request,
  environment: Environment,
  kind: AuthCookieKind,
): string | undefined {
  const value = request.cookies?.[authCookieName(environment, kind)];
  return typeof value === 'string' ? value : undefined;
}

export function assertAllowedOrigin(request: Request, environment: Environment): void {
  const origin = request.get('origin');
  if (!origin) throw new ForbiddenException('Origin header is required.');

  let normalizedOrigin: string;
  try {
    normalizedOrigin = new URL(origin).origin;
  } catch {
    throw new ForbiddenException('Origin is invalid.');
  }

  if (normalizedOrigin !== new URL(environment.WEB_APP_ORIGIN).origin) {
    throw new ForbiddenException('Origin is not allowed.');
  }
}

export function safeWebReturnUrl(returnTo: string, environment: Environment): URL {
  if (!returnTo.startsWith('/') || returnTo.startsWith('//') || returnTo.includes('\\')) {
    throw new BadRequestException('Invalid return target.');
  }

  const base = new URL(environment.WEB_APP_ORIGIN);
  const target = new URL(returnTo, base);
  if (target.origin !== base.origin) throw new BadRequestException('Invalid return target.');
  return target;
}
