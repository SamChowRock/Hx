import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../../../../libs/platform/src/database';
import { type ActorContext, AuthorizationService } from '../authorization/authorization.service';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
  ) {}

  async list(actor: ActorContext, organizationId: string) {
    await this.authorization.requireOrganizationAction(actor, organizationId, 'read');
    return this.database.project.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(actor: ActorContext, organizationId: string, name: string) {
    await this.authorization.requireOrganizationAction(actor, organizationId, 'create_project');
    return this.database.$transaction(async (tx) => {
      const project = await tx.project.create({ data: { organizationId, name } });
      await tx.auditEvent.create({
        data: {
          actorUserId: actor.userId,
          organizationId,
          action: 'project.created',
          targetType: 'project',
          targetId: project.id,
        },
      });
      return project;
    });
  }
}
