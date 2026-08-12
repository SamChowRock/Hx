import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';

import { DatabaseService } from '../../../../libs/platform/src/database';
import { type OrganizationRole } from '../../../../libs/platform/src/database/generated/client';
import { hashAuthSecret, IdentityService } from '../identity/identity.service';

export type ActorContext = {
  userId: string;
  sessionId: string;
  sessionSecret: string;
  csrfSecretHash: string;
};

export type OrganizationAction = 'read' | 'create_project' | 'manage_members';

const permittedRoles: Record<OrganizationAction, OrganizationRole[]> = {
  read: ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'],
  create_project: ['OWNER', 'ADMIN', 'MEMBER'],
  manage_members: ['OWNER', 'ADMIN'],
};

@Injectable()
export class AuthorizationService {
  constructor(
    private readonly identity: IdentityService,
    private readonly database: DatabaseService,
  ) {}

  async actorFromSession(sessionSecret: string, authSecret: string): Promise<ActorContext> {
    const session = await this.identity.currentSession(sessionSecret, (value) =>
      hashAuthSecret(authSecret, value),
    );
    if (!session || session.user.status !== 'ACTIVE') throw new UnauthorizedException();
    return {
      userId: session.userId,
      sessionId: session.id,
      sessionSecret,
      csrfSecretHash: session.csrfSecretHash,
    };
  }

  assertCsrf(actor: ActorContext, providedToken: string | undefined, authSecret: string): void {
    this.identity.assertSessionCsrf(actor.csrfSecretHash, providedToken, (value) =>
      hashAuthSecret(authSecret, value),
    );
  }

  async requireOrganizationAction(
    actor: ActorContext,
    organizationId: string,
    action: OrganizationAction,
  ) {
    const membership = await this.database.membership.findUnique({
      where: { userId_organizationId: { userId: actor.userId, organizationId } },
    });
    if (!membership || !permittedRoles[action].includes(membership.role)) {
      throw new ForbiddenException('You are not permitted to access this organization.');
    }
    return membership;
  }
}
