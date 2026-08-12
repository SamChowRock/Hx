import { Body, Controller, Get, Headers, Inject, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';

import { ENVIRONMENT, type Environment } from '../../../../libs/platform/src/config';
import { AuthorizationService } from '../authorization/authorization.service';
import { assertAllowedOrigin, readAuthCookie } from '../http/auth-http';

import { OrganizationsService } from './organizations.service';

const memberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']).default('MEMBER'),
});

@Controller('organizations/:organizationId/members')
export class OrganizationsController {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly authorization: AuthorizationService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  private async actor(request: Request) {
    const secret = readAuthCookie(request, this.environment, 'session');
    return this.authorization.actorFromSession(secret ?? '', this.environment.AUTH_SECRET);
  }

  @Get()
  async list(@Req() request: Request, @Param('organizationId') organizationId: string) {
    organizationId = z.string().uuid().parse(organizationId);
    return this.organizations.listMembers(await this.actor(request), organizationId);
  }

  @Post()
  async add(
    @Req() request: Request,
    @Param('organizationId') organizationId: string,
    @Headers('x-csrf-token') csrf: string | undefined,
    @Body() body: unknown,
  ) {
    assertAllowedOrigin(request, this.environment);
    organizationId = z.string().uuid().parse(organizationId);
    const actor = await this.actor(request);
    this.authorization.assertCsrf(actor, csrf, this.environment.AUTH_SECRET);
    const { email, role } = memberSchema.parse(body);
    return this.organizations.addMember(actor, organizationId, email, role);
  }
}
