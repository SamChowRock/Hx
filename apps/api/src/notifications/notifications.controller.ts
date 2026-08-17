import {
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  Inject,
  Param,
  Patch,
  Query,
  Req,
  Sse,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';

import { ENVIRONMENT, type Environment } from '../../../../libs/platform/src/config';
import { AuthorizationService } from '../authorization/authorization.service';
import { assertAllowedOrigin, readAuthCookie } from '../http/auth-http';

import { NotificationsService } from './notifications.service';

const listQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().min(1).max(512).optional(),
    unreadOnly: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  })
  .strict();

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly authorization: AuthorizationService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  private async actor(request: Request) {
    const secret = readAuthCookie(request, this.environment, 'session');
    return this.authorization.actorFromSession(secret ?? '', this.environment.AUTH_SECRET);
  }

  private async mutationActor(request: Request, csrf: string | undefined) {
    assertAllowedOrigin(request, this.environment);
    const actor = await this.actor(request);
    this.authorization.assertCsrf(actor, csrf, this.environment.AUTH_SECRET);
    return actor;
  }

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async list(@Req() request: Request, @Query() query: unknown) {
    const actor = await this.actor(request);
    return this.notifications.list(actor.userId, listQuerySchema.parse(query));
  }

  @Get('unread-count')
  @Header('Cache-Control', 'private, no-store')
  async unreadCount(@Req() request: Request) {
    return {
      unreadCount: await this.notifications.unreadCount((await this.actor(request)).userId),
    };
  }

  @Sse('stream')
  @Header('Cache-Control', 'no-cache, no-transform')
  @Header('X-Accel-Buffering', 'no')
  async stream(@Req() request: Request, @Headers('last-event-id') lastEventId?: string) {
    const actor = await this.actor(request);
    const parsedLastEventId = lastEventId ? z.string().uuid().parse(lastEventId) : undefined;
    return this.notifications.stream(actor.userId, parsedLastEventId);
  }

  @Patch('read-all')
  @Header('Cache-Control', 'private, no-store')
  async markAllRead(@Req() request: Request, @Headers('x-csrf-token') csrf: string | undefined) {
    return this.notifications.markAllRead((await this.mutationActor(request, csrf)).userId);
  }

  @Patch(':notificationId/read')
  @Header('Cache-Control', 'private, no-store')
  async markRead(
    @Req() request: Request,
    @Headers('x-csrf-token') csrf: string | undefined,
    @Param('notificationId') notificationId: string,
  ) {
    const actor = await this.mutationActor(request, csrf);
    return this.notifications.markRead(actor.userId, z.string().uuid().parse(notificationId));
  }

  @Delete('read')
  @Header('Cache-Control', 'private, no-store')
  async clearRead(@Req() request: Request, @Headers('x-csrf-token') csrf: string | undefined) {
    return this.notifications.clearRead((await this.mutationActor(request, csrf)).userId);
  }

  @Delete(':notificationId')
  @Header('Cache-Control', 'private, no-store')
  async dismiss(
    @Req() request: Request,
    @Headers('x-csrf-token') csrf: string | undefined,
    @Param('notificationId') notificationId: string,
  ) {
    const actor = await this.mutationActor(request, csrf);
    return this.notifications.dismiss(actor.userId, z.string().uuid().parse(notificationId));
  }
}
