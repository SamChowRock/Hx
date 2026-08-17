import { Controller, Get, Header, Inject, Param, ParseUUIDPipe, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { ENVIRONMENT, type Environment } from '../../../../libs/platform/src/config';
import { AuthorizationService } from '../authorization/authorization.service';
import { readAuthCookie } from '../http/auth-http';

import { ProfileService } from './profile.service';

@Controller('profiles')
export class UserProfilesController {
  constructor(
    private readonly profiles: ProfileService,
    private readonly authorization: AuthorizationService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  private async actor(request: Request) {
    const secret = readAuthCookie(request, this.environment, 'session');
    return this.authorization.actorFromSession(secret ?? '', this.environment.AUTH_SECRET);
  }

  @Get(':userId')
  @Header('Cache-Control', 'private, no-store')
  async get(
    @Req() request: Request,
    @Param('userId', new ParseUUIDPipe({ version: '4' })) userId: string,
  ) {
    const actor = await this.actor(request);
    return this.profiles.getReadableBy(actor.userId, userId);
  }

  @Get(':userId/avatar')
  async avatar(
    @Req() request: Request,
    @Res() response: Response,
    @Param('userId', new ParseUUIDPipe({ version: '4' })) userId: string,
  ) {
    const actor = await this.actor(request);
    const avatar = await this.profiles.loadReadableAvatar(actor.userId, userId);
    if (avatar.etag && request.get('if-none-match') === avatar.etag) {
      return response.status(304).end();
    }
    response.setHeader('Content-Type', 'image/webp');
    response.setHeader('Content-Length', avatar.bytes.length);
    response.setHeader('Content-Disposition', 'inline; filename="avatar.webp"');
    response.setHeader('Cache-Control', 'private, max-age=300');
    if (avatar.etag) response.setHeader('ETag', avatar.etag);
    return response.send(avatar.bytes);
  }
}
