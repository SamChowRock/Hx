import { Body, Controller, Get, Headers, Inject, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';

import { ENVIRONMENT, type Environment } from '../../../../libs/platform/src/config';
import { AuthorizationService } from '../authorization/authorization.service';
import { assertAllowedOrigin, readAuthCookie } from '../http/auth-http';

import { ProjectsService } from './projects.service';

const projectSchema = z.object({ name: z.string().trim().min(1).max(200) });

@Controller('organizations/:organizationId/projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
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
    return this.projects.list(await this.actor(request), organizationId);
  }

  @Post()
  async create(
    @Req() request: Request,
    @Param('organizationId') organizationId: string,
    @Headers('x-csrf-token') csrf: string | undefined,
    @Body() body: unknown,
  ) {
    assertAllowedOrigin(request, this.environment);
    organizationId = z.string().uuid().parse(organizationId);
    const actor = await this.actor(request);
    this.authorization.assertCsrf(actor, csrf, this.environment.AUTH_SECRET);
    return this.projects.create(actor, organizationId, projectSchema.parse(body).name);
  }
}
