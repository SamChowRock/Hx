import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { type OrganizationRole } from '../../../../libs/platform/src/database/generated/client';

import { DatabaseService } from '../../../../libs/platform/src/database';
import { type ActorContext, AuthorizationService } from '../authorization/authorization.service';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
  ) {}

  async listMembers(actor: ActorContext, organizationId: string) {
    await this.authorization.requireOrganizationAction(actor, organizationId, 'read');
    return this.database.membership.findMany({
      where: { organizationId },
      include: { user: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addMember(
    actor: ActorContext,
    organizationId: string,
    email: string,
    role: Exclude<OrganizationRole, 'OWNER'>,
  ) {
    await this.authorization.requireOrganizationAction(actor, organizationId, 'manage_members');
    const contact = await this.database.userContact.findUnique({
      where: {
        type_normalizedValue: { type: 'EMAIL', normalizedValue: email.trim().toLowerCase() },
      },
      include: { user: true },
    });
    if (!contact || contact.retiredAt !== null || contact.user.status !== 'ACTIVE') {
      throw new NotFoundException('No active user exists for this verified email address.');
    }
    if (contact.userId === actor.userId) {
      throw new ConflictException('You are already a member of this organization.');
    }
    const existingMembership = await this.database.membership.findUnique({
      where: {
        userId_organizationId: { userId: contact.userId, organizationId },
      },
    });
    if (existingMembership) {
      throw new ConflictException('This user is already a member of the organization.');
    }

    return this.database.$transaction(async (tx) => {
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { name: true },
      });
      const membership = await tx.membership.create({
        data: { userId: contact.userId, organizationId, role },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId: actor.userId,
          organizationId,
          action: 'organization.member.added',
          targetType: 'membership',
          targetId: membership.id,
        },
      });
      await tx.outboxEvent.create({
        data: {
          type: 'notification.create',
          payload: {
            userId: contact.userId,
            kind: 'organization.member.added',
            severity: 'SUCCESS',
            title: 'Organization access granted',
            body: `You were added to ${organization.name} as ${role}.`,
            actionUrl: `/organizations/${organizationId}`,
            dedupeKey: `organization.member.added:${membership.id}`,
          },
        },
      });
      return membership;
    });
  }
}
